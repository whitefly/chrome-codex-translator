export type TaskKind = 'translate' | 'summary';
export type PickMode = 'selection' | 'element' | 'screenshot';
export type Language = '简体中文' | '繁體中文' | 'English' | '日本語' | '한국어';
export type Paths = number[][];

export interface ModelInfo {
    model: string;
    displayName?: string;
    isDefault?: boolean;
    inputModalities?: string[];
    supportedReasoningEfforts?: {reasoningEffort: string}[];
}

export interface Preferences {
    model: string;
    effort: string;
    language: Language;
    markdown: boolean;
}

export type Source = {text: string; title?: string} & (
    | {mode: 'selection' | 'element' | 'hover'; image?: never}
    | {mode: 'screenshot'; image: string}
);

export interface ScreenshotRect {
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
}

export interface CacheEntry {
    paths: Paths;
    source: string;
    translate?: string;
    summary?: string;
    updatedAt?: number;
}

export interface PanelState {
    connected: boolean;
    loggedIn: boolean;
    models: ModelInfo[];
    authType: string | null;
    source: Source | null;
    result: string;
    status: string;
    busy: boolean;
    requestId: string | null;
    error: string;
}

// 广播只允许省略原文；缺省表示保留，null 表示清空。
export type PanelUpdate = Omit<PanelState, 'source'> & {source?: Source | null};
export type TranslationOptions = Pick<Preferences, 'model' | 'effort' | 'language'>;
export type PanelRequest =
    | {type: 'getState' | 'enableHover' | 'connect' | 'clear' | 'cancel'}
    | {type: 'pick'; mode: PickMode}
    | ({type: 'translate'; text: string} & TranslationOptions);
export type PickedPayload =
    | {mode: 'selection' | 'element'; text: string}
    | {mode: 'screenshot'; rect: ScreenshotRect};
export type PageRequest =
    | ({type: 'picked'} & PickedPayload)
    | {type: 'hoverSettings' | 'hoverCacheLoad' | 'hoverDisable'}
    | {type: 'hoverCancel'; requestId: string}
    | {type: 'hoverTranslate'; requestId: string; text: string; kind: TaskKind; paths: Paths};
export type RuntimeRequest = PanelRequest | PageRequest;

export interface RequestResults {
    getState: PanelState;
    hoverCacheLoad: CacheEntry[];
    enableHover: void;
    connect: void;
    clear: void;
    cancel: void;
    pick: void;
    translate: void;
    picked: void;
    hoverSettings: void;
    hoverDisable: void;
    hoverCancel: void;
    hoverTranslate: void;
}

export type HoverState = {type: 'hoverState'; requestId: string; kind?: TaskKind} &
    Pick<PanelState, 'result' | 'status' | 'error' | 'busy'>;
export type PageCommand =
    | {type: 'pick'; mode: PickMode}
    | {type: 'hoverEnable'; enabled: boolean; mode?: 'hover' | 'region'}
    | HoverState;

export type NativeRequest =
    | {type: 'connect'}
    | {type: 'cancel'; requestId: string}
    | {type: 'translate'; requestId: string; text: string; language: Language;
        task: TaskKind; model?: string; effort?: string; image?: string};
export type ReadyMessage = {type: 'ready'; models: ModelInfo[]; loggedIn: boolean; authType: string | null};
export type NativeEvent =
    | ReadyMessage
    | {type: 'delta'; requestId: string; text: string}
    | {type: 'done'; requestId: string; text: string; cancelled: boolean}
    | {type: 'error'; requestId?: string; message: string};

export interface HoverOrigin {
    type: 'hover';
    tabId: number;
    documentId?: string;
    url: string;
    paths: Paths;
}
export type TaskOrigin = {type: 'panel'} | HoverOrigin;
