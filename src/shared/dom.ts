// 静态模板缺少节点时立即暴露错误，调用处得到具体 DOM 类型。
export function required<T extends Element>(root: ParentNode, selector: string, kind: {new(): T}): T {
    const element = root.querySelector(selector);
    if (!(element instanceof kind)) throw new Error(`界面节点缺失或类型错误：${selector}`);
    return element;
}
