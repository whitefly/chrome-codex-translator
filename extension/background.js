const HOST = 'com.local.codex_translator';
let nativePort;
let connecting = false;
const hoverTabs = new Set();
let hoverRoute;
const PAGE_CACHE_LIMIT = 60;

function pageCacheKey(tabId, url) {
    if (typeof url !== 'string' || url.length > 2048) return null;
    try {
        const page = new URL(url);
        if (!['http:', 'https:'].includes(page.protocol)) return null;
        page.hash = '';
        return `pageCache:${tabId}:${page.href}`;
    } catch {
        return null;
    }
}

async function readPageCache(tabId, url) {
    const key = pageCacheKey(tabId, url);
    if (!key) return [];
    return (await chrome.storage.session.get(key))[key] || [];
}

async function rememberHover(route, result) {
    const key = pageCacheKey(route.tabId, route.url);
    if (!key || !result || !route.path) return;
    const entries = await readPageCache(route.tabId, route.url);
    const path = JSON.stringify(route.path);
    const existing = entries.find(entry => JSON.stringify(entry.path) === path && entry.source === route.text);
    const entry = existing || {path: route.path, source: route.text};
    entry[route.kind] = result;
    entry.updatedAt = Date.now();
    const updated = [entry, ...entries.filter(item => item !== existing)].slice(0, PAGE_CACHE_LIMIT);
    await chrome.storage.session.set({[key]: updated});
}

const hoverReady = chrome.storage?.session?.get('hoverTabs').then(saved => {
    for (const id of saved.hoverTabs || []) hoverTabs.add(id);
}).catch(() => {
}) || Promise.resolve();

function saveHoverTabs() {
    chrome.storage?.session?.set({hoverTabs: [...hoverTabs]}).catch(() => {
    });
}

let notifyTimer;
let sourceDirty = true;
let state = {
    connected: false, models: [], loggedIn: false, source: null,
    result: '', status: '未连接', busy: false, requestId: null, error: ''
};

function notify() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
        notifyTimer = undefined;
        const snapshot = {...state};
        if (!sourceDirty) delete snapshot.source;
        sourceDirty = false;
        chrome.runtime.sendMessage({type: 'state', state: snapshot}).catch(() => {
        });
        if (hoverRoute) {
            chrome.tabs.sendMessage(hoverRoute.tabId, {
                    type: 'hoverState', requestId: hoverRoute.requestId,
                    kind: hoverRoute.kind, result: state.result, status: state.status, error: state.error, busy: state.busy
                },
                hoverRoute.documentId ? {documentId: hoverRoute.documentId} : {frameId: 0}).catch(() => {
            });
        }
    }, 40);
}

function fail(error) {
    state.error = error.message || String(error);
    state.status = '出现错误';
    notify();
}

function connect() {
    if (connecting) return;
    if (!nativePort) {
        nativePort = chrome.runtime.connectNative(HOST);
        nativePort.onMessage.addListener(message => {
            if (message.type === 'ready') {
                connecting = false;
                Object.assign(state, {
                    connected: true, models: message.models, loggedIn: message.loggedIn,
                    authType: message.authType, status: message.loggedIn ? '就绪' : '请先在终端登录 Codex', error: ''
                });
            } else if (message.type === 'error') {
                if (message.requestId && message.requestId !== state.requestId) return;
                if (!message.requestId) connecting = false;
                fail(new Error(message.message));
            } else if (message.requestId === state.requestId) {
                if (message.type === 'delta') {
                    state.result += message.text;
                    state.status = hoverRoute?.kind === 'summary' ? '正在总结…' : '正在翻译…';
                }
                if (message.type === 'done') {
                    state.result = message.text;
                    state.busy = false;
                    state.status = state.error ? '处理失败' : message.cancelled ? '已取消' : hoverRoute?.kind === 'summary' ? '总结完成' : '翻译完成';
                    if (hoverRoute?.requestId === message.requestId && !hoverRoute.cancelled && !state.error && !message.cancelled) {
                        void rememberHover(hoverRoute, message.text).catch(() => {
                        });
                    }
                }
            }
            notify();
        });
        nativePort.onDisconnect.addListener(() => {
            const error = chrome.runtime.lastError?.message;
            nativePort = undefined;
            connecting = false;
            Object.assign(state, {
                connected: false, busy: false, status: '连接已断开',
                error: error || '本地桥接程序已退出，请重新连接'
            });
            notify();
        });
    }
    connecting = true;
    state.status = '正在连接本机 Codex…';
    state.error = '';
    nativePort.postMessage({type: 'connect'});
    notify();
}

async function activeTab() {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) throw new Error('没有可用的网页标签');
    return tab;
}

async function pick(mode) {
    if (state.busy) throw new Error('请先取消或等待当前翻译');
    const tab = await activeTab();
    try {
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']});
        const result = await chrome.tabs.sendMessage(tab.id, {type: 'pick', mode});
        if (!result?.ok) throw new Error(result?.error || '选区失败');
    } catch {
        throw new Error('无法读取此页面。请先点击当前标签的扩展图标授权；Chrome 内部页、商店和部分 PDF 请改用粘贴文字。');
    }
}

function setSource(source) {
    if (state.busy) throw new Error('请先取消当前翻译');
    hoverRoute = undefined;
    state.source = source;
    sourceDirty = true;
    state.result = '';
    state.error = '';
    state.status = '选区已准备好，点击翻译';
    notify();
}

async function acceptSelection(message, sender) {
    if (!sender.tab || sender.frameId !== 0) throw new Error('选区来源无效');
    if (state.busy) throw new Error('请先取消当前翻译');
    if (message.mode !== 'screenshot') {
        const text = String(message.text || '').trim();
        if (!text) throw new Error('此区域没有可提取的文字，可以尝试截图');
        if (text.length > 30000) throw new Error('选区超过 30,000 字符，请缩小范围');
        setSource({mode: message.mode, text, title: sender.tab.title || ''});
        return;
    }
    const tab = await activeTab();
    if (tab.id !== sender.tab.id || tab.windowId !== sender.tab.windowId) throw new Error('标签已切换，请重新截图');
    const {x, y, width, height, viewportWidth, viewportHeight} = message.rect;
    if (![x, y, width, height, viewportWidth, viewportHeight].every(Number.isFinite) ||
        width < 4 || height < 4 || x < 0 || y < 0 || x + width > viewportWidth + 1 || y + height > viewportHeight + 1) {
        throw new Error('截图范围无效');
    }
    const data = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'});
    if ((await activeTab()).id !== tab.id) throw new Error('标签已切换，请重新截图');
    const bitmap = await createImageBitmap(await (await fetch(data)).blob());
    const sx = bitmap.width / viewportWidth, sy = bitmap.height / viewportHeight;
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * sx)), Math.max(1, Math.round(height * sy)));
    canvas.getContext('2d').drawImage(bitmap, x * sx, y * sy, width * sx, height * sy, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const bytes = new Uint8Array(await (await canvas.convertToBlob({type: 'image/png'})).arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) throw new Error('截图超过 8 MB，请缩小范围');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    setSource({mode: 'screenshot', text: '', image: 'data:image/png;base64,' + btoa(binary), title: tab.title || ''});
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => chrome.contextMenus.create({
        id: 'translate',
        title: '使用 Codex 翻译选中文字',
        contexts: ['selection']
    }));
});
chrome.action.onClicked.addListener(tab => {
    enableHover(tab).catch(error => {
        fail(error);
        chrome.sidePanel.open({windowId: tab.windowId}).catch(() => {
        });
    });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'translate') return;
    chrome.sidePanel.open({windowId: tab.windowId}).catch(fail);
    try {
        if ((info.selectionText || '').length > 30000) throw new Error('选区超过 30,000 字符');
        setSource({mode: 'selection', text: info.selectionText || '', title: tab.title || ''});
    } catch (error) {
        fail(error);
    }
});
chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'enter-translation-mode' && tab?.id) enableHover(tab).catch(fail);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'state') return;
    (async () => {
        if (sender.id !== chrome.runtime.id) throw new Error('无效调用方');
        if (sender.tab) {
            if (message.type === 'picked') return acceptSelection(message, sender);
            if (!hoverTabs.has(sender.tab.id)) await hoverReady;
            if (sender.frameId === 0 && hoverTabs.has(sender.tab.id)) {
                if (message.type === 'hoverSettings') return chrome.sidePanel.open({windowId: sender.tab.windowId});
                if (message.type === 'hoverCacheLoad') return readPageCache(sender.tab.id, sender.url || sender.tab.url);
                if (message.type === 'hoverDisable') {
                    hoverTabs.delete(sender.tab.id);
                    saveHoverTabs();
                    if (hoverRoute?.tabId === sender.tab.id) cancelHover(hoverRoute.requestId);
                    return;
                }
                if (message.type === 'hoverTranslate') return translateHover(message, sender);
                if (message.type === 'hoverCancel' && hoverRoute?.tabId === sender.tab.id && (!hoverRoute.documentId || hoverRoute.documentId === sender.documentId)) {
                    cancelHover(message.requestId);
                    return;
                }
            }
            throw new Error('网页不能直接调用翻译后端');
        }
        switch (message.type) {
            case 'getState':
                return state;
            case 'enableHover':
                return enableHover(await activeTab());
            case 'connect':
                connect();
                break;
            case 'pick':
                await pick(message.mode);
                break;
            case 'clear':
                if (state.busy) throw new Error('请先取消当前翻译');
                sourceDirty = true;
                Object.assign(state, {source: null, result: '', error: '', status: '已清空'});
                notify();
                break;
            case 'translate': {
                if (state.busy) throw new Error('已有翻译进行中');
                if (!state.connected || !state.loggedIn || !nativePort) throw new Error('请先连接并登录本机 Codex');
                const source = state.source || {};
                const text = message.text || '';
                if (text.length > 30000) throw new Error('文本最多 30,000 字符');
                if (!text.trim() && !source.image) throw new Error('请选择内容或粘贴文字');
                hoverRoute = undefined;
                const requestId = crypto.randomUUID();
                Object.assign(state, {busy: true, requestId, result: '', error: '', status: '正在提交…'});
                nativePort.postMessage({
                    type: 'translate', requestId, text, image: source.image,
                    model: message.model, effort: message.effort, language: message.language
                });
                notify();
                break;
            }
            case 'cancel':
                if (state.busy && nativePort) {
                    nativePort.postMessage({type: 'cancel', requestId: state.requestId});
                    state.status = '正在取消…';
                    notify();
                }
                break;
            default:
                throw new Error('未知操作');
        }
    })().then(data => respond({ok: true, data})).catch(error => {
        if (!state.busy || message.requestId === state.requestId) fail(error);
        respond({ok: false, error: error.message});
    });
    return true;
});

async function enableHover(tab) {
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['hover.js']});
    await hoverReady;
    hoverTabs.add(tab.id);
    saveHoverTabs();
    await chrome.tabs.sendMessage(tab.id, {type: 'hoverEnable', enabled: true});
}

function cancelHover(id) {
    if (hoverRoute?.requestId !== id || !state.busy) return;
    hoverRoute.cancelled = true;
    if (hoverRoute.sent && nativePort) nativePort.postMessage({type: 'cancel', requestId: id});
    state.status = '正在取消…';
    notify();
}

async function translateHover(message, sender) {
    if (state.busy) throw new Error('已有翻译进行中，请先停止或等待完成');
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 12000 || typeof message.requestId !== 'string' || message.requestId.length > 80) throw new Error('段落内容无效或过长');
    if (!['translate', 'summary'].includes(message.kind || 'translate')) throw new Error('不支持的处理类型');
    if (!Array.isArray(message.path) || message.path.length > 30 || !message.path.every(index => Number.isInteger(index) && index >= 0 && index <= 10000)) throw new Error('段落位置无效');
    const route = {
        tabId: sender.tab.id,
        documentId: sender.documentId,
        url: sender.url || sender.tab.url,
        requestId: message.requestId,
        text: message.text,
        path: message.path,
        kind: message.kind || 'translate',
        cancelled: false,
        sent: false
    };
    hoverRoute = route;
    state.source = {mode: 'hover', text: message.text, title: sender.tab.title || ''};
    sourceDirty = true;
    Object.assign(state, {busy: true, requestId: message.requestId, result: '', error: '', status: '正在连接…'});
    notify();
    try {
        if (!state.connected) {
            connect();
            const end = Date.now() + 40000;
            while (!state.connected && Date.now() < end && !route.cancelled) {
                await new Promise(resolve => setTimeout(resolve, 100));
                if (!connecting && !state.connected) throw new Error(state.error || '本地 Codex 连接失败');
            }
        }
        if (route.cancelled) {
            state.busy = false;
            state.status = '已取消';
            notify();
            return;
        }
        if (!state.connected || !state.loggedIn) throw new Error('请先登录本地 Codex，再点击重试');
        const prefs = await chrome.storage.local.get(['model', 'effort', 'language']);
        const model = state.models.find(m => m.model === prefs.model) || state.models.find(m => m.isDefault) || state.models[0];
        if (!model) throw new Error('没有可用模型，请打开设置刷新');
        const effort = model.supportedReasoningEfforts?.some(e => e.reasoningEffort === prefs.effort) ? prefs.effort : undefined;
        if (route.cancelled) {
            state.busy = false;
            state.status = '已取消';
            notify();
            return;
        }
        route.sent = true;
        state.status = route.kind === 'summary' ? '正在总结…' : '正在翻译…';
        nativePort.postMessage({
            type: 'translate', task: route.kind, requestId: message.requestId, text: message.text,
            model: model.model, effort, language: prefs.language || '简体中文'
        });
        notify();
    } catch (error) {
        state.busy = false;
        fail(error);
        throw error;
    }
}

chrome.tabs.onRemoved?.addListener(async tabId => {
    await hoverReady;
    hoverTabs.delete(tabId);
    saveHoverTabs();
    if (hoverRoute?.tabId === tabId) {
        cancelHover(hoverRoute.requestId);
        hoverRoute = undefined;
    }
});
chrome.tabs.onUpdated?.addListener(async (tabId, change) => {
    await hoverReady;
    if (change.status === 'loading') {
        hoverTabs.delete(tabId);
        saveHoverTabs();
        if (hoverRoute?.tabId === tabId) {
            cancelHover(hoverRoute.requestId);
            hoverRoute = undefined;
        }
    }
});
