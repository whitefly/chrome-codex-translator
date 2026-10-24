import type {NativeEvent, NativeRequest, ReadyMessage} from '../shared/contracts';
import {errorText, nativeEvent} from '../shared/validation';

interface PendingConnection {
    promise: Promise<ReadyMessage>;
    resolve: (info: ReadyMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

// 只管理连接与协议；任务、缓存和界面状态由调用者维护。
export class NativeClient {
    info: ReadyMessage | undefined;
    private port: chrome.runtime.Port | undefined;
    private pending: PendingConnection | undefined;

    constructor(private readonly receive: (event: NativeEvent) => void,
                private readonly disconnected: (message: string) => void) {}

    connect(refresh = false): Promise<ReadyMessage> {
        if (this.pending) return this.pending.promise;
        if (this.info && !refresh) return Promise.resolve(this.info);
        let resolve = (_info: ReadyMessage) => {};
        let reject = (_error: Error) => {};
        const promise = new Promise<ReadyMessage>((accept, fail) => { resolve = accept; reject = fail; });
        this.pending = {promise, resolve, reject,
            timer: setTimeout(() => this.close('本地 Codex 连接超时，请重试'), 40000)};
        try {
            this.port ??= this.open();
            this.send({type: 'connect'});
        } catch (error) { this.close(errorText(error)); }
        return promise;
    }

    send(message: NativeRequest): void {
        if (!this.port) throw new Error('本地桥接未连接');
        this.port.postMessage(message);
    }

    private settle(error?: Error): void {
        const pending = this.pending;
        this.pending = undefined;
        if (!pending) return;
        clearTimeout(pending.timer);
        if (error) pending.reject(error);
        else if (this.info) pending.resolve(this.info);
    }

    private close(message: string): void {
        const port = this.port;
        this.port = undefined;
        this.info = undefined;
        this.settle(new Error(message));
        port?.disconnect();
        this.disconnected(message);
    }

    private open(): chrome.runtime.Port {
        const port = chrome.runtime.connectNative('com.local.codex_translator');
        port.onMessage.addListener((value: unknown) => {
            if (this.port !== port) return;
            let event: NativeEvent;
            try { event = nativeEvent(value); }
            catch (error) { this.close(errorText(error)); return; }
            if (event.type === 'ready') {
                this.info = event;
                this.settle();
            } else if (event.type === 'error' && !event.requestId) {
                this.settle(new Error(event.message));
            }
            this.receive(event);
        });
        port.onDisconnect.addListener(() => {
            const message = chrome.runtime.lastError?.message || '本地桥接程序已退出，请重新连接';
            if (this.port === port) this.close(message);
        });
        return port;
    }
}
