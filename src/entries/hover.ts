import type {CacheEntry, Paths, TaskKind} from '../shared/contracts';
import {createHoverView, matchAppearance} from '../page/hover-view';
import {send} from '../shared/messaging';
import * as markdown from '../shared/markdown';
import {errorText, pageCommand, taskKind} from '../shared/validation';
import * as selection from '../page/region-selection';
import type {PageSelection} from '../page/region-selection';

declare global { interface Window { __codexHover?: boolean } }
interface Point {x: number; y: number}
interface SavedRecord extends CacheEntry {
    selection: PageSelection;
    marker?: HTMLButtonElement | undefined;
    lastKind?: TaskKind;
}

if (!window.__codexHover) {
    window.__codexHover = true;
    installHover();
}

// 每个文档仅初始化一次；交互状态与当前模型请求分别管理。
function installHover(): void {
    let enabled = false, keyHeld = false;
    let target: PageSelection | null | undefined, anchor: PageSelection | null | undefined;
    let timer: number | undefined, frame: number | undefined;
    let request: {id: string; phase: 'running' | 'finished'} | undefined;
    const isBusy = () => request?.phase === 'running';
    let kind: TaskKind = 'translate', result = '';
    const records = new Map<string, SavedRecord>();
    let region: 'hover' | 'selecting' | 'selected' = 'hover';
    let drag: {id: number; start: Point; end: Point} | undefined;
    let candidates: HTMLElement[] = [], regionFrame: number | undefined;
    const {host, root, $} = createHoverView();
    let markdownEnabled = true, formatChanged = false;
    markdown.install(root);
    // 监听先于初次读取，避免启动期间的旧偏好覆盖用户刚切换的格式。
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.markdown) return;
        formatChanged = true;
        updateFormat(changes.markdown.newValue !== false);
    });
    chrome.storage.local.get('markdown').then(preferences => {
        if (!formatChanged) updateFormat(preferences.markdown !== false);
    }).catch(() => error('无法读取显示偏好，请刷新页面后重试'));

    function updateFormat(value: boolean) {
        markdownEnabled = value;
        if (result && !$('.body').classList.contains('error')) {
            markdown.render($('.body'), result, markdownEnabled);
            schedulePosition();
        }
    }
    function recordKey(paths: Paths, text: string) {
        return JSON.stringify(paths) + '\u0000' + text;
    }

    function recordFor(value: PageSelection | null | undefined) {
        return value ? records.get(recordKey(value.paths, value.source)) : null;
    }

    // 每次定位校验整组原文，变动的内容不再显示旧标记。
    function drawMarkers() {
        for (const record of records.values()) {
            let value: PageSelection | null = record.selection;
            if (!selection.current(value)) value = selection.restore(record.paths, record.source);
            if (!value) {
                record.marker?.remove();
                record.marker = undefined;
                continue;
            }
            record.selection = value;
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
            const rect = selection.bounds(value);
            record.marker.hidden = !enabled || (region === 'selecting') || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth;
            if (!record.marker.hidden) Object.assign(record.marker.style, {
                left: Math.max(8, Math.min(rect.right - 38, innerWidth - 58)) + 'px',
                top: Math.max(8, Math.min(rect.top - 25, innerHeight - 30)) + 'px'
            });
        }
    }

    // 成功结果按完整选区保存，防止多元素结果覆盖单段落缓存。
    function remember(value: PageSelection | null | undefined, text: string, operation: TaskKind) {
        if (!selection.current(value) || !value.source || !text) return;
        const key = recordKey(value.paths, value.source);
        const record: SavedRecord = records.get(key) || {paths: value.paths, source: value.source, selection: value};
        record[operation] = text;
        record.lastKind = operation;
        record.selection = value;
        records.set(key, record);
        // Match the background cache's per-page limit.
        while (records.size > 60) {
            const first = records.keys().next().value;
            if (first === undefined) break;
            records.get(first)?.marker?.remove();
            records.delete(first);
        }
        drawMarkers();
    }

    // 只恢复路径和原文均匹配的当前页面缓存。
    async function loadSaved() {
        try {
            const saved = await send({type: 'hoverCacheLoad'});
            for (const item of saved) {
                const value = selection.restore(item.paths, item.source);
                if (!value) continue;
                const key = recordKey(item.paths, item.source);
                if (!records.has(key)) records.set(key, {...item, selection: value});
            }
            drawMarkers();
        } catch { /* Current-document cache remains available if session storage is unavailable. */
        }
    }

    function cancel() {
        if (request && isBusy()) void send({type: 'hoverCancel', requestId: request.id}).catch(() => {
        });
    }

    function hideTriggers() {
        root.querySelectorAll<HTMLButtonElement>('.trigger').forEach(button => button.hidden = true);
    }

    // 关闭时一并撤销选区与任务，让迟到的结果失去接收目标。
    function close() {
        clearRegion();
        clearTimeout(timer);
        cancel();
        request = undefined;
        anchor = undefined;
        target = undefined;
        $('.card').hidden = true;
        $('.hint').hidden = true;
        hideTriggers();
    }

    function setEnabled(value: boolean) {
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
        void send({type: 'hoverDisable'}).catch(() => {
        });
    }

    function block(element: EventTarget | null) {
        if (!(element instanceof Element) || element === host || element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return null;
        const candidate = element.closest<HTMLElement>('p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,pre,figcaption,[role="paragraph"]') || element.closest<HTMLElement>('div,section,article');
        if (!candidate || candidate === document.body || candidate === document.documentElement) return null;
        const value = selection.fromElements([candidate]), rect = candidate.getBoundingClientRect();
        return value?.source && value.source.length <= 12000 && rect.width > 5 && rect.height > 5 ? value : null;
    }

    // 清理矩形、指针捕获和待绘制帧，退出或重选时不保留旧选区。
    function clearRegion() {
        const pointerId = drag?.id;
        drag = undefined;
        if (pointerId !== undefined && $('.region-veil').hasPointerCapture(pointerId)) $('.region-veil').releasePointerCapture(pointerId);
        candidates = [];
        region = 'hover';
        if (regionFrame !== undefined) cancelAnimationFrame(regionFrame);
        regionFrame = undefined;
        $('.region-veil').hidden = true;
        $('.region-box').hidden = true;
        $('.region-tip').hidden = true;
        $('.region-hits').replaceChildren();
        $('.region-start').textContent = '框选';
    }

    function drawRect(element: HTMLElement, rect: {left: number; top: number; width: number; height: number}) {
        Object.assign(element.style, {
            left: rect.left + 'px', top: rect.top + 'px',
            width: rect.width + 'px', height: rect.height + 'px'
        });
    }

    function drawRegionHits(elements: HTMLElement[]) {
        $('.region-hits').replaceChildren(...elements.slice(0, 200).map(element => {
            const hint = document.createElement('div');
            hint.className = 'region-hit';
            drawRect(hint, element.getBoundingClientRect());
            return hint;
        }));
    }

    // 框选必须由用户显式开启，正常阅读时不拦截网页拖动和文字选择。
    function startRegion() {
        close();
        keyHeld = false;
        region = 'selecting';
        $('.region-veil').hidden = false;
        $('.region-tip').hidden = false;
        $('.region-tip').textContent = '按住鼠标左键拖动 · 相交内容块整块选中 · Esc 取消';
        $('.region-start').textContent = '重新框选';
        drawMarkers();
    }

    function dragPoint(event: PointerEvent) {
        return {x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY))};
    }

    function dragRect(drag: {start: Point; end: Point}) {
        return {
            left: Math.min(drag.start.x, drag.end.x), top: Math.min(drag.start.y, drag.end.y),
            right: Math.max(drag.start.x, drag.end.x), bottom: Math.max(drag.start.y, drag.end.y),
            width: Math.abs(drag.end.x - drag.start.x), height: Math.abs(drag.end.y - drag.start.y)
        };
    }

    function regionError(value: PageSelection | null | undefined) {
        if (!value?.source) return '没有选中正文，请重新拖动';
        if (value.elements.length > 200) return '选区超过 200 个内容块，请缩小范围';
        if (value.source.length > 12000) return '选区超过 12,000 字符，请缩小范围';
        return '';
    }

    // 每帧合并鼠标移动，实时展示实际选中的块和超限提示。
    function updateRegion() {
        regionFrame = undefined;
        if (!drag) return;
        const rect = dragRect(drag);
        drawRect($('.region-box'), rect);
        $('.region-box').hidden = false;
        const hits = rect.width >= 4 && rect.height >= 4 ? selection.hitTest(candidates, rect) : [];
        target = selection.fromElements(hits);
        drawRegionHits(hits);
        $('.region-tip').textContent = regionError(target) || `已选 ${hits.length} 个内容块 · ${target?.source.length ?? 0} 字符 · 松开后点击「译 / 总」`;
    }

    $('.region-start').onclick = event => {
        if (event.isTrusted && enabled) startRegion();
    };
    $('.region-veil').addEventListener('pointerdown', event => {
        if (!event.isTrusted || event.button !== 0 || !event.isPrimary || drag) return;
        event.preventDefault();
        event.stopPropagation();
        candidates = selection.candidates();
        drag = {id: event.pointerId, start: dragPoint(event), end: dragPoint(event)};
        $('.region-veil').setPointerCapture(event.pointerId);
        updateRegion();
    });
    $('.region-veil').addEventListener('pointermove', event => {
        if (!event.isTrusted || (!drag || event.pointerId !== drag.id)) return;
        drag.end = dragPoint(event);
        if (!regionFrame) regionFrame = requestAnimationFrame(updateRegion);
    });
    // 松开后固定选区，等用户选择操作；不会自动调用模型或点击底层链接。
    $('.region-veil').addEventListener('pointerup', event => {
        if (!event.isTrusted || (!drag || event.pointerId !== drag.id)) return;
        event.preventDefault();
        event.stopPropagation();
        drag.end = dragPoint(event);
        if (regionFrame !== undefined) cancelAnimationFrame(regionFrame);
        updateRegion();
        drag = undefined;
        $('.region-veil').releasePointerCapture(event.pointerId);
        $('.region-box').hidden = true;
        if (regionError(target)) return;
        region = 'selected';
        $('.region-veil').hidden = true;
        $('.region-tip').textContent = `已选 ${target?.elements.length ?? 0} 个内容块 · 点击「译 / 总」 · Esc 取消`;
        root.querySelectorAll<HTMLButtonElement>('.trigger').forEach(button => button.hidden = false);
        position();
    });
    $('.region-veil').addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    $('.region-veil').addEventListener('lostpointercapture', () => {
        if (drag) { close(); drawMarkers(); }
    });
    $('.region-veil').addEventListener('pointercancel', () => { close(); drawMarkers(); });

    // 浮卡跟随整组选区的外接矩形，并限制在当前视口内。
    function position() {
        frame = undefined;
        const element = anchor || target;
        if (!selection.connected(element)) {
            if (anchor) close();
            $('.hint').hidden = true;
            hideTriggers();
            drawMarkers();
            return;
        }
        const r = selection.bounds(element);
        if ((region === 'selected')) drawRegionHits(element.elements);
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
            matchAppearance($('.card'), $('.body'), element.elements);
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
        root.querySelectorAll<HTMLButtonElement>('.operation').forEach(button => {
            button.classList.toggle('active', button.dataset.kind === kind);
            button.disabled = isBusy();
        });
    }

    // 从缓存重新建立完整选区，切换操作时继续复用同一组内容。
    function showSaved(record: SavedRecord, operation: TaskKind = record.lastKind || (record.translate ? 'translate' : 'summary')) {
        if (!enabled || !selection.current(record.selection)) return;
        close();
        anchor = record.selection;
        region = anchor.elements.length > 1 ? 'selected' : 'hover';
        target = anchor;
        kind = operation;
        result = record[operation] || '';
        request = undefined;
        renderResult('本页暂存');
        position();
    }

    function error(message: string) {
        if (request) request.phase = 'finished';
        renderResult('未完成', message);
    }

    function renderResult(status: string, error = '', placeholder?: string) {
        const busy = isBusy();
        $('.card').hidden = false;
        $('.body').classList.toggle('error', !!error);
        if (result && !error) markdown.render($('.body'), result, markdownEnabled);
        else {
            $('.body').classList.remove('md-rendered');
            $('.body').textContent = error || placeholder || (busy ? (kind === 'summary' ? '正在总结…' : '正在翻译…') : '没有收到结果');
        }
        $('.status').textContent = status;
        $('.stop').hidden = !busy;
        $('.retry').hidden = busy;
        $('.copy').hidden = !result || !!error;
        showTabs();
    }

    // 一个选区只发起一个请求，翻译与总结共享其完整文本及定位路径。
    async function run(operation: TaskKind, force = false) {
        if (!enabled || !selection.current(target) || isBusy()) return;
        const saved = recordFor(target);
        if (!force && saved?.[operation]) return showSaved(saved, operation);
        anchor = target;
        result = '';
        kind = operation;
        const id = crypto.randomUUID();
        request = {id, phase: 'running'};
        clearTimeout(timer);
        hideTriggers();
        $('.region-tip').hidden = true;
        renderResult(operation === 'summary' ? '准备总结' : '准备翻译', '', '正在连接本机 Codex…');
        position();
        try {
            await send({type: 'hoverTranslate', requestId: id, text: anchor.source, kind: operation, paths: anchor.paths});
        } catch (e) {
            if (request?.id === id) error(errorText(e));
        }
    }

    // 普通悬停只更新单段落；框选过程中和选定后保持用户选择不变。
    function hover(event: PointerEvent) {
        if (!event.isTrusted || !enabled || region !== 'hover' || !$('.card').hidden || event.composedPath().includes(host)) return;
        const next = block(event.target);
        keyHeld = event.altKey;
        if (next?.elements[0] === target?.elements[0]) return;
        clearTimeout(timer);
        target = next;
        hideTriggers();
        $('.hint').hidden = true;
        if (!target) return;
        position();
        timer = setTimeout(() => {
            if (!enabled || !target) return;
            if (!recordFor(target)) root.querySelectorAll<HTMLButtonElement>('.trigger').forEach(button => button.hidden = false);
            if (keyHeld) void run('translate');
        }, 450);
    }

    window.addEventListener('pointermove', hover, true);
    window.addEventListener('keydown', event => {
        if (!enabled || !event.isTrusted) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            if ((region === 'selecting') || ((region === 'selected') && $('.card').hidden)) {
                close();
                drawMarkers();
            } else disable();
            return;
        }
        if (region === 'hover' && event.key === 'Alt' && !event.repeat && !(event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]'))) {
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
        if (drag) { close(); drawMarkers(); }
        keyHeld = false;
        clearTimeout(timer);
    });
    window.addEventListener('scroll', () => {
        if (drag) { close(); drawMarkers(); }
        if (enabled) schedulePosition();
    }, true);
    window.addEventListener('resize', () => {
        if (region === 'selecting') { close(); drawMarkers(); }
        if (enabled) schedulePosition();
    });
    $('.trigger.translate').onclick = event => {
        if (event.isTrusted) void run('translate');
    };
    $('.trigger.summary').onclick = event => {
        if (event.isTrusted) void run('summary');
    };
    root.querySelectorAll<HTMLButtonElement>('.operation').forEach(button => button.onclick = () => {
        if (!isBusy()) {
            target = anchor;
            void run(taskKind(button.dataset.kind));
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
            await navigator.clipboard.writeText(markdownEnabled ? result : markdown.toPlain(result));
            $('.status').textContent = '已复制';
        } catch {
            $('.status').textContent = '请选中结果手动复制';
        }
    };
    root.querySelectorAll<HTMLButtonElement>('.settings').forEach(button => button.onclick = () => send({type: 'hoverSettings'}).catch(e => {
        if (anchor) error(errorText(e));
    }));
    chrome.runtime.onMessage.addListener((value: unknown, _sender, respond) => {
        let message;
        try { message = pageCommand(value); } catch { return; }
        if (message.type === 'hoverEnable') {
            setEnabled(message.enabled);
            if (message.enabled && message.mode === 'region') startRegion();
            respond({ok: true});
        }
        if (message.type === 'pick') setEnabled(false);
        if (message.type === 'hoverState' && request && message.requestId === request.id) {
            request.phase = message.busy ? 'running' : 'finished';
            result = message.result || '';
            renderResult(message.status, message.error);
            if (!isBusy() && !message.error && result && (message.status === '翻译完成' || message.status === '总结完成')) remember(anchor, result, kind);
            schedulePosition();
        }
    });
}
