"""仅记录协议元数据，不记录请求或回传正文。"""
import contextvars
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import time

LOG_DIR = Path(__file__).resolve().parents[1] / 'log'
REQUEST_ID = contextvars.ContextVar('request_id', default=None)
LOGGER = logging.getLogger('codex_translator')
LOGGER.addHandler(logging.NullHandler())
LOGGER.propagate = False
FIELDS = {'rpc_id', 'method', 'request_id', 'elapsed_ms', 'chars', 'cancelled',
          'error_type', 'error_code', 'has_error', 'status', 'returncode'}


def configure_logging(directory: Path = LOG_DIR) -> Path:
    # 每个进程独立轮转，避免多个 Chrome 连接同时重命名同一日志。
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f'bridge-{os.getpid()}.log'
    handler = RotatingFileHandler(path, maxBytes=2 * 1024 * 1024, backupCount=2, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
    LOGGER.addHandler(handler)
    LOGGER.setLevel(logging.INFO)
    record('host.started')
    return path


def record(event: str, **fields) -> None:
    # 字段白名单阻止正文误写；错误仅记类型和数值代码，不记可能携带正文的描述。
    data = {'event': event, 'request_id': REQUEST_ID.get()}
    data.update({key: value for key, value in fields.items() if key in FIELDS})
    LOGGER.info(json.dumps(data, ensure_ascii=False))


def elapsed(started: float) -> int:
    return round((time.monotonic() - started) * 1000)
