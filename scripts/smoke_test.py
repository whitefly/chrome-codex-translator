#!/usr/bin/env python3
"""Send one short real translation. Uses the selected account's Codex quota."""
import argparse
import base64
import asyncio
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from host import Host
from codex_translator import CodexTranslator

async def main(model=None, image=None):
    messages = []
    def emit(message):
        messages.append(message)
        if message['type'] == 'delta':
            print(message['text'], end='', flush=True)
        elif message['type'] == 'error':
            print('\nERROR:', message['message'])
    translator = CodexTranslator()
    host = Host(emit, translator)
    try:
        models = (await translator.connect()).models
        selected = next((m for m in models if m['model'] == model), None) if model else next((m for m in models if m.get('isDefault')), models[0])
        if not selected:
            raise RuntimeError('Requested model unavailable')
        efforts = [e['reasoningEffort'] for e in selected.get('supportedReasoningEfforts', [])]
        message = dict(type='translate', requestId='smoke', text='Hello, world!', language='简体中文', model=selected['model'])
        if 'low' in efforts:
            message['effort'] = 'low'
        if image:
            message['text'] = ''
            message['image'] = 'data:image/png;base64,' + base64.b64encode(Path(image).read_bytes()).decode()
        print('Testing model:', selected['model'])
        await host.translate(message)
        if any(m['type'] == 'error' for m in messages):
            raise RuntimeError('Smoke test failed')
        done = next(m for m in messages if m['type'] == 'done')
        assert done['text'].strip(), 'Empty translation'
        print('\nPASS — streamed events:', sum(m['type'] == 'delta' for m in messages))
    finally:
        await host.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model')
    parser.add_argument('--image', help='PNG image path; sends this image to the model')
    args = parser.parse_args()
    asyncio.run(main(args.model, args.image))
