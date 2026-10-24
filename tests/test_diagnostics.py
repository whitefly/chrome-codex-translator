import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from diagnostics import LOGGER, configure_logging, record
from host import Host, read_message, write_message
from test_host import FakeClient, MODEL


class DiagnosticsTests(unittest.IsolatedAsyncioTestCase):
    async def test_return_logs_preserve_frames_and_exclude_content(self):
        # 用完整模拟翻译验证日志与 Chrome 帧并存，正文及敏感错误不落盘。
        with tempfile.TemporaryDirectory() as directory:
            path = configure_logging(Path(directory))
            handler = LOGGER.handlers[-1]
            try:
                output = io.BytesIO()
                host = Host(lambda message: write_message(output, message))
                host.translator.models = [MODEL]
                host.translator.client = FakeClient(host.translator, False)
                await host.dispatch({'type': 'translate', 'requestId': 'request-log-test',
                                     'model': MODEL['model'], 'text': 'PRIVATE SOURCE', 'language': 'English'})
                host.emit({'type': 'error', 'message': 'PRIVATE ERROR TOKEN', 'requestId': 'request-log-test'})
                record('privacy.test', text='PRIVATE SOURCE', image='PRIVATE IMAGE', token='PRIVATE TOKEN')
                output.seek(0)
                frames = []
                while (frame := read_message(output)) is not None:
                    frames.append(frame)
                self.assertTrue(any(frame['type'] == 'done' for frame in frames))
                self.assertEqual(frames[-1]['message'], 'PRIVATE ERROR TOKEN')
                content = path.read_text()
                self.assertNotIn('PRIVATE', content)
                for frame in frames:
                    if frame.get('text'):
                        self.assertNotIn(frame['text'], content)
                self.assertIn('chrome.sent', content)
                self.assertIn('translation.finished', content)
                self.assertIn('request-log-test', content)
                self.assertIn('elapsed_ms', content)
            finally:
                handler.close()
                LOGGER.removeHandler(handler)

    def test_rotation_keeps_bounded_backups(self):
        # 降低轮转阈值，确认当前文件和备份总数有界且每行仍可解析。
        with tempfile.TemporaryDirectory() as directory:
            path = configure_logging(Path(directory))
            handler = LOGGER.handlers[-1]
            try:
                handler.maxBytes = 300
                for _ in range(30):
                    record('rotation.test', chars=42)
                files = list(Path(directory).glob('*.log*'))
                self.assertEqual(len(files), 3)
                self.assertTrue(path.exists())
                for file in files:
                    for line in file.read_text().splitlines():
                        json.loads(line[line.index('{'):])
            finally:
                handler.close()
                LOGGER.removeHandler(handler)
