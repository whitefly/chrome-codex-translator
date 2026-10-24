import type {CacheEntry, Language, ModelInfo, NativeEvent, PageCommand, PanelState, PanelUpdate,
    Paths, PickMode, RuntimeRequest, ScreenshotRect, Source, TaskKind} from './contracts';

export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('消息必须是对象');
    return value as Record<string, unknown>;
}

export function text(value: unknown, max = Infinity): string {
    if (typeof value !== 'string' || value.length > max) throw new Error('文字字段无效或过长');
    return value;
}

function boolean(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('布尔字段无效');
    return value;
}

export function taskKind(value: unknown): TaskKind {
    if (value !== 'translate' && value !== 'summary') throw new Error('不支持的处理类型');
    return value;
}

export function pickMode(value: unknown): PickMode {
    if (value !== 'selection' && value !== 'element' && value !== 'screenshot') throw new Error('未知选择模式');
    return value;
}

export function language(value: unknown): Language {
    switch (value) {
        case '简体中文': case '繁體中文': case 'English': case '日本語': case '한국어': return value;
        default: throw new Error('不支持的目标语言');
    }
}

export function selectionPaths(value: unknown): Paths {
    if (!Array.isArray(value) || !value.length || value.length > 200) throw new Error('选区位置无效');
    const paths = value.map((path: unknown) => {
        if (!Array.isArray(path) || !path.length || path.length > 30) throw new Error('选区位置无效');
        return path.map((index: unknown) => {
            if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 10000) throw new Error('选区位置无效');
            return index;
        });
    });
    if (paths.some((path, i) => paths.some((other, j) => i !== j && other.length <= path.length &&
        other.every((index, depth) => path[depth] === index)))) throw new Error('选区位置重复或嵌套');
    return paths;
}

function screenshotRect(value: unknown): ScreenshotRect {
    const r = object(value);
    const finite = (v: unknown): number => {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('截图范围无效');
        return v;
    };
    const rect = {x: finite(r.x), y: finite(r.y), width: finite(r.width), height: finite(r.height),
        viewportWidth: finite(r.viewportWidth), viewportHeight: finite(r.viewportHeight)};
    if (rect.width < 4 || rect.height < 4 || rect.x < 0 || rect.y < 0 ||
        rect.x + rect.width > rect.viewportWidth + 1 || rect.y + rect.height > rect.viewportHeight + 1) throw new Error('截图范围无效');
    return rect;
}

// 仅在通信入口解析未知数据；业务函数接收已经收窄的消息。
export function runtimeRequest(value: unknown): RuntimeRequest {
    const m = object(value);
    switch (m.type) {
        case 'getState': case 'enableHover': case 'connect': case 'clear': case 'cancel':
        case 'hoverSettings': case 'hoverCacheLoad': case 'hoverDisable': return {type: m.type};
        case 'pick': return {type: 'pick', mode: pickMode(m.mode)};
        case 'translate': return {type: 'translate', text: text(m.text, 30000), model: text(m.model, 256),
            effort: text(m.effort ?? '', 256), language: language(m.language)};
        case 'picked': {
            const mode = pickMode(m.mode);
            return mode === 'screenshot' ? {type: 'picked', mode, rect: screenshotRect(m.rect)} :
                {type: 'picked', mode, text: text(m.text, 30000)};
        }
        case 'hoverCancel': return {type: 'hoverCancel', requestId: text(m.requestId, 80)};
        case 'hoverTranslate': {
            const requestId = text(m.requestId, 80), source = text(m.text, 12000);
            if (!requestId || !source.trim()) throw new Error('段落内容无效或过长');
            return {type: 'hoverTranslate', requestId, text: source, kind: taskKind(m.kind), paths: selectionPaths(m.paths)};
        }
        default: throw new Error('未知操作');
    }
}

export function modelInfo(value: unknown): ModelInfo {
    const m = object(value);
    const model: ModelInfo = {model: text(m.model, 256)};
    if (m.displayName !== undefined) model.displayName = text(m.displayName);
    if (m.isDefault !== undefined) model.isDefault = boolean(m.isDefault);
    if (m.inputModalities !== undefined) {
        if (!Array.isArray(m.inputModalities)) throw new Error('模型输入能力无效');
        model.inputModalities = m.inputModalities.map(v => text(v));
    }
    if (m.supportedReasoningEfforts !== undefined) {
        if (!Array.isArray(m.supportedReasoningEfforts)) throw new Error('模型思考强度无效');
        model.supportedReasoningEfforts = m.supportedReasoningEfforts.map(v => ({reasoningEffort: text(object(v).reasoningEffort)}));
    }
    return model;
}

function models(value: unknown): ModelInfo[] {
    if (!Array.isArray(value)) throw new Error('模型列表无效');
    return value.map(modelInfo);
}

export function nativeEvent(value: unknown): NativeEvent {
    const m = object(value);
    switch (m.type) {
        case 'ready': return {type: 'ready', models: models(m.models), loggedIn: boolean(m.loggedIn),
            authType: m.authType == null ? null : text(m.authType)};
        case 'delta': return {type: 'delta', requestId: text(m.requestId), text: text(m.text)};
        case 'done': return {type: 'done', requestId: text(m.requestId), text: text(m.text), cancelled: boolean(m.cancelled)};
        case 'error': return {type: 'error', message: text(m.message),
            ...(m.requestId == null ? {} : {requestId: text(m.requestId)})};
        default: throw new Error('本地桥接返回了未知消息');
    }
}

export function cacheEntries(value: unknown): CacheEntry[] {
    if (!Array.isArray(value)) throw new Error('页面缓存无效');
    return value.map(v => {
        const item = object(v);
        const entry: CacheEntry = {paths: selectionPaths(item.paths), source: text(item.source, 12000)};
        if (item.translate !== undefined) entry.translate = text(item.translate);
        if (item.summary !== undefined) entry.summary = text(item.summary);
        if (typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)) entry.updatedAt = item.updatedAt;
        return entry;
    });
}

function source(value: unknown): Source | null {
    if (value === null) return null;
    const s = object(value);
    const base = {text: text(s.text), ...(s.title === undefined ? {} : {title: text(s.title)})};
    if (s.mode === 'screenshot') return {...base, mode: s.mode, image: text(s.image)};
    if (s.mode === 'hover' || s.mode === 'selection' || s.mode === 'element') return {...base, mode: s.mode};
    throw new Error('原文类型无效');
}

export function panelUpdate(value: unknown): PanelUpdate {
    const s = object(value);
    return {connected: boolean(s.connected), loggedIn: boolean(s.loggedIn), models: models(s.models),
        authType: s.authType == null ? null : text(s.authType), result: text(s.result), status: text(s.status),
        busy: boolean(s.busy), requestId: s.requestId == null ? null : text(s.requestId), error: text(s.error),
        ...('source' in s ? {source: source(s.source)} : {})};
}

export function panelState(value: unknown): PanelState {
    const state = panelUpdate(value);
    if (!('source' in state)) throw new Error('初始状态缺少原文');
    return {...state, source: state.source ?? null};
}

export function pageCommand(value: unknown): PageCommand {
    const m = object(value);
    if (m.type === 'pick') return {type: 'pick', mode: pickMode(m.mode)};
    if (m.type === 'hoverEnable') return {type: 'hoverEnable', enabled: boolean(m.enabled),
        ...(m.mode === 'hover' || m.mode === 'region' ? {mode: m.mode} : {})};
    if (m.type === 'hoverState') return {type: 'hoverState', requestId: text(m.requestId),
        result: text(m.result), status: text(m.status), error: text(m.error), busy: boolean(m.busy)};
    throw new Error('未知网页操作');
}

export function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
