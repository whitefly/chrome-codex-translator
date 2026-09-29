#!/usr/bin/env python3
"""Chrome Native Messaging 边界与供应商无关的翻译调度。Python >= 3.9。"""
import asyncio
import base64
from dataclasses import dataclass
import json
import struct
import sys
import time
from typing import Callable, Optional

from codex_translator import CodexTranslator
from diagnostics import REQUEST_ID, configure_logging, elapsed, record
from translator import TranslationRequest, Translator

HOST_NAME = 'com.local.codex_translator'
MAX_MESSAGE = 12 * 1024 * 1024


def read_exact(stream, size):
    # 聚合短读取并区分正常 EOF 与截断帧。
    parts = bytearray()
    while len(parts) < size:
        part = stream.read(size - len(parts))
        if not part:
            if not parts:
                return None
            raise EOFError('Truncated native message')
        parts.extend(part)
    return bytes(parts)


def read_message(stream):
    # 在解析 JSON 前限制帧大小并验证顶层消息类型。
    header = read_exact(stream, 4)
    if header is None:
        return None
    size = struct.unpack('=I', header)[0]
    if not 0 < size <= MAX_MESSAGE:
        raise ValueError('Native message exceeds size limit')
    body = read_exact(stream, size)
    if body is None:
        raise EOFError('Missing message body')
    value = json.loads(body)
    if not isinstance(value, dict):
        raise ValueError('Expected JSON object')
    return value


def write_message(stream, value):
    body = json.dumps(value, ensure_ascii=False).encode('utf-8')
    if len(body) >= 1024 * 1024:
        raise ValueError('Output message too large')
    stream.write(struct.pack('=I', len(body)) + body)
    stream.flush()


def validate_translation(message):
    # 在 Chrome 边界校验文本与图片，供应商只能收到解码后的图片字节。
    if message.get('task', 'translate') not in ('translate', 'summary'):
        raise ValueError('不支持的处理类型')
    text = message.get('text', '')
    image = message.get('image')
    if not isinstance(text, str) or len(text) > 30000:
        raise ValueError('文本最多 30,000 字符')
    if not text.strip() and not image:
        raise ValueError('请先选择文字或截图')
    language = message.get('language', '简体中文')
    if language not in ['简体中文', '繁體中文', 'English', '日本語', '한국어']:
        raise ValueError('不支持的目标语言')
    decoded = None
    if image:
        if not isinstance(image, str) or not image.startswith('data:image/png;base64,'):
            raise ValueError('截图必须是 PNG')
        decoded = base64.b64decode(image.split(',', 1)[1], validate=True)
        if len(decoded) > 8 * 1024 * 1024 or not decoded.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('截图无效或超过 8 MB')
    return text, language, decoded


@dataclass
class ActiveRequest:
    request_id: str
    started: float
    text: str = ''
    cancelled: bool = False


def parse_request(message: dict) -> TranslationRequest:
    # 在进入供应商接口前完成消息字段的运行时类型校验。
    text, language, image = validate_translation(message)
    request_id = message.get('requestId')
    if not isinstance(request_id, str) or not request_id or len(request_id) > 128:
        raise ValueError('请求 ID 无效')
    for key in ('model', 'effort'):
        value = message.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > 256):
            raise ValueError('模型或思考强度无效')
    return TranslationRequest(request_id=request_id, text=text, language=language,
                              task=message.get('task', 'translate'), image=image,
                              model=message.get('model'), effort=message.get('effort'))


class Host:
    def __init__(self, emit: Callable[[dict], None], translator: Optional[Translator] = None):
        self.output = emit
        self.translator = translator if translator is not None else CodexTranslator()
        self.active: Optional[ActiveRequest] = None
        self.jobs = set()

    def emit(self, message):
        self.output(message)
        record('chrome.sent', method=message.get('type'), request_id=message.get('requestId'),
               chars=len(message.get('text', '')), cancelled=message.get('cancelled'),
               has_error=message.get('type') == 'error')

    def validate_capabilities(self, request: TranslationRequest) -> None:
        capabilities = self.translator.capabilities
        if request.task not in capabilities.tasks:
            raise ValueError('当前翻译服务不支持此任务')
        if request.image is not None and not capabilities.supports_images:
            raise ValueError('当前翻译服务不支持截图')

    def receive_delta(self, active: ActiveRequest, text: str) -> None:
        if self.active is not active or active.cancelled:
            return
        if not isinstance(text, str) or len(active.text) + len(text) > 150000:
            raise ValueError('译文无效或超过输出限制')
        active.text += text
        self.emit({'type': 'delta', 'requestId': active.request_id, 'text': text})

    async def translate(self, message):
        # Host 统一调度、校验和收尾；供应商仅提供增量与最终结果。
        request_id = message.get('requestId')
        if self.active:
            self.emit({'type': 'error', 'requestId': request_id, 'message': '已有翻译进行中，请先取消'})
            return
        active = ActiveRequest(request_id, time.monotonic())
        self.active = active
        failed = False
        try:
            request = parse_request(message)
            self.validate_capabilities(request)
            result = await self.translator.translate(request, lambda text: self.receive_delta(active, text))
            if not isinstance(result.text, str) or len(result.text) > 150000:
                raise ValueError('译文无效或超过输出限制')
            active.cancelled = active.cancelled or result.cancelled
            active.text = result.text
        except asyncio.CancelledError:
            active.cancelled = True
            raise
        except Exception as error:
            failed = True
            timed_out = isinstance(error, asyncio.TimeoutError)
            record('translation.timeout' if timed_out else 'translation.failed',
                   request_id=request_id, elapsed_ms=elapsed(active.started), error_type=type(error).__name__)
            self.emit({'type': 'error', 'requestId': request_id,
                       'message': '翻译超时，请重试或更换模型' if timed_out else str(error)[:1500]})
        finally:
            self.active = None
            record('translation.finished', request_id=request_id, elapsed_ms=elapsed(active.started),
                   cancelled=active.cancelled, status='failed' if failed else 'cancelled' if active.cancelled else 'completed',
                   has_error=failed)
            self.emit({'type': 'done', 'requestId': request_id, 'cancelled': active.cancelled, 'text': active.text})

    async def dispatch(self, message):
        # 将浏览器请求 ID 关联到该任务中的协议调用与回传。
        token = REQUEST_ID.set(message.get('requestId'))
        record('chrome.received', method=message.get('type'))
        try:
            kind = message.get('type')
            if kind == 'connect':
                info = await self.translator.connect()
                self.emit({'type': 'ready', 'models': info.models, 'loggedIn': info.ready, 'authType': info.auth_type})
            elif kind == 'translate':
                await self.translate(message)
            elif kind == 'cancel' and self.active and message.get('requestId') == self.active.request_id:
                self.active.cancelled = True
                await self.translator.cancel(self.active.request_id)
            elif kind not in ('cancel',):
                raise ValueError('Unknown message type')
        except Exception as error:
            record('dispatch.failed', error_type=type(error).__name__)
            self.emit({'type': 'error', 'requestId': message.get('requestId'), 'message': str(error)[:1500]})
        finally:
            REQUEST_ID.reset(token)

    async def close(self) -> None:
        for task in list(self.jobs):
            task.cancel()
        try:
            await asyncio.gather(*self.jobs, return_exceptions=True)
        finally:
            await self.translator.close()

    async def run(self):
        # 保持 Native Messaging 长连接，退出前收回任务并释放供应商资源。
        try:
            while True:
                message = await asyncio.to_thread(read_message, sys.stdin.buffer)
                if message is None:
                    break
                if len(self.jobs) >= 12:
                    self.emit({'type': 'error', 'requestId': message.get('requestId'), 'message': '请求过多，请稍后重试'})
                    continue
                task = asyncio.create_task(self.dispatch(message))
                self.jobs.add(task)
                task.add_done_callback(self.jobs.discard)
        finally:
            await self.close()


if __name__ == '__main__':
    configure_logging()
    try:
        asyncio.run(Host(lambda message: write_message(sys.stdout.buffer, message)).run())
    except (BrokenPipeError, EOFError):
        pass
