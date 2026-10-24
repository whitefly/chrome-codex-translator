import type {Paths} from '../shared/contracts';
import {selectionPaths} from '../shared/validation';

export interface PageSelection {elements: HTMLElement[]; paths: Paths; source: string}
export interface Bounds {left: number; top: number; right: number; bottom: number}

const blocks = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,pre,figcaption,[role="paragraph"]';
const excluded = 'input,textarea,select,button,script,style,noscript,template,[contenteditable]:not([contenteditable="false"]),[role="textbox"],#codex-hover-translator';


// 只读取渲染中的正文，保留块级换行和代码缩进，排除表单及可编辑内容。
function readText(element: HTMLElement) {
    function visit(node: Node): string {
        if (node.nodeType === Node.TEXT_NODE) {
            if (!node.parentElement) return '';
            const space = getComputedStyle(node.parentElement).whiteSpace;
            return /pre|break-spaces/.test(space) ? (node.textContent || '') : (node.textContent || '').replace(/\s+/g, ' ');
        }
        if (!(node instanceof HTMLElement) || node.matches(excluded)) return '';
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility !== 'visible') return '';
        if (node.tagName === 'BR') return '\n';
        const value = Array.from(node.childNodes, visit).join('');
        return /^(inline|contents)/.test(style.display) ? value : '\n' + value + '\n';
    }
    return visit(element).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// DOM 路径只指向正文中的元素，避免记录扩展自身或无法恢复的根节点。
function pathFor(element: HTMLElement): number[] | null {
    const path: number[] = [];
    for (let node: HTMLElement | null = element; node && node !== document.body; node = node.parentElement) {
        if (!node.parentElement) return null;
        path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
    }
    return document.body.contains(element) && path.length && path.length <= 30 ? path : null;
}

export function fromElements(elements: HTMLElement[]): PageSelection | null {
    const paths = elements.map(pathFor);
    if (!elements.length || !paths.every((path): path is number[] => path !== null)) return null;
    return {elements, paths, source: elements.map(readText).join('\n\n')};
}

export function connected(selection: PageSelection | null | undefined): selection is PageSelection {
    return !!selection?.elements.length && selection.elements.every(element => element.isConnected);
}

export function current(selection: PageSelection | null | undefined): selection is PageSelection {
    return connected(selection) && selection.elements.map(readText).join('\n\n') === selection.source;
}

// 缓存必须同时匹配全部元素的位置和原文，任何一块变化都使该条失效。
export function restore(paths: Paths, source: string): PageSelection | null {
    try { selectionPaths(paths); } catch { return null; }
    const elements: HTMLElement[] = [];
    for (const path of paths) {
        let node: Element | undefined = document.body;
        for (const index of path) node = node?.children[index];
        if (!(node instanceof HTMLElement)) return null;
        elements.push(node);
    }
    const value = fromElements(elements);
    return value?.source === source ? value : null;
}

export function bounds(selection: PageSelection) {
    const rects = selection.elements.map(element => element.getBoundingClientRect());
    const left = Math.min(...rects.map(rect => rect.left)), top = Math.min(...rects.map(rect => rect.top));
    const right = Math.max(...rects.map(rect => rect.right)), bottom = Math.max(...rects.map(rect => rect.bottom));
    return {left, top, right, bottom, width: right - left, height: bottom - top};
}

function intersects(a: Bounds, b: Bounds) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// 裁掉视口和滚动容器遮住的区域，避免选中肉眼看不到的相邻内容。
function visibleRects(element: HTMLElement) {
    const clip = {left: 0, top: 0, right: innerWidth, bottom: innerHeight};
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
            clip.left = Math.max(clip.left, rect.left);
            clip.right = Math.min(clip.right, rect.right);
        }
        if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
            clip.top = Math.max(clip.top, rect.top);
            clip.bottom = Math.min(clip.bottom, rect.bottom);
        }
    }
    return Array.from(element.getClientRects(), rect => ({
        left: Math.max(rect.left, clip.left), top: Math.max(rect.top, clip.top),
        right: Math.min(rect.right, clip.right), bottom: Math.min(rect.bottom, clip.bottom)
    })).filter(rect => rect.right > rect.left && rect.bottom > rect.top);
}

// 从可见文字找到内容块；普通布局容器只有不含下级块时才作为候选。
export function candidates(): HTMLElement[] {
    const found = new Set<HTMLElement>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const node = walker.currentNode, parent = node.parentElement;
        if (!node.textContent?.trim() || !parent || parent.closest(excluded)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (!range.getClientRects().length || getComputedStyle(parent).visibility !== 'visible') continue;
        let element = parent.closest<HTMLElement>(blocks);
        if (!element) {
            element = parent.closest<HTMLElement>('div,section,article') || parent;
            if (element.querySelector(blocks + ',div,section,article')) continue;
        }
        if (element === document.body || element === document.documentElement || element.closest(excluded)) continue;
        found.add(element);
    }
    return Array.from(found).sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
}

// 按矩形相交取整块；只在已命中的集合内去除嵌套重复，不扩大到公共祖先。
export function hitTest(elements: HTMLElement[], rect: Bounds) {
    const hits = elements.filter(element => element.isConnected &&
        visibleRects(element).some(bounds => intersects(bounds, rect)));
    return hits.filter(element => !hits.some(other => other !== element && other.contains(element)));
}

