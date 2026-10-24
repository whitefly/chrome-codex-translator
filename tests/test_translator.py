"""独立于 Codex 协议的 Host 契约测试。"""
import asyncio
import base64
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from codex_client import CodexClient
from host import Host
from translator import ConnectionInfo, TranslationResult, TranslatorCapabilities


class FakeTranslator:
    capabilities = TranslatorCapabilities()

    def __init__(self):
        self.requests = []
        self.callbacks = []
        self.cancelled = []
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.pause = False
        self.failure = None
        self.closed = False

    async def connect(self):
        return ConnectionInfo(ready=True)

    async def translate(self, request, on_delta):
        self.requests.append(request)
        self.callbacks.append(on_delta)
        self.started.set()
        if self.pause:
            await self.release.wait()
        if self.failure:
            raise self.failure
        return TranslationResult('最终结果', request.request_id in self.cancelled)

    async def cancel(self, request_id):
        self.cancelled.append(request_id)
        self.release.set()

    async def close(self):
        self.closed = True


class TranslatorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.provider = FakeTranslator()
        self.messages = []
        self.host = Host(self.messages.append, self.provider)

    async def translate(self, request_id='req', **fields):
        await self.host.dispatch(dict(type='translate', requestId=request_id, text='Hello', **fields))

    async def test_nonstreaming_provider_without_model_or_login_protocol(self):
        await self.host.dispatch({'type': 'connect'})
        self.assertEqual(self.messages[-1], {'type': 'ready', 'models': [], 'loggedIn': True, 'authType': None})
        await self.translate()
        self.assertEqual(self.messages[-1]['text'], '最终结果')
        self.assertFalse(any(m['type'] == 'delta' for m in self.messages))
        self.assertIsNone(self.provider.requests[0].model)
        self.assertIsNone(self.provider.requests[0].effort)
        await self.host.close()
        self.assertTrue(self.provider.closed)

    async def test_unsupported_capabilities_rejected_before_provider(self):
        image = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\ntest').decode()
        for fields in ({'task': 'summary'}, {'image': image}):
            await self.translate(**fields)
            self.assertEqual(self.messages[-2]['type'], 'error')
            self.assertEqual(self.messages[-1]['type'], 'done')
        self.assertEqual(self.provider.requests, [])

    async def test_validated_image_bytes_and_options_reach_provider(self):
        self.provider.capabilities = TranslatorCapabilities(tasks=('translate', 'summary'), supports_images=True)
        png = b'\x89PNG\r\n\x1a\ntest'
        await self.translate(image='data:image/png;base64,' + base64.b64encode(png).decode(), task='summary')
        self.assertEqual(self.provider.requests[0].image, png)
        self.assertEqual(self.provider.requests[0].task, 'summary')

    async def test_errors_and_timeout_always_finish_and_allow_next_request(self):
        for failure in (RuntimeError('provider unavailable'), asyncio.TimeoutError()):
            self.provider.failure = failure
            await self.translate()
            self.assertEqual([m['type'] for m in self.messages[-2:]], ['error', 'done'])
            self.assertIsNone(self.host.active)
        self.provider.failure = None
        await self.translate('next')
        self.assertEqual(self.messages[-1]['text'], '最终结果')

    async def test_cancel_scope_busy_guard_and_late_delta(self):
        # 取消只影响匹配请求；旧回调不得覆盖下一请求或完成后的结果。
        self.provider.pause = True
        job = asyncio.create_task(self.translate())
        await self.provider.started.wait()
        await self.translate('busy')
        self.assertEqual(len(self.provider.requests), 1)
        self.assertEqual(self.messages[-1]['type'], 'error')
        await self.host.dispatch({'type': 'cancel', 'requestId': 'other'})
        self.assertFalse(self.provider.cancelled)
        old_callback = self.provider.callbacks[0]
        await self.host.dispatch({'type': 'cancel', 'requestId': 'req'})
        old_callback('取消后回传')
        await job
        self.assertTrue(self.messages[-1]['cancelled'])
        count = len(self.messages)
        old_callback('完成后回传')
        self.assertEqual(len(self.messages), count)
        self.provider.started.clear()
        self.provider.release.clear()
        job = asyncio.create_task(self.translate('next'))
        await self.provider.started.wait()
        old_callback('其他请求的迟到结果')
        self.assertEqual(len(self.messages), count)
        self.provider.release.set()
        await job

    async def test_close_cancels_running_jobs_and_releases_provider(self):
        self.provider.pause = True
        job = asyncio.create_task(self.translate())
        self.host.jobs.add(job)
        await self.provider.started.wait()
        await self.host.close()
        self.assertTrue(job.cancelled())
        self.assertTrue(self.provider.closed)
        self.assertTrue(self.messages[-1]['cancelled'])
        self.assertIsNone(self.host.active)

    async def test_bad_types_rejected_before_provider(self):
        for fields in ({'model': []}, {'effort': {}}, {'request_id': ''}):
            await self.translate(**fields)
            self.assertEqual(self.messages[-2]['type'], 'error')
        self.assertFalse(self.provider.requests)


class CodexProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_and_repeated_start_reuses_process(self):
        # 使用假子进程验证启动锁与复用条件，不调用真实模型或个人配置。
        client = CodexClient(lambda event: None)
        process = type('Process', (), {'returncode': None})()
        with patch('codex_client.resolve_codex', return_value='/fake/codex'), \
             patch('codex_client.asyncio.create_subprocess_exec', new_callable=AsyncMock, return_value=process) as spawn, \
             patch.object(client, 'read_loop', new_callable=AsyncMock), \
             patch.object(client, 'call', new_callable=AsyncMock) as call, \
             patch.object(client, 'send', new_callable=AsyncMock):
            await asyncio.gather(client.start(), client.start())
            await client.start()
            self.assertEqual(spawn.await_count, 1)
            self.assertEqual(call.await_count, 1)
            await client.reader
