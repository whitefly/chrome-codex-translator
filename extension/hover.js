(() => {
    if (window.__codexHover) return;
    window.__codexHover = true;
    let enabled = false, target, anchor, timer, keyHeld = false, requestId, busy = false, frame;
    let kind = 'translate', source = '', result = '';
    const records = new Map();
    const host = document.createElement('div');
    host.id = 'codex-hover-translator';
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;';
    const root = host.attachShadow({mode: 'open'});
    root.innerHTML = `<style>
    :host{font-family:system-ui,-apple-system,sans-serif;color-scheme:light}*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:0}button:focus-visible{outline:2px solid #179d82;outline-offset:2px}[hidden]{display:none!important}
    .hint{position:fixed;border:1.5px solid #168c73;border-radius:5px;background:#15866d08;pointer-events:none}
    .trigger{position:fixed;pointer-events:auto;background:#137b66;color:#fff;border-radius:8px;padding:7px 11px;box-shadow:0 3px 12px #163d302b;font:600 13px system-ui}.trigger.summary{background:#345b72}.marker{position:fixed;pointer-events:auto;background:#137b66;color:white;border-radius:7px;padding:3px 7px;font:600 11px system-ui;box-shadow:0 2px 9px #0003}.marker:hover{filter:brightness(1.1)}
    .card{position:fixed;pointer-events:auto;width:390px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;background:var(--surface,#fffffc);color:var(--ink,#233a32);border:1px solid var(--edge,#d6e5dc);border-radius:8px;box-shadow:0 5px 20px #0002;font:14px/1.8 system-ui;text-align:left}
    .head{position:sticky;top:0;background:var(--surface,#f3f8f3);display:flex;align-items:center;justify-content:space-between;padding:5px 12px;border-bottom:1px solid var(--edge,#e5ece3);gap:8px}.brand{font-size:10px;letter-spacing:1.4px;font-weight:750}.tools{display:flex;gap:8px}.tools button{background:none;color:var(--ink,#58746a);font-size:12px;padding:4px}.tools .operation{border-radius:5px}.tools .operation.active{background:var(--control,#eaf3eb);font-weight:700}
    .body{padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;min-height:0}.body.error{color:var(--error,#9b492a)}.foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 12px 8px;color:var(--ink,#6a7c71);font-size:11px}.foot button{background:var(--control,#eaf3eb);color:var(--ink,#176d57);border-radius:6px;padding:5px 9px;font-size:11px}
    .dock{position:fixed;right:18px;bottom:18px;pointer-events:auto;display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:10px;background:#183e33;color:white;box-shadow:0 4px 20px #0002;font:12px system-ui}.dock button{background:transparent;color:#d5ede1;padding:3px}
  </style><div class="hint" hidden></div><button class="trigger translate" hidden title="翻译此段 · 或按住 Option/Alt 悬停">译</button><button class="trigger summary" hidden title="总结此段">总</button><div class="markers"></div>
  <section class="card" hidden aria-label="段落译文或总结" role="dialog"><div class="head"><span class="brand">CODEX</span><div class="tools"><button class="operation active" data-kind="translate">翻译</button><button class="operation" data-kind="summary">总结</button><button class="settings" title="模型与语言设置">设置</button><button class="close" title="关闭结果" aria-label="关闭结果">✕</button></div></div><div class="body" aria-live="polite"></div><div class="foot"><span class="status"></span><div><button class="stop">停止</button> <button class="retry" hidden title="重新生成">重试</button> <button class="copy" hidden>复制</button></div></div></section>
  <div class="dock" hidden><span>悬停「译 / 总」 · Option/Alt 直译 · Esc 退出</span><button class="settings">设置</button><button class="disable" title="关闭当前页面的悬停翻译">✕</button></div>`;
    document.documentElement.append(host);
    const $ = selector => root.querySelector(selector);
    const call = async (type, params = {}) => {
        const response = await chrome.runtime.sendMessage({type, ...params});
        if (!response?.ok) throw new Error(response?.error || '扩展未响应，请刷新页面后重新启用');
        return response.data;
    };

    function pathFor(element) {
        const path = [];
        for (let node = element; node && node !== document.body; node = node.parentElement) {
            if (!node.parentElement) return null;
            path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
        }
        return path.length && path.length <= 30 ? path : null;
    }

    function findPath(path) {
        if (!Array.isArray(path)) return null;
        let node = document.body;
        for (const index of path) node = node?.children[index];
        return node || null;
    }

    function recordKey(path, text) {
        return JSON.stringify(path) + '\u0000' + text;
    }

    function recordFor(element) {
        const path = pathFor(element), text = element?.innerText?.trim();
        return path && text ? records.get(recordKey(path, text)) : null;
    }

    function drawMarkers() {
        for (const record of records.values()) {
            let element = record.element;
            if (!element?.isConnected) element = findPath(record.path);
            if (!element || element.innerText?.trim() !== record.source) {
                record.marker?.remove();
                record.marker = undefined;
                continue;
            }
            record.element = element;
            if (!record.marker) {
                const marker = document.createElement('button');
                marker.className = 'marker';
                marker.title = '查看本页暂存的译文或总结';
                marker.onclick = event => {
                    if (event.isTrusted) showSaved(record);
                };
                $('.markers').append(marker);
                record.marker = marker;
            }
            record.marker.textContent = record.translate && record.summary ? '译·总' : record.translate ? '已译' : '已总';
            const rect = element.getBoundingClientRect();
            record.marker.hidden = !enabled || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth;
            if (!record.marker.hidden) Object.assign(record.marker.style, {
                left: Math.max(8, Math.min(rect.right - 38, innerWidth - 58)) + 'px',
                top: Math.max(8, Math.min(rect.top - 25, innerHeight - 30)) + 'px'
            });
        }
    }

    function remember(element, value, operation) {
        const path = pathFor(element), original = element?.innerText?.trim();
        if (!path || !original || !value) return;
        const key = recordKey(path, original);
        const record = records.get(key) || {path, source: original, element};
        record[operation] = value;
        record.lastKind = operation;
        record.element = element;
        records.set(key, record);
        // Match the background cache's per-page limit.
        while (records.size > 60) {
            const first = records.keys().next().value;
            records.get(first)?.marker?.remove();
            records.delete(first);
        }
        drawMarkers();
    }

    async function loadSaved() {
        try {
            const saved = await call('hoverCacheLoad');
            for (const item of saved) {
                const element = findPath(item.path);
                if (!element || element.innerText?.trim() !== item.source) continue;
                const key = recordKey(item.path, item.source);
                if (!records.has(key)) records.set(key, {...item, element});
            }
            drawMarkers();
        } catch { /* Current-document cache remains available if session storage is unavailable. */
        }
    }

    function cancel() {
        if (requestId && busy) void call('hoverCancel', {requestId}).catch(() => {
        });
    }

    function hideTriggers() {
        root.querySelectorAll('.trigger').forEach(button => button.hidden = true);
    }

    function close() {
        cancel();
        requestId = undefined;
        busy = false;
        anchor = undefined;
        target = undefined;
        $('.card').hidden = true;
        $('.hint').hidden = true;
        hideTriggers();
    }

    function setEnabled(value) {
        enabled = value;
        clearTimeout(timer);
        keyHeld = false;
        if (!enabled) close();
        $('.dock').hidden = !enabled;
        drawMarkers();
        if (enabled) void loadSaved();
    }

    function disable() {
        setEnabled(false);
        void call('hoverDisable').catch(() => {
        });
    }

    function block(element) {
        if (!(element instanceof Element) || element === host || element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return null;
        const candidate = element.closest('p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,pre,figcaption,[role="paragraph"]') || element.closest('div,section,article');
        if (!candidate || candidate === document.body || candidate === document.documentElement) return null;
        const value = candidate.innerText?.trim(), rect = candidate.getBoundingClientRect();
        return value && value.length <= 12000 && rect.width > 5 && rect.height > 5 ? candidate : null;
    }

    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext('2d', {willReadFrequently: true});

    function rgba(color) {
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = color;
        colorContext.fillRect(0, 0, 1, 1);
        return Array.from(colorContext.getImageData(0, 0, 1, 1).data);
    }

    function matchAppearance(element) {
        const style = getComputedStyle(element), chain = [];
        for (let node = element; node; node = node.parentElement) chain.push(getComputedStyle(node).backgroundColor);
        let rgb = style.colorScheme === 'dark' ? [18, 18, 18] : [255, 255, 255];
        for (const color of chain.reverse()) {
            const c = rgba(color), alpha = c[3] / 255;
            rgb = rgb.map((value, index) => Math.round(c[index] * alpha + value * (1 - alpha)));
        }
        const surface = `rgb(${rgb.join(',')})`, dark = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 128;
        const card = $('.card');
        card.style.setProperty('--surface', surface);
        card.style.setProperty('--ink', style.color);
        card.style.setProperty('--edge', `color-mix(in srgb, ${style.color} 20%, ${surface})`);
        card.style.setProperty('--control', `color-mix(in srgb, ${style.color} 8%, ${surface})`);
        card.style.setProperty('--error', dark ? '#ffb49a' : '#9b492a');
        card.style.colorScheme = dark ? 'dark' : 'light';
        for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'direction']) $('.body').style[property] = style[property];
    }

    function position() {
        frame = undefined;
        const element = anchor || target;
        if (!element?.isConnected) {
            if (anchor) close();
            $('.hint').hidden = true;
            hideTriggers();
            drawMarkers();
            return;
        }
        const r = element.getBoundingClientRect();
        const visible = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        $('.hint').hidden = !visible;
        Object.assign($('.hint').style, {
            left: r.left + 'px',
            top: r.top + 'px',
            width: r.width + 'px',
            height: r.height + 'px'
        });
        if (anchor) {
            const card = $('.card');
            card.style.visibility = visible ? 'visible' : 'hidden';
            matchAppearance(element);
            const width = Math.min(Math.max(r.width, 240), Math.max(1, innerWidth - 24));
            card.style.width = width + 'px';
            const height = card.offsetHeight || 180;
            const below = r.bottom + 9, above = r.top - height - 9;
            const top = below + height <= innerHeight - 12 ? below : above >= 12 ? above : Math.max(12, innerHeight - height - 12);
            Object.assign(card.style, {
                left: Math.max(12, Math.min(r.left, innerWidth - width - 12)) + 'px',
                top: top + 'px'
            });
        } else {
            const left = Math.max(8, Math.min(r.right - 68, innerWidth - 80)),
                top = Math.max(8, Math.min(r.top - 30, innerHeight - 40));
            Object.assign($('.trigger.translate').style, {left: left + 'px', top: top + 'px'});
            Object.assign($('.trigger.summary').style, {left: (left + 36) + 'px', top: top + 'px'});
        }
        drawMarkers();
    }

    function schedulePosition() {
        if (!frame) frame = requestAnimationFrame(position);
    }

    function showTabs() {
        root.querySelectorAll('.operation').forEach(button => {
            button.classList.toggle('active', button.dataset.kind === kind);
            button.disabled = busy;
        });
    }

    function showSaved(record, operation = record.lastKind || (record.translate ? 'translate' : 'summary')) {
        if (!enabled || !record.element?.isConnected) return;
        close();
        anchor = record.element;
        target = anchor;
        source = record.source;
        kind = operation;
        result = record[operation] || '';
        requestId = undefined;
        busy = false;
        $('.card').hidden = false;
        $('.body').classList.remove('error');
        $('.body').textContent = result;
        $('.status').textContent = '本页暂存';
        $('.stop').hidden = true;
        $('.retry').hidden = false;
        $('.copy').hidden = !result;
        showTabs();
        position();
    }

    function error(message) {
        busy = false;
        $('.body').classList.add('error');
        $('.body').textContent = message;
        $('.status').textContent = '未完成';
        $('.stop').hidden = true;
        $('.retry').hidden = false;
        showTabs();
    }

    async function run(operation, force = false) {
        if (!enabled || !target?.isConnected || busy) return;
        const saved = recordFor(target);
        if (!force && saved?.[operation]) return showSaved(saved, operation);
        anchor = target;
        source = anchor.innerText.trim();
        result = '';
        busy = true;
        kind = operation;
        requestId = crypto.randomUUID();
        const id = requestId;
        clearTimeout(timer);
        hideTriggers();
        $('.card').hidden = false;
        $('.body').classList.remove('error');
        $('.body').textContent = '正在连接本机 Codex…';
        $('.status').textContent = operation === 'summary' ? '准备总结' : '准备翻译';
        $('.stop').hidden = false;
        $('.retry').hidden = true;
        $('.copy').hidden = true;
        showTabs();
        position();
        try {
            await call('hoverTranslate', {requestId: id, text: source, kind: operation, path: pathFor(anchor)});
        } catch (e) {
            if (requestId === id) error(e.message);
        }
    }

    function hover(event) {
        if (!event.isTrusted || !enabled || !$('.card').hidden || event.composedPath().includes(host)) return;
        const next = block(event.target);
        keyHeld = event.altKey;
        if (next === target) return;
        clearTimeout(timer);
        target = next;
        hideTriggers();
        $('.hint').hidden = true;
        if (!target) return;
        position();
        timer = setTimeout(() => {
            if (!enabled || !target) return;
            if (!recordFor(target)) root.querySelectorAll('.trigger').forEach(button => button.hidden = false);
            if (keyHeld) void run('translate');
        }, 450);
    }

    window.addEventListener('pointermove', hover, true);
    window.addEventListener('keydown', event => {
        if (!enabled || !event.isTrusted) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            disable();
            return;
        }
        if (event.key === 'Alt' && !event.repeat && !event.target.closest?.('input,textarea,[contenteditable="true"]')) {
            keyHeld = true;
            clearTimeout(timer);
            if (target && $('.card').hidden) timer = setTimeout(() => {
                if (keyHeld) void run('translate');
            }, 450);
        }
    }, true);
    window.addEventListener('keyup', event => {
        if (event.key === 'Alt') {
            keyHeld = false;
            clearTimeout(timer);
        }
    }, true);
    window.addEventListener('blur', () => {
        keyHeld = false;
        clearTimeout(timer);
    });
    window.addEventListener('scroll', () => {
        if (enabled) schedulePosition();
    }, true);
    window.addEventListener('resize', () => {
        if (enabled) schedulePosition();
    });
    $('.trigger.translate').onclick = event => {
        if (event.isTrusted) void run('translate');
    };
    $('.trigger.summary').onclick = event => {
        if (event.isTrusted) void run('summary');
    };
    root.querySelectorAll('.operation').forEach(button => button.onclick = () => {
        if (!busy) {
            target = anchor;
            void run(button.dataset.kind);
        }
    });
    $('.close').onclick = close;
    $('.disable').onclick = disable;
    $('.stop').onclick = () => {
        cancel();
        $('.status').textContent = '正在停止…';
    };
    $('.retry').onclick = () => {
        target = anchor;
        void run(kind, true);
    };
    $('.copy').onclick = async () => {
        try {
            await navigator.clipboard.writeText(result);
            $('.status').textContent = '已复制';
        } catch {
            $('.status').textContent = '请选中结果手动复制';
        }
    };
    root.querySelectorAll('.settings').forEach(button => button.onclick = () => call('hoverSettings').catch(e => {
        if (anchor) error(e.message);
    }));
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message.type === 'hoverEnable') {
            setEnabled(message.enabled);
            respond({ok: true});
        }
        if (message.type === 'pick') setEnabled(false);
        if (message.type === 'hoverState' && message.requestId === requestId) {
            busy = message.busy;
            result = message.result || '';
            $('.body').classList.toggle('error', !!message.error);
            $('.body').textContent = message.error || result || (busy ? (kind === 'summary' ? '正在总结…' : '正在翻译…') : '没有收到结果');
            $('.status').textContent = message.status;
            $('.stop').hidden = !busy;
            $('.retry').hidden = busy;
            $('.copy').hidden = !result;
            showTabs();
            if (!busy && !message.error && result && (message.status === '翻译完成' || message.status === '总结完成')) remember(anchor, result, kind);
            schedulePosition();
        }
    });
})();
