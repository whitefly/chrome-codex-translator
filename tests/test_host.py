import asyncio
import base64
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from codex_translator import CodexTranslator
from host import Host, MAX_MESSAGE, read_message, write_message, validate_translation
from install_host import install

MODEL = {'model': 'test-model', 'supportedReasoningEfforts': [{'reasoningEffort': 'low'}], 'inputModalities': ['text', 'image']}

class FramingTests(unittest.TestCase):
    def test_unicode_round_trip_and_eof(self):
        data = io.BytesIO()
        write_message(data, {'text': '你好🌏'})
        data.seek(0)
        self.assertEqual(read_message(data), {'text': '你好🌏'})
        self.assertIsNone(read_message(data))

    def test_truncation_and_limits(self):
        for data in [b'\x00', struct.pack('=I', 10) + b'{}', struct.pack('=I', 4)]:
            with self.assertRaises(EOFError): read_message(io.BytesIO(data))
        with self.assertRaises(ValueError): read_message(io.BytesIO(struct.pack('=I', MAX_MESSAGE + 1)))

    def test_validation(self):
        with self.assertRaises(ValueError): validate_translation({'text': ''})
        with self.assertRaises(ValueError): validate_translation({'text': 'x' * 30001})
        with self.assertRaises(ValueError): validate_translation({'text':'x', 'language':'arbitrary prompt'})
        with self.assertRaises(ValueError): validate_translation({'image':'data:image/png;base64,aGVsbG8='})
        with self.assertRaises(ValueError): validate_translation({'text':'Hello', 'task':'delete-files'})
        png = b'\x89PNG\r\n\x1a\n' + b'test'
        self.assertEqual(validate_translation({'image':'data:image/png;base64,'+base64.b64encode(png).decode()})[2], png)

    def test_install_exact_origin_and_quoted_paths(self):
        with tempfile.TemporaryDirectory(prefix='host test ') as directory:
            root = Path(directory); (root/'native').mkdir()
            path = install('a'*32, root, root/'registry', sys.executable)
            manifest = json.loads(path.read_text())
            self.assertEqual(manifest['allowed_origins'], ['chrome-extension://'+'a'*32+'/'])
            self.assertIn("'", (root/'native/launch.sh').read_text())
            with self.assertRaises(ValueError): install('*', root, root/'registry', sys.executable)

class FakeClient:
    def __init__(self, host, pause=False): self.host=host; self.pause=pause; self.calls=[]; self.started=asyncio.Event()
    async def call(self, method, params):
        self.calls.append((method, params))
        if method=='thread/start': return {'thread':{'id':'thread'}}
        if method=='turn/start':
            self.started.set()
            if not self.pause:
                self.host.event({'method':'item/agentMessage/delta','params':{'threadId':'other','delta':'wrong'}})
                self.host.event({'method':'item/agentMessage/delta','params':{'threadId':'thread','itemId':'i','delta':'草稿'}})
                self.host.event({'method':'item/completed','params':{'threadId':'thread','item':{'type':'agentMessage','id':'i','text':'你好，世界！'}}})
                self.host.event({'method':'turn/completed','params':{'threadId':'thread','turn':{'status':'completed'}}})
            return {'turn':{'id':'turn'}}
        if method=='turn/interrupt':
            self.host.event({'method':'turn/completed','params':{'threadId':'thread','turn':{'status':'interrupted'}}})
        return {}

class HostTests(unittest.IsolatedAsyncioTestCase):
    def make_host(self, pause=False):
        events=[]; translator=CodexTranslator(); translator.models=[MODEL]
        translator.client=FakeClient(translator,pause); host=Host(events.append, translator)
        return host,events
    def request(self): return dict(requestId='req', text='Hello', model='test-model', effort='low')
    async def test_stream_is_scoped_and_final_is_authoritative(self):
        host,events=self.make_host()
        await host.translate(self.request())
        self.assertEqual([e['text'] for e in events if e['type']=='delta'], ['草稿'])
        self.assertEqual(events[-1]['text'], '你好，世界！')
        self.assertIsNone(host.active)
    async def test_summary_uses_separate_prompt_and_target_language(self):
        host,events=self.make_host()
        await host.translate(dict(self.request(), task='summary', language='简体中文'))
        turn=next(params for method,params in host.translator.client.calls if method=='turn/start')
        prompt=turn['input'][0]['text']
        self.assertIn('Summarize the main point',prompt)
        self.assertIn('简体中文',prompt)
        self.assertIn('Hello',prompt)
        self.assertIn('core conclusion',prompt)
        self.assertIn('nested subpoints',prompt)
        self.assertIn('Keep short sources brief',prompt)
        self.assertIn('Markdown',prompt)
        self.assertEqual(events[-1]['type'],'done')
    async def test_cancel_and_busy_request(self):
        host,events=self.make_host(True)
        task=asyncio.create_task(host.translate(self.request()))
        await host.translator.client.started.wait(); await asyncio.sleep(0)
        await host.translate(dict(self.request(), requestId='busy'))
        self.assertEqual(events[-1]['type'],'error')
        await host.dispatch({'type':'cancel','requestId':'req'})
        await task
        self.assertTrue(events[-1]['cancelled'])
        self.assertIn('turn/interrupt',[c[0] for c in host.translator.client.calls])
    async def test_unsupported_model_is_not_called(self):
        host,events=self.make_host()
        await host.translate(dict(self.request(),model='missing'))
        self.assertTrue(any(e['type']=='error' for e in events))
        self.assertEqual(host.translator.client.calls,[])
    async def test_image_removed_after_request(self):
        host,events=self.make_host()
        image='data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\nexample').decode()
        await host.translate(dict(self.request(),image=image))
        turn=next(p for method,p in host.translator.client.calls if method=='turn/start')
        self.assertFalse(Path(turn['input'][1]['path']).exists())

if __name__=='__main__': unittest.main()
