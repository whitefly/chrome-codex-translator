"""翻译服务契约：与 Chrome 消息和具体供应商协议无关。"""
from dataclasses import dataclass, field
from typing import Callable, Literal, Optional, Protocol, Tuple, TypedDict

TaskKind = Literal['translate', 'summary']
DeltaCallback = Callable[[str], None]


class ReasoningEffort(TypedDict):
    reasoningEffort: str


class ModelInfo(TypedDict, total=False):
    model: str
    displayName: str
    isDefault: bool
    inputModalities: list[str]
    supportedReasoningEfforts: list[ReasoningEffort]


@dataclass(frozen=True)
class TranslatorCapabilities:
    tasks: Tuple[TaskKind, ...] = ('translate',)
    supports_images: bool = False
    supports_streaming: bool = False


@dataclass(frozen=True)
class ConnectionInfo:
    ready: bool
    models: list[ModelInfo] = field(default_factory=list)
    auth_type: Optional[str] = None


@dataclass(frozen=True)
class TranslationRequest:
    request_id: str
    text: str
    language: str
    task: TaskKind = 'translate'
    image: Optional[bytes] = None
    model: Optional[str] = None
    effort: Optional[str] = None


@dataclass(frozen=True)
class TranslationResult:
    text: str
    cancelled: bool = False


class Translator(Protocol):
    """实例随 host 复用；同一时间最多一次 translate，cancel 可并发调用。

    非流式实现直接返回最终结果即可。取消必须按 request_id 匹配，
    取消后 translate 应结束并返回 cancelled=True；close 释放供应商资源。
    异常交由 Host 转为 Chrome error/done 消息，供应商不发送 Chrome 消息。
    """
    capabilities: TranslatorCapabilities

    async def connect(self) -> ConnectionInfo: ...

    async def translate(self, request: TranslationRequest, on_delta: DeltaCallback) -> TranslationResult: ...

    async def cancel(self, request_id: str) -> None: ...

    async def close(self) -> None: ...
