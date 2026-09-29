"""Codex App Server 子进程与 JSON-RPC 通信。"""
import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

from diagnostics import elapsed, record


def resolve_codex():
    # 优先使用本机配置路径，再依次检查可用的 Codex 可执行文件。
    config_file = Path(__file__).with_name('config.json')
    config = json.loads(config_file.read_text()) if config_file.exists() else {}
    explicit = config.get('codex_path') or os.environ.get('CODEX_TRANSLATOR_CODEX')
    candidates = [explicit] if explicit else [shutil.which('codex'), '/opt/homebrew/bin/codex',
        '/usr/local/bin/codex', '/Applications/ChatGPT.app/Contents/Resources/codex',
        '/Applications/Codex.app/Contents/Resources/codex']
    for candidate in dict.fromkeys(p for p in candidates if p):
        try:
            check = subprocess.run([candidate, '--version'], capture_output=True, timeout=8)
            if check.returncode == 0:
                return candidate
        except (OSError, subprocess.TimeoutExpired):
            pass
    raise RuntimeError('未找到可用的 Codex。运行 scripts/doctor.py，或在 native/config.json 设置 codex_path。')


class CodexClient:
    def __init__(self, on_event):
        self.on_event = on_event
        self.pending = {}
        self.counter = 0
        self.process = None
        self.reader = None
        self.start_lock = asyncio.Lock()

    async def start(self):
        # 连接与翻译复用同一子进程，仅在退出后重新启动。
        async with self.start_lock:
            if self.process and self.process.returncode is None:
                return
            record('codex.starting')
            path = await asyncio.to_thread(resolve_codex)
            # No stdout logs: this channel belongs exclusively to Chrome framing.
            self.process = await asyncio.create_subprocess_exec(path, 'app-server',
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL, limit=4 * 1024 * 1024)
            self.reader = asyncio.create_task(self.read_loop())
            try:
                await self.call('initialize', {'clientInfo': {'name': 'chrome_codex_translator', 'version': '0.1.0'}})
                await self.send({'method': 'initialized', 'params': {}})
            except Exception:
                await self.close()
                raise

    async def send(self, message):
        self.process.stdin.write((json.dumps(message) + '\n').encode())
        await self.process.stdin.drain()

    async def call(self, method, params):
        # 记录协议调用耗时，用于区分握手、建会话与启动任务的等待。
        self.counter += 1
        request_id = self.counter
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        started = time.monotonic()
        record('rpc.sent', rpc_id=request_id, method=method)
        try:
            await self.send({'id': request_id, 'method': method, 'params': params})
            result = await asyncio.wait_for(future, 35)
            record('rpc.completed', rpc_id=request_id, method=method, elapsed_ms=elapsed(started))
            return result
        except Exception as error:
            record('rpc.failed', rpc_id=request_id, method=method, elapsed_ms=elapsed(started), error_type=type(error).__name__)
            raise
        finally:
            self.pending.pop(request_id, None)

    async def read_loop(self):
        # 记录回传元数据，保留异常类型而不输出敏感协议正文。
        try:
            while line := await self.process.stdout.readline():
                msg = json.loads(line)
                error = msg.get('error') or {}
                record('codex.received', request_id=None, rpc_id=msg.get('id'), method=msg.get('method'),
                       has_error=bool(error), error_code=error.get('code') if isinstance(error.get('code'), int) else None)
                if 'method' in msg and 'id' in msg:
                    # This translation client never grants tool approvals.
                    if msg['method'].endswith('/requestApproval'):
                        await self.send({'id': msg['id'], 'result': {'decision': 'decline'}})
                    else:
                        await self.send({'id': msg['id'], 'error': {'code': -32601, 'message': 'Unsupported by translation client'}})
                elif 'id' in msg:
                    future = self.pending.get(msg['id'])
                    if future and not future.done():
                        if 'error' in msg:
                            future.set_exception(RuntimeError(msg['error'].get('message', 'Codex request failed')))
                        else:
                            future.set_result(msg.get('result', {}))
                else:
                    self.on_event(msg)
        except Exception as error:
            record('codex.read_failed', error_type=type(error).__name__)
        finally:
            record('codex.disconnected', returncode=self.process.returncode)
            for future in list(self.pending.values()):
                if not future.done():
                    future.set_exception(RuntimeError('Codex 连接已断开，请重新连接'))
            self.on_event({'method': 'bridge/disconnected'})

    async def close(self):
        # 有限等待子进程退出并收回协议读取任务。
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), 3)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
        if self.reader:
            await asyncio.gather(self.reader, return_exceptions=True)


