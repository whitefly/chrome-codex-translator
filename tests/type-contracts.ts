import type {CacheEntry, PanelState, RuntimeRequest} from '../src/shared/contracts';
import {send} from '../src/shared/messaging';

// 仅由 tsc 检查，不运行：消息字段和返回值不匹配必须在编译期失败。
function checkContracts(): void {
    const state: Promise<PanelState> = send({type: 'getState'});
    const cache: Promise<CacheEntry[]> = send({type: 'hoverCacheLoad'});
    // @ts-expect-error 截图消息必须携带坐标，不能携带文字选区字段。
    const screenshot: RuntimeRequest = {type: 'picked', mode: 'screenshot', text: 'wrong'};
    // @ts-expect-error 处理类型不能是任意字符串。
    send({type: 'hoverTranslate', requestId: 'id', text: 'text', kind: 'other', paths: [[0]]});
    // @ts-expect-error getState 返回完整状态，不返回缓存数组。
    const wrongResult: Promise<CacheEntry[]> = send({type: 'getState'});
    void [state, cache, screenshot, wrongResult];
}
void checkContracts;
