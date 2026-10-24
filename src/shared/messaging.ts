import type {RequestResults, RuntimeRequest} from './contracts';
import {cacheEntries, object, panelState, text} from './validation';

export async function send<M extends RuntimeRequest>(message: M): Promise<RequestResults[M['type']]> {
    const response = object(await chrome.runtime.sendMessage(message));
    if (response.ok !== true) throw new Error(text(response.error ?? '扩展未响应，请刷新页面后重新启用'));
    const data = message.type === 'getState' ? panelState(response.data) :
        message.type === 'hoverCacheLoad' ? cacheEntries(response.data) : undefined;
    // 唯一的传输层断言：上面的解析器已按请求类型检查返回数据。
    return data as RequestResults[M['type']];
}
