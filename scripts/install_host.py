#!/usr/bin/env python3
"""Register this checkout as a Chrome Native Messaging host on macOS."""
import argparse
import json
from pathlib import Path
import re
import shlex
import sys


def install(extension_id, root, destination, python_path, codex_path=None):
    if not re.fullmatch('[a-p]{32}', extension_id):
        raise ValueError('扩展 ID 必须是 chrome://extensions 中的 32 位 a-p 字符')
    if not Path(python_path).is_file():
        raise ValueError('Python 路径无效')
    if codex_path and not Path(codex_path).is_file():
        raise ValueError('Codex 路径无效')
    launcher = root / 'native' / 'launch.sh'
    launcher.write_text('#!/bin/sh\nexec ' + shlex.quote(str(python_path)) + ' ' + shlex.quote(str(root / 'native' / 'host.py')) + ' "$@"\n')
    launcher.chmod(0o755)
    if codex_path:
        config = root / 'native' / 'config.json'
        config.write_text(json.dumps({'codex_path': str(Path(codex_path).resolve())}, indent=2) + '\n')
        config.chmod(0o600)
    manifest = dict(name='com.local.codex_translator', description='Local Codex translation bridge',
                    path=str(launcher), type='stdio', allowed_origins=['chrome-extension://' + extension_id + '/'])
    destination.mkdir(parents=True, exist_ok=True)
    path = destination / 'com.local.codex_translator.json'
    if path.exists():
        path.with_suffix('.json.bak').write_bytes(path.read_bytes())
    path.write_text(json.dumps(manifest, indent=2) + '\n')
    return path


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('extension_id')
    parser.add_argument('--codex', help='Codex 可执行文件的绝对路径')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('初版安装脚本仅支持 macOS')
    root = Path(__file__).resolve().parents[1]
    destination = Path.home() / 'Library/Application Support/Google/Chrome/NativeMessagingHosts'
    print(install(args.extension_id, root, destination, sys.executable, args.codex))
    print('已注册。回到扩展，点击「连接 Codex」。无需重启桌面应用。')
