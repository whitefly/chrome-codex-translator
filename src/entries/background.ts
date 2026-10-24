import type {PageCommand, PickMode, RuntimeRequest, ScreenshotRect, Source} from '../shared/contracts';
import {errorText, object, runtimeRequest} from '../shared/validation';
import {readPageCache} from '../background/page-cache';
import {Tasks} from '../background/tasks';

const hoverTabs = new Set<number>();
const hoverReady = chrome.storage.session.get('hoverTabs').then((saved: Record<string, unknown>) => {
    if (Array.isArray(saved.hoverTabs)) for (const id of saved.hoverTabs) {
        if (typeof id === 'number' && Number.isInteger(id)) hoverTabs.add(id);
    }
}).catch(() => {});
let notifyTimer: ReturnType<typeof setTimeout> | undefined;
let lastSource: Source | null | undefined;
const tasks = new Tasks(notify);

function saveHoverTabs(): void {
    void chrome.storage.session.set({hoverTabs: [...hoverTabs]}).catch(() => {});
}

function sendPage(tabId: number, message: PageCommand, documentId?: string): Promise<unknown> {
    return chrome.tabs.sendMessage(tabId, message, documentId ? {documentId} : {frameId: 0});
}

function notify(): void {
    if (notifyTimer !== undefined) return;
    notifyTimer = setTimeout(() => {
        notifyTimer = undefined;
        const state = tasks.state;
        const {source, ...update} = state;
        const snapshot = source === lastSource ? update : state;
        lastSource = source;
        void chrome.runtime.sendMessage({type: 'state', state: snapshot}).catch(() => {});
        const origin = tasks.origin;
        if (origin.type === 'hover' && state.requestId) {
            void sendPage(origin.tabId, {type: 'hoverState', requestId: state.requestId,
                result: state.result, status: state.status, error: state.error, busy: state.busy}, origin.documentId).catch(() => {});
        }
    }, 40);
}

async function activeTab(): Promise<chrome.tabs.Tab & {id: number}> {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    return identifiedTab(tab);
}

function identifiedTab(tab: chrome.tabs.Tab | undefined): chrome.tabs.Tab & {id: number} {
    if (tab?.id === undefined) throw new Error('没有可用的网页标签');
    return {...tab, id: tab.id};
}

async function enableHover(tab: chrome.tabs.Tab, mode: 'hover' | 'region' = 'hover'): Promise<void> {
    const {id} = identifiedTab(tab);
    await chrome.scripting.executeScript({target: {tabId: id}, files: ['hover.js']});
    await hoverReady;
    hoverTabs.add(id);
    saveHoverTabs();
    await sendPage(id, {type: 'hoverEnable', enabled: true, mode});
}

async function pick(mode: PickMode): Promise<void> {
    tasks.assertIdle();
    const tab = await activeTab();
    try {
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']});
        const result = object(await sendPage(tab.id, {type: 'pick', mode}));
        if (result.ok !== true) throw new Error('选区失败');
    } catch {
        throw new Error('无法读取此页面。请先点击当前标签的扩展图标授权；Chrome 内部页、商店和部分 PDF 请改用粘贴文字。');
    }
}

// 按实际图片与视口比例裁剪，截图前后都确认活动标签未变化。
async function screenshot(senderTab: chrome.tabs.Tab, rect: ScreenshotRect): Promise<Source> {
    const tab = await activeTab();
    if (tab.id !== senderTab.id || tab.windowId !== senderTab.windowId) throw new Error('标签已切换，请重新截图');
    const data = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'});
    if ((await activeTab()).id !== tab.id) throw new Error('标签已切换，请重新截图');
    const bitmap = await createImageBitmap(await (await fetch(data)).blob());
    const {x, y, width, height, viewportWidth, viewportHeight} = rect;
    const sx = bitmap.width / viewportWidth, sy = bitmap.height / viewportHeight;
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * sx)), Math.max(1, Math.round(height * sy)));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建截图画布');
    context.drawImage(bitmap, x * sx, y * sy, width * sx, height * sy, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const bytes = new Uint8Array(await (await canvas.convertToBlob({type: 'image/png'})).arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) throw new Error('截图超过 8 MB，请缩小范围');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return {mode: 'screenshot', text: '', image: 'data:image/png;base64,' + btoa(binary), title: tab.title || ''};
}

// 网页仅能调用选择器和已授权的悬停接口，不能借用侧栏权限。
async function fromPage(message: RuntimeRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
    const tab = identifiedTab(sender.tab);
    if (sender.frameId !== 0) throw new Error('选区来源无效');
    if (message.type === 'picked') {
        tasks.assertIdle();
        if (message.mode === 'screenshot') tasks.setSource(await screenshot(tab, message.rect));
        else {
            const text = message.text.trim();
            if (!text) throw new Error('此区域没有可提取的文字，可以尝试截图');
            tasks.setSource({mode: message.mode, text, title: tab.title || ''});
        }
        return;
    }
    await hoverReady;
    if (!hoverTabs.has(tab.id)) throw new Error('网页不能直接调用翻译后端');
    switch (message.type) {
        case 'hoverSettings': return chrome.sidePanel.open({windowId: tab.windowId});
        case 'hoverCacheLoad': return readPageCache(tab.id, sender.url || tab.url || '');
        case 'hoverDisable':
            hoverTabs.delete(tab.id);
            saveHoverTabs();
            if (tasks.origin.type === 'hover' && tasks.origin.tabId === tab.id) tasks.cancel();
            return;
        case 'hoverCancel':
            if (tasks.origin.type === 'hover' && tasks.origin.tabId === tab.id &&
                (!tasks.origin.documentId || tasks.origin.documentId === sender.documentId)) tasks.cancel(message.requestId);
            return;
        case 'hoverTranslate': return tasks.start({requestId: message.requestId, kind: message.kind, text: message.text,
            source: {mode: 'hover', text: message.text, title: tab.title || ''},
            origin: {type: 'hover', tabId: tab.id, url: sender.url || tab.url || '', paths: message.paths,
                ...(sender.documentId ? {documentId: sender.documentId} : {})}});
        default: throw new Error('网页不能直接调用翻译后端');
    }
}

async function fromPanel(message: RuntimeRequest): Promise<unknown> {
    switch (message.type) {
        case 'getState': return tasks.state;
        case 'enableHover': return enableHover(await activeTab());
        case 'connect': return tasks.connect();
        case 'pick': return pick(message.mode);
        case 'clear': return tasks.setSource(null);
        case 'cancel': return tasks.cancel();
        case 'translate': {
            const source = tasks.state.source ?? {mode: 'selection', text: message.text};
            if (!message.text.trim() && !source.image) throw new Error('请选择内容或粘贴文字');
            return tasks.start({requestId: crypto.randomUUID(), kind: 'translate', text: message.text,
                source, origin: {type: 'panel'}, options: message});
        }
        default: throw new Error('未知操作');
    }
}

chrome.runtime.onMessage.addListener((value: unknown, sender, respond) => {
    if (value && typeof value === 'object' && 'type' in value && value.type === 'state') return;
    void (async () => {
        if (sender.id !== chrome.runtime.id) throw new Error('无效调用方');
        const message = runtimeRequest(value);
        return sender.tab ? fromPage(message, sender) : fromPanel(message);
    })().then(data => respond({ok: true, data})).catch((error: unknown) => {
        // 非当前任务的错误只返回给调用方，不能污染正在显示的结果。
        const id = value && typeof value === 'object' && 'requestId' in value ? value.requestId : undefined;
        if (!tasks.state.busy || id === tasks.state.requestId) tasks.fail(error);
        respond({ok: false, error: errorText(error)});
    });
    return true;
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        for (const [id, title] of [['select-point', '点选'], ['select-region', '框选']] as const) {
            chrome.contextMenus.create({id, title,
                contexts: ['page', 'selection', 'link', 'image', 'video', 'audio'],
                documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*']});
        }
    });
});
chrome.action.onClicked.addListener(tab => {
    void enableHover(tab).catch(error => {
        tasks.fail(error);
        void chrome.sidePanel.open({windowId: tab.windowId}).catch(() => {});
    });
});
chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'enter-translation-mode' && tab?.id !== undefined) void enableHover(tab).catch(error => tasks.fail(error));
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || (info.menuItemId !== 'select-point' && info.menuItemId !== 'select-region')) return;
    const mode = info.menuItemId === 'select-point' ? 'hover' : 'region';
    void enableHover(tab, mode).catch(error => tasks.fail(error));
});

async function forgetTab(tabId: number): Promise<void> {
    await hoverReady;
    hoverTabs.delete(tabId);
    saveHoverTabs();
    tasks.forgetTab(tabId);
}
chrome.tabs.onRemoved.addListener(tabId => { void forgetTab(tabId); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading') void forgetTab(tabId); });
