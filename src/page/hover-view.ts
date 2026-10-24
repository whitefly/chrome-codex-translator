import {required} from '../shared/dom';

// 固定模板仅初始化一次；模型内容只通过 Markdown 模块写入文本节点。
export function createHoverView() {
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
    .body{--md-h1-size:1.16em;--md-h2-size:1.1em;--md-h3-size:1.04em;--md-code-size:.96em;--md-table-size:1em;--md-heading-weight:600;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;min-height:0}.body.error{color:var(--error,#9b492a)}.foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 12px 8px;color:var(--ink,#6a7c71);font-size:11px}.foot button{background:var(--control,#eaf3eb);color:var(--ink,#176d57);border-radius:6px;padding:5px 9px;font-size:11px}
    .dock{position:fixed;right:18px;bottom:18px;max-width:calc(100vw - 36px);flex-wrap:wrap;pointer-events:auto;display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:10px;background:#183e33;color:white;box-shadow:0 4px 20px #0002;font:12px system-ui}.dock button{background:transparent;color:#d5ede1;padding:3px}
    .region-veil{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none;background:#0001}
    .region-box,.region-hit{position:fixed;pointer-events:none;border:2px solid #22b8a0;background:#22b8a022}.region-hit{border:1px solid #22b8a0;border-radius:4px;background:#22b8a014}
    .region-tip{position:fixed;left:50%;top:12px;transform:translateX(-50%);max-width:calc(100vw - 24px);padding:10px 14px;border-radius:8px;background:#183e33;color:white;font:13px/1.5 system-ui;pointer-events:none}
      </style><div class="region-veil" hidden></div><div class="region-hits"></div><div class="region-box" hidden></div><div class="region-tip" role="status" hidden></div><div class="hint" hidden></div><button class="trigger translate" hidden title="翻译此段 · 或按住 Option/Alt 悬停">译</button><button class="trigger summary" hidden title="总结此段">总</button><div class="markers"></div>
      <section class="card" hidden aria-label="段落译文或总结" role="dialog"><div class="head"><span class="brand">CODEX</span><div class="tools"><button class="operation active" data-kind="translate">翻译</button><button class="operation" data-kind="summary">总结</button><button class="settings" title="模型与语言设置">设置</button><button class="close" title="关闭结果" aria-label="关闭结果">✕</button></div></div><div class="body" aria-live="polite"></div><div class="foot"><span class="status"></span><div><button class="stop">停止</button> <button class="retry" hidden title="重新生成">重试</button> <button class="copy" hidden>复制</button></div></div></section>
      <div class="dock" hidden><span>悬停「译 / 总」 · Option/Alt 直译 · Esc 退出</span><button class="region-start" title="拖动矩形，选择所有相交的内容块">框选</button><button class="settings">设置</button><button class="disable" title="关闭当前页面的悬停翻译">✕</button></div>`;
    document.documentElement.append(host);
    const $ = (selector: string) => required(root, selector, HTMLElement);
    return {host, root, $};
}

const colorCanvas = document.createElement('canvas');
colorCanvas.width = colorCanvas.height = 1;
const colorContext = canvasContext(colorCanvas);

function rgba(color: string): [number, number, number, number] {
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = color;
    colorContext.fillRect(0, 0, 1, 1);
    const data = colorContext.getImageData(0, 0, 1, 1).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
}

// 按正文文本量选取主要排版，排除标题、代码与导航，避免首块样式放大整个结果。
function appearanceElement(elements: HTMLElement[]): HTMLElement {
    const blocks = 'p,li,blockquote,td,figcaption,[role="paragraph"]';
    const excluded = 'h1,h2,h3,h4,h5,h6,[role="heading"],pre,code,th,nav,[role="navigation"],strong,b,em,i';
    const candidates = new Set(elements.flatMap(element => [element, ...element.querySelectorAll<HTMLElement>(blocks)]));
    const groups = new Map<string, {element: HTMLElement; weight: number; regular: boolean}>();
    for (const element of candidates) {
        if (element.closest(excluded) || element.querySelector(blocks)) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility !== 'visible') continue;
        const weight = element.innerText.trim().length;
        if (!weight) continue;
        const key = [style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.lineHeight].join('|');
        const group = groups.get(key) || {element, weight: 0, regular: Number(style.fontWeight) < 600 && style.fontStyle === 'normal'};
        group.weight += weight;
        groups.set(key, group);
    }
    const values = [...groups.values()];
    const regular = values.filter(group => group.regular);
    const main = (regular.length ? regular : values).sort((a, b) => b.weight - a.weight)[0];
    if (main) return main.element;
    // 只有标题或强调文字时，以其正文容器为基准，避免再叠加 Markdown 标题倍率。
    const first = elements[0] ?? document.body;
    const heading = first.closest('h1,h2,h3,h4,h5,h6,[role="heading"],strong,b,em,i');
    return heading?.parentElement ?? first;
}

// 结果继承主要正文的字体和底色；滚动及缩放时重新读取，跟随网页响应式样式。
export function matchAppearance(card: HTMLElement, body: HTMLElement, elements: HTMLElement[]) {
    const element = appearanceElement(elements);
    const style = getComputedStyle(element), chain = [];
    for (let node: HTMLElement | null = element; node; node = node.parentElement) chain.push(getComputedStyle(node).backgroundColor);
    let rgb: [number, number, number] = style.colorScheme === 'dark' ? [18, 18, 18] : [255, 255, 255];
    for (const color of chain.reverse()) {
        const c = rgba(color), alpha = c[3] / 255;
        const blend = (index: 0 | 1 | 2) => Math.round(c[index] * alpha + rgb[index] * (1 - alpha));
        rgb = [blend(0), blend(1), blend(2)];
    }
    const surface = `rgb(${rgb.join(',')})`, dark = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 128;
    card.style.setProperty('--surface', surface);
    card.style.setProperty('--ink', style.color);
    card.style.setProperty('--edge', `color-mix(in srgb, ${style.color} 20%, ${surface})`);
    card.style.setProperty('--control', `color-mix(in srgb, ${style.color} 8%, ${surface})`);
    card.style.setProperty('--error', dark ? '#ffb49a' : '#9b492a');
    card.style.colorScheme = dark ? 'dark' : 'light';
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'direction'] as const) body.style[property] = style[property];
}


function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new Error('无法创建颜色画布');
    return context;
}
