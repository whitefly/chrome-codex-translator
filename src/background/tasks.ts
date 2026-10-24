import type {NativeEvent, PanelState, Source, TaskKind, TaskOrigin, TranslationOptions} from '../shared/contracts';
import {readPreferences} from '../shared/preferences';
import {errorText} from '../shared/validation';
import {NativeClient} from './native-client';
import {rememberHover} from './page-cache';

interface TaskInput {
    requestId: string;
    kind: TaskKind;
    text: string;
    source: Source;
    origin: TaskOrigin;
    options?: TranslationOptions;
}
interface ActiveTask extends TaskInput {
    phase: 'preparing' | 'running' | 'cancelling';
    controller: AbortController;
}

// 侧栏和网页共享唯一任务；busy 从任务存在性推导，不另外维护。
export class Tasks {
    private active: ActiveTask | undefined;
    private view: Pick<PanelState, 'source' | 'result' | 'status' | 'error' | 'requestId'> = {
        source: null, result: '', status: '未连接', error: '', requestId: null
    };
    private location: TaskOrigin = {type: 'panel'};
    private readonly native = new NativeClient(event => this.receive(event), message => {
        this.active?.controller.abort();
        this.active = undefined;
        this.fail(message, '连接已断开');
    });

    constructor(private readonly changed: () => void) {}

    get origin(): TaskOrigin { return this.location; }

    get state(): PanelState {
        const info = this.native.info;
        return {...this.view, connected: !!info, models: info?.models ?? [], loggedIn: info?.loggedIn ?? false,
            authType: info?.authType ?? null, busy: !!this.active};
    }

    assertIdle(): void {
        if (this.active) throw new Error('已有翻译进行中，请先停止或等待完成');
    }

    fail(error: unknown, status = '出现错误'): void {
        this.view.error = errorText(error);
        this.view.status = status;
        this.changed();
    }

    connect(): void {
        this.assertIdle();
        this.view.error = '';
        this.view.status = '正在连接本机 Codex…';
        this.changed();
        void this.native.connect(true).catch(error => this.fail(error));
    }

    setSource(source: Source | null): void {
        this.assertIdle();
        this.location = {type: 'panel'};
        this.view = {source, result: '', error: '', requestId: null, status: source ? '选区已准备好，点击翻译' : '已清空'};
        this.changed();
    }

    // 准备、提交和错误收尾只有一条路径；入口只提供原文、来源和偏好。
    async start(input: TaskInput): Promise<void> {
        this.assertIdle();
        if (input.origin.type === 'panel' && !this.native.info?.loggedIn) throw new Error('请先连接并登录本机 Codex');
        const task: ActiveTask = {...input, phase: 'preparing', controller: new AbortController()};
        this.active = task;
        this.location = task.origin;
        this.view = {source: input.source, result: '', error: '', requestId: input.requestId, status: '正在连接…'};
        this.changed();
        try {
            const info = await this.ready(task.controller.signal);
            if (!info.loggedIn) throw new Error('请先登录本地 Codex，再点击重试');
            const options = task.options ?? await this.hoverOptions();
            if (this.active !== task) return;
            task.phase = 'running';
            this.view.status = task.kind === 'summary' ? '正在总结…' : '正在翻译…';
            this.native.send({type: 'translate', requestId: task.requestId, text: task.text, task: task.kind,
                language: options.language, ...(options.model ? {model: options.model} : {}),
                ...(options.effort ? {effort: options.effort} : {}),
                ...(task.source.image ? {image: task.source.image} : {})});
            this.changed();
        } catch (error) {
            if (this.active !== task) return;
            this.active = undefined;
            this.fail(error);
            throw error;
        }
    }

    cancel(requestId = this.active?.requestId): void {
        const task = this.active;
        if (!task || task.requestId !== requestId || task.phase === 'cancelling') return;
        if (task.phase === 'preparing') {
            this.active = undefined;
            task.controller.abort();
            this.view.status = '已取消';
        } else {
            task.phase = 'cancelling';
            this.native.send({type: 'cancel', requestId: task.requestId});
            this.view.status = '正在取消…';
        }
        this.changed();
    }

    forgetTab(tabId: number): void {
        if (this.location.type !== 'hover' || this.location.tabId !== tabId) return;
        this.cancel();
        this.location = {type: 'panel'};
    }

    private async ready(signal: AbortSignal) {
        let aborted = () => {};
        const cancelled = new Promise<never>((_, reject) => { aborted = () => reject(new Error('已取消')); });
        signal.addEventListener('abort', aborted, {once: true});
        try { return await Promise.race([this.native.connect(), cancelled]); }
        finally { signal.removeEventListener('abort', aborted); }
    }

    private async hoverOptions(): Promise<TranslationOptions> {
        const prefs = await readPreferences();
        const models = this.native.info?.models ?? [];
        const model = models.find(m => m.model === prefs.model) || models.find(m => m.isDefault) || models[0];
        if (!model) throw new Error('没有可用模型，请打开设置刷新');
        return {model: model.model, language: prefs.language,
            effort: model.supportedReasoningEfforts?.some(e => e.reasoningEffort === prefs.effort) ? prefs.effort : ''};
    }

    // 旧请求和取消后的增量直接丢弃；完成消息统一结束任务并保存成功结果。
    private receive(event: NativeEvent): void {
        if (event.type === 'ready') {
            if (!this.active) {
                this.view.status = event.loggedIn ? '就绪' : '请先在终端登录 Codex';
                this.view.error = '';
            }
            this.changed();
            return;
        }
        const task = this.active;
        if (event.type === 'error') {
            if (!event.requestId || event.requestId === task?.requestId) this.fail(event.message);
            return;
        }
        if (!task || event.requestId !== task.requestId) return;
        if (event.type === 'delta') {
            if (task.phase === 'cancelling') return;
            this.view.result += event.text;
        } else {
            const cancelled = event.cancelled || task.phase === 'cancelling';
            this.view.result = event.text;
            this.active = undefined;
            this.view.status = this.view.error ? '处理失败' : cancelled ? '已取消' : task.kind === 'summary' ? '总结完成' : '翻译完成';
            if (task.origin.type === 'hover' && !cancelled && !this.view.error) {
                void rememberHover(task.origin, task.text, task.kind, event.text).catch(() => {});
            }
        }
        this.changed();
    }
}
