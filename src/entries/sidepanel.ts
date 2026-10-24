import type {PanelState} from '../shared/contracts';
import {required} from '../shared/dom';
import {send} from '../shared/messaging';
import * as markdown from '../shared/markdown';
import {readPreferences} from '../shared/preferences';
import {errorText, language, object, panelUpdate, pickMode} from '../shared/validation';

const controls = {
  'markdown': required(document, '#markdown', HTMLInputElement),
  'language': required(document, '#language', HTMLSelectElement),
  'extension-id': required(document, '#extension-id', HTMLElement),
  'error': required(document, '#error', HTMLElement),
  'model': required(document, '#model', HTMLSelectElement),
  'effort': required(document, '#effort', HTMLSelectElement),
  'status': required(document, '#status', HTMLElement),
  'dot': required(document, '#dot', HTMLElement),
  'connect': required(document, '#connect', HTMLButtonElement),
  'result': required(document, '#result', HTMLElement),
  'copy': required(document, '#copy', HTMLButtonElement),
  'cancel': required(document, '#cancel', HTMLButtonElement),
  'source': required(document, '#source', HTMLTextAreaElement),
  'clear': required(document, '#clear', HTMLButtonElement),
  'preview': required(document, '#preview', HTMLImageElement),
  'source-label': required(document, '#source-label', HTMLElement),
  'translate': required(document, '#translate', HTMLButtonElement),
  'hover': required(document, '#hover', HTMLButtonElement),
  'shortcut': required(document, '#shortcut', HTMLElement),
  'configure-shortcut': required(document, '#configure-shortcut', HTMLButtonElement)
};
const $ = <K extends keyof typeof controls>(id: K) => controls[id];
let current: PanelState | undefined;
let sourceKey: string | undefined, modelKey: string | undefined;
markdown.install(document.head);
const preferences = await readPreferences();
let markdownEnabled = preferences.markdown !== false;
$('markdown').checked = markdownEnabled;
$('language').value = preferences.language || '简体中文';
$('extension-id').textContent = chrome.runtime.id;
function showError(error: unknown) { $('error').textContent = errorText(error); $('error').hidden = false; }
function selectedModel() { return current?.models.find(model => model.model === $('model').value); }
function refreshEffort() {
  const model = selectedModel();
  $('effort').replaceChildren(new Option('模型默认', ''));
  for (const effort of model?.supportedReasoningEfforts || []) {
    $('effort').add(new Option(effort.reasoningEffort, effort.reasoningEffort));
  }
  if ([...$('effort').options].some(o => o.value === preferences.effort)) $('effort').value = preferences.effort;
  $('effort').disabled = !model || !!current?.busy;
}
// 根据后台状态刷新结果与控件，格式切换只重绘当前结果。
function render(state: PanelState) {
  current = state;
  $('status').textContent = state.status;
  $('dot').classList.toggle('online', state.connected && state.loggedIn);
  $('connect').textContent = state.connected ? '刷新模型' : '连接 Codex';
  $('connect').disabled = state.busy;
  $('error').hidden = !state.error;
  $('error').textContent = state.error;
  markdown.render($('result'), state.result || '译文会逐步显示在这里。', markdownEnabled);
  $('result').classList.toggle('empty', !state.result);
  $('copy').disabled = !state.result;
  $('cancel').hidden = !state.busy;
  $('source').disabled = state.busy;
  $('clear').disabled = state.busy;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.disabled = state.busy);
  const newSourceKey = JSON.stringify(state.source);
  if (newSourceKey !== sourceKey) {
    sourceKey = newSourceKey;
    $('source').value = state.source?.text || '';
    $('preview').hidden = !state.source?.image;
    if (state.source?.image) $('preview').src = state.source.image;
    else $('preview').removeAttribute('src');
    $('source-label').textContent = state.source ? ({hover:'悬停段落',selection:'选中文字',element:'网页区域',screenshot:'选区截图'}[state.source.mode] || '原文') : '也可以直接粘贴文字';
  }
  const available = state.models.filter(model => !state.source?.image || (model.inputModalities || ['text','image']).includes('image'));
  const newModelKey = JSON.stringify(available);
  if (newModelKey !== modelKey) {
    modelKey = newModelKey;
    const previous = $('model').value || preferences.model;
    $('model').replaceChildren();
    for (const model of available) $('model').add(new Option(model.displayName || model.model, model.model));
    if (available.some(m => m.model === previous)) $('model').value = previous;
    else $('model').value = available.find(m => m.isDefault)?.model || available[0]?.model || '';
    if (!available.length) $('model').add(new Option('连接后读取可用模型', ''));
    refreshEffort();
  }
  $('model').disabled = state.busy || !available.length;
  $('effort').disabled = state.busy || !available.length;
  $('language').disabled = state.busy;
  $('translate').disabled = state.busy || !state.connected || !state.loggedIn || !$('model').value;
}
$('hover').onclick = () => send({type: 'enableHover'}).catch(showError);
$('connect').onclick = () => send({type: 'connect'}).catch(showError);
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.onclick = () => send({type: 'pick', mode: pickMode(button.dataset.mode)}).catch(showError));
$('clear').onclick = () => { $('source').value = ''; send({type: 'clear'}).catch(showError); };
$('cancel').onclick = () => send({type: 'cancel'}).catch(showError);
$('translate').onclick = () => send({type: 'translate', text:$('source').value, model:$('model').value, effort:$('effort').value, language:language($('language').value)}).catch(showError);
$('copy').onclick = async () => {
  if (!current) return;
  try { await navigator.clipboard.writeText(markdownEnabled ? current.result : markdown.toPlain(current.result)); $('copy').textContent = '已复制'; setTimeout(() => $('copy').textContent = '复制', 1200); }
  catch { showError(new Error('复制失败，请手动选中译文复制')); }
};
for (const key of ['model', 'effort', 'language'] as const) $(key).onchange = () => {
  if (key === 'language') preferences.language = language($(key).value);
  else preferences[key] = $(key).value;
  chrome.storage.local.set({[key]: preferences[key]});
  if (key === 'model') refreshEffort();
};
chrome.runtime.onMessage.addListener((value: unknown) => {
  try {
    const message = object(value);
    if (message.type === 'state' && current) render({...current, ...panelUpdate(message.state)});
  } catch (error) { showError(error); }
});
$('markdown').onchange = async () => {
  try { await chrome.storage.local.set({markdown: $('markdown').checked}); }
  catch (error) { $('markdown').checked = markdownEnabled; showError(error); }
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.markdown) return;
  markdownEnabled = changes.markdown.newValue !== false;
  $('markdown').checked = markdownEnabled;
  if (current) render(current);
});
try { render(await send({type: 'getState'})); } catch(error) { showError(error); }

async function refreshShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    $('shortcut').textContent = commands.find(command => command.name === 'enter-translation-mode')?.shortcut || '未设置';
  } catch (error) { showError(error); }
}
$('configure-shortcut').onclick = () => chrome.tabs.create({url: 'chrome://extensions/shortcuts'}).catch(showError);
window.addEventListener('focus', refreshShortcut);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshShortcut(); });
void refreshShortcut();
