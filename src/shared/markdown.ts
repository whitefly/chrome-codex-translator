import {Marked, type Token, type MarkedToken, type Tokens} from 'marked';
const lexer = new Marked({gfm: true, breaks: false});
const previous = new WeakMap<HTMLElement, {source: string; markdown: boolean; node: ChildNode | null}>();
const styles = `
    .md-output.md-rendered{white-space:normal!important;overflow-wrap:anywhere}
    .md-output p{margin:0 0 .75em;white-space:pre-wrap}
    .md-output h1,.md-output h2,.md-output h3,.md-output h4,.md-output h5,.md-output h6{color:inherit;font-weight:var(--md-heading-weight,700);line-height:1.4;margin:1em 0 .45em;letter-spacing:normal}
    .md-output h1{font-size:var(--md-h1-size,1.3em)}.md-output h2{font-size:var(--md-h2-size,1.18em)}.md-output h3,.md-output h4,.md-output h5,.md-output h6{font-size:var(--md-h3-size,1.06em)}
    .md-output ul,.md-output ol{margin:.4em 0 .8em;padding-left:1.6em}
    .md-output li{margin:.25em 0;white-space:pre-wrap}.md-output li>p{margin:.25em 0}
    .md-output li ul,.md-output li ol{margin:.2em 0}
    .md-output blockquote{border-left:3px solid currentColor;opacity:.85;margin:.7em 0;padding-left:.8em}
    .md-output code{font:var(--md-code-size,.9em) ui-monospace,monospace;background:#80908018;border-radius:4px;padding:.1em .3em;white-space:pre-wrap}
    .md-output pre{max-width:100%;overflow:auto;white-space:pre;margin:.7em 0;padding:.7em;background:#80908018;border-radius:6px}
    .md-output pre code{white-space:pre;overflow-wrap:normal;background:none;padding:0}
    .md-output .md-table{max-width:100%;overflow:auto;margin:.7em 0}
    .md-output table{border-collapse:collapse;font-size:var(--md-table-size,.9em);width:100%}
    .md-output th,.md-output td{border:1px solid #80908055;padding:.4em .6em;min-width:5em;text-align:left}
    .md-output hr{border:0;border-top:1px solid #80908055;margin:1em 0}
    .md-output>:first-child{margin-top:0}.md-output>:last-child{margin-bottom:0}
`;

export function install(root: HTMLElement | ShadowRoot) {
    const style = document.createElement('style');
    style.textContent = styles;
    root.append(style);
}

// 仅解码字符实体，绝不把模型文本交给 HTML 解析器。
function decode(text: string): string {
    const named: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0'};
    return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw: string, entity: string) => {
        if (entity[0] !== '#') return named[entity.toLowerCase()] || raw;
        const value = entity.charAt(1).toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : raw;
    });
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
}

function nodes(tokens: Token[]): DocumentFragment {
    const fragment = document.createDocumentFragment();
    for (const token of tokens) fragment.append(tokenNode(token));
    return fragment;
}

// 标签由词法类型白名单决定；HTML、链接和图片均只产生文字，不发起网络请求。
function tokenNode(token: Token): Node {
    if (!builtinToken(token)) return document.createTextNode(token.raw);
    switch (token.type) {
        case 'heading': {
            const node = element('h' + token.depth as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');
            node.append(nodes(token.tokens));
            return node;
        }
        case 'paragraph': case 'blockquote': case 'strong': case 'em': case 'del': {
            const tags = {paragraph: 'p', blockquote: 'blockquote', strong: 'strong', em: 'em', del: 'del'} as const;
            const node = element(tags[token.type]);
            node.append(nodes(token.tokens));
            return node;
        }
        case 'space': case 'def': return document.createTextNode('');
        case 'br': return element('br');
        case 'hr': return element('hr');
        case 'code': {
            const pre = element('pre');
            pre.append(element('code', token.text));
            return pre;
        }
        case 'codespan': return element('code', token.text);
        case 'list': return listNode(token);
        case 'table': return tableNode(token);
        case 'link': case 'image': {
            const span = element('span');
            span.append(nodes(token.tokens));
            const href = decode(token.href);
            if (href && href !== span.textContent) span.append(document.createTextNode(' (' + href + ')'));
            return span;
        }
        case 'text':
            return token.tokens ? nodes(token.tokens) : document.createTextNode(decode(token.text));
        case 'escape': return document.createTextNode(token.text);
        case 'html': return document.createTextNode(token.text);
        default: return document.createTextNode(token.raw || '');
    }
}

// 保留有序列表起始编号、嵌套层次和任务状态。
function builtinToken(token: Token): token is MarkedToken {
    // 本项目没有注册自定义 token，把上游 Generic 类型隔离在词法边界。
    return ['blockquote', 'br', 'checkbox', 'code', 'codespan', 'def', 'del', 'em', 'escape',
        'heading', 'hr', 'html', 'image', 'link', 'list', 'list_item', 'paragraph', 'space',
        'strong', 'table', 'text'].includes(token.type);
}

function listNode(token: Tokens.List) {
    const list = element(token.ordered ? 'ol' : 'ul');
    if (list instanceof HTMLOListElement && typeof token.start === 'number') list.start = token.start;
    for (const item of token.items) {
        const li = element('li');
        if (item.task) li.append(document.createTextNode(item.checked ? '☑ ' : '☐ '));
        li.append(nodes(item.tokens));
        list.append(li);
    }
    return list;
}

// 表格限制在结果区域内横向滚动，避免撑宽侧边栏或浮卡。
function tableNode(token: Tokens.Table) {
    const wrapper = element('div');
    wrapper.className = 'md-table';
    const table = element('table');
    for (const [index, cells] of [token.header, ...token.rows].entries()) {
        const row = element('tr');
        for (const cell of cells) {
            const node = element(index === 0 ? 'th' : 'td');
            node.append(nodes(cell.tokens));
            row.append(node);
        }
        table.append(row);
    }
    wrapper.append(table);
    return wrapper;
}

// 普通文本仍保留段落、编号及列表缩进，代码中的 Markdown 字符不被误删。
function plain(node: Node, indent = ''): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeName === 'BR') return '\n';
    if (node.nodeName === 'PRE') return node.textContent + '\n\n';
    if (node.nodeName === 'HR') return '\n';
    if (node instanceof HTMLUListElement || node instanceof HTMLOListElement) {
        const nested = node.parentNode?.nodeName === 'LI';
        return (nested ? '\n' : '') + [...node.children].map((li, index) => {
            const marker = node instanceof HTMLOListElement ? (node.start + index) + '. ' : '• ';
            const body = [...li.childNodes].map(child => plain(child, indent + '  ')).join('').trimEnd();
            return indent + marker + body + '\n';
        }).join('') + (nested ? '' : '\n');
    }
    const text = [...node.childNodes].map(child => plain(child, indent)).join('');
    if (node.nodeName === 'TD' || node.nodeName === 'TH') return text + '\t';
    if (node.nodeName === 'TR') return text.trimEnd() + '\n';
    return /^(P|H[1-6]|BLOCKQUOTE|TABLE)$/.test(node.nodeName) ? text + '\n\n' : text;
}

export function toPlain(source: string): string {
    return plain(nodes(lexer.lexer(source))).trimEnd();
}

// 两个界面复用同一渲染入口；状态更新但文本未变时跳过重复解析。
export function render(target: HTMLElement, source: string, markdown: boolean) {
    const last = previous.get(target);
    if (last?.source === source && last.markdown === markdown && last.node === target.firstChild) return;
    target.classList.add('md-output');
    target.classList.toggle('md-rendered', markdown);
    const content = nodes(lexer.lexer(source));
    if (markdown) target.replaceChildren(content);
    else target.textContent = plain(content).trimEnd();
    previous.set(target, {source, markdown, node: target.firstChild});
}

