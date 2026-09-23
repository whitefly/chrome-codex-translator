const $ = id => document.getElementById(id);
let current, sourceKey, modelKey;
const preferences = await chrome.storage.local.get(['model', 'effort', 'language']);
$('language').value = preferences.language || '简体中文';
$('extension-id').textContent = chrome.runtime.id;
async function send(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok) throw new Error(response?.error || '扩展未响应');
  return response.data;
}
function showError(error) { $('error').textContent = error.message; $('error').hidden = false; }
function selectedModel() { return current?.models.find(model => model.model === $('model').value); }
function refreshEffort() {
  const model = selectedModel();
  $('effort').replaceChildren(new Option('模型默认', ''));
  for (const effort of model?.supportedReasoningEfforts || []) {
    $('effort').add(new Option(effort.reasoningEffort, effort.reasoningEffort));
  }
  if ([...$('effort').options].some(o => o.value === preferences.effort)) $('effort').value = preferences.effort;
  $('effort').disabled = !model || current?.busy;
}
function render(state) {
  current = state;
  $('status').textContent = state.status;
  $('dot').classList.toggle('online', state.connected && state.loggedIn);
  $('connect').textContent = state.connected ? '刷新模型' : '连接 Codex';
  $('connect').disabled = state.busy;
  $('error').hidden = !state.error;
  $('error').textContent = state.error;
  $('result').textContent = state.result || '译文会逐步显示在这里。';
  $('result').classList.toggle('empty', !state.result);
  $('copy').disabled = !state.result;
  $('cancel').hidden = !state.busy;
  $('source').disabled = state.busy;
  $('clear').disabled = state.busy;
  document.querySelectorAll('[data-mode]').forEach(button => button.disabled = state.busy);
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
$('hover').onclick = () => send('enableHover').catch(showError);
$('connect').onclick = () => send('connect').catch(showError);
document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => send('pick', {mode: button.dataset.mode}).catch(showError));
$('clear').onclick = () => { $('source').value = ''; send('clear').catch(showError); };
$('cancel').onclick = () => send('cancel').catch(showError);
$('translate').onclick = () => send('translate', {text:$('source').value, model:$('model').value, effort:$('effort').value, language:$('language').value}).catch(showError);
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(current.result); $('copy').textContent = '已复制'; setTimeout(() => $('copy').textContent = '复制', 1200); }
  catch { showError(new Error('复制失败，请手动选中译文复制')); }
};
for (const key of ['model', 'effort', 'language']) $(key).onchange = () => {
  preferences[key] = $(key).value;
  chrome.storage.local.set({[key]: preferences[key]});
  if (key === 'model') refreshEffort();
};
chrome.runtime.onMessage.addListener(message => { if (message.type === 'state') render({ ...current, ...message.state }); });
try { render(await send('getState')); } catch(error) { showError(error); }

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
