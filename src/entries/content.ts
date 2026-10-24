import type {PickedPayload, PickMode} from '../shared/contracts';
import {send} from '../shared/messaging';
import {errorText, pageCommand} from '../shared/validation';

declare global { interface Window { __codexTranslatorPicker?: boolean } }

if (!window.__codexTranslatorPicker) {
    window.__codexTranslatorPicker = true;
    installPicker();
}

function installPicker(): void {
    let cleanup = () => {};
    chrome.runtime.onMessage.addListener((value: unknown, _sender, respond) => {
        let message;
        try { message = pageCommand(value); } catch { return; }
        if (message.type !== 'pick') return;
        void Promise.resolve().then(() => start(message.mode)).then(() => respond({ok: true}))
            .catch((error: unknown) => respond({ok: false, error: errorText(error)}));
        return true;
    });

    // 所有临时监听器随一次选择操作统一释放，避免逐个登记和移除。
    async function start(mode: PickMode): Promise<void> {
        cleanup();
        if (mode === 'selection') { await send({type: 'picked', mode, text: window.getSelection()?.toString() || ''}); return; }
        const controller = new AbortController();
        const host = document.createElement('div');
        host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
        const root = host.attachShadow({mode: 'closed'});
        const style = document.createElement('style');
        style.textContent = ':host{font-family:system-ui} .box{position:fixed;border:2px solid #22b8a0;background:#22b8a022;box-sizing:border-box;pointer-events:none}.tip{position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#102c2a;color:white;border-radius:12px;padding:12px 18px;font:14px system-ui;box-shadow:0 4px 24px #0004}.veil{position:fixed;inset:0;cursor:crosshair;pointer-events:auto;background:#0002}';
        const box = document.createElement('div');
        box.className = 'box';
        const tip = document.createElement('div');
        tip.className = 'tip';
        tip.textContent = mode === 'element' ? '点击选择区域 · ↑ 扩大到父元素 · ↓ 缩小 · Esc 取消' : '拖动框选截图 · Esc 取消';
        root.append(style, box, tip);
        document.documentElement.append(host);
        cleanup = () => { controller.abort(); host.remove(); cleanup = () => {}; };
        const draw = (rect: {x: number; y: number; width: number; height: number}) => Object.assign(box.style, {
            left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px'
        });
        const finish = async (payload: PickedPayload) => {
            cleanup();
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            try { await send({type: 'picked', ...payload}); }
            catch (error) { console.warn('Codex Translate:', errorText(error)); }
        };
        const options = {capture: true, signal: controller.signal};
        window.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); }
        }, options);
        if (mode === 'element') selectElement(options, draw, finish);
        else selectScreenshot(root, options, draw, finish, () => cleanup());
    }
}

type Draw = (rect: {x: number; y: number; width: number; height: number}) => void;
type Finish = (payload: PickedPayload) => Promise<void>;

// 元素模式拦截底层点击，方向键仅改变当前选中层级。
function selectElement(options: AddEventListenerOptions, draw: Draw, finish: Finish): void {
    let selected: HTMLElement | null = null;
    const previous: HTMLElement[] = [];
    window.addEventListener('keydown', event => {
        if (!selected || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'ArrowUp' && selected.parentElement) { previous.push(selected); selected = selected.parentElement; }
        else if (event.key === 'ArrowDown') selected = previous.pop() ?? selected;
        draw(selected.getBoundingClientRect());
    }, options);
    window.addEventListener('pointermove', event => {
        const element = document.elementFromPoint(event.clientX, event.clientY);
        selected = element instanceof HTMLElement ? element : null;
        previous.length = 0;
        if (selected) draw(selected.getBoundingClientRect());
    }, options);
    window.addEventListener('pointerdown', event => { event.preventDefault(); event.stopImmediatePropagation(); }, options);
    window.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (selected) void finish({mode: 'element', text: selected.innerText});
    }, options);
    window.addEventListener('scroll', () => { if (selected) draw(selected.getBoundingClientRect()); }, options);
}

// 只在遮罩中拖动；移除遮罩后再截屏，避免把选择器拍进图片。
function selectScreenshot(root: ShadowRoot, options: AddEventListenerOptions, draw: Draw, finish: Finish, cancel: () => void): void {
    const veil = document.createElement('div');
    veil.className = 'veil';
    root.prepend(veil);
    let start: {x: number; y: number} | undefined;
    const point = (event: PointerEvent) => ({x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY))});
    const area = (end: {x: number; y: number}, from: {x: number; y: number}) => ({
        x: Math.min(from.x, end.x), y: Math.min(from.y, end.y), width: Math.abs(end.x - from.x), height: Math.abs(end.y - from.y)
    });
    veil.addEventListener('pointerdown', event => {
        event.preventDefault();
        start = point(event);
        veil.setPointerCapture(event.pointerId);
    }, options);
    veil.addEventListener('pointermove', event => { if (start) draw(area(point(event), start)); }, options);
    veil.addEventListener('pointerup', event => {
        if (!start) return;
        const rect = area(point(event), start);
        start = undefined;
        if (rect.width >= 4 && rect.height >= 4) void finish({mode: 'screenshot', rect: {...rect, viewportWidth: innerWidth, viewportHeight: innerHeight}});
    }, options);
    window.addEventListener('resize', cancel, options);
}
