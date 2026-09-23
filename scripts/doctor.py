#!/usr/bin/env python3
"""Read-only diagnostic: executable, protocol handshake, login and model catalog."""
import asyncio
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from host import CodexClient, resolve_codex

async def main():
    print('Python:', sys.version.split()[0])
    print('Codex:', resolve_codex())
    client = CodexClient(lambda event: None)
    try:
        await client.start()
        print('App Server: handshake OK')
        account = (await client.call('account/read', {'refreshToken': False})).get('account')
        print('Login:', account.get('type') if account else 'NOT LOGGED IN — run codex login')
        models = (await client.call('model/list', {'limit': 100})).get('data', [])
        print('Models:', ', '.join(m['model'] for m in models))
    finally:
        await client.close()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        print('ERROR:', str(error), file=sys.stderr)
        sys.exit(1)
