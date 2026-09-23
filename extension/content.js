(() => {
  if (window.__codexTranslatorPicker) return;
  window.__codexTranslatorPicker = true;
  let cleanup = () => {};
  const send = async payload => {
    const response = await chrome.runtime.sendMessage({ type: 'picked', ...payload });
    if (!response?.ok) throw new Error(response?.error || '选区发送失败');
  };
  function start(mode) {
    cleanup();
    if (mode === 'selection') return send({ mode, text: window.getSelection()?.toString() || '' });
    if (!['element', 'screenshot'].includes(mode)) throw new Error('未知选择模式');
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{font-family:system-ui} .box{position:fixed;border:2px solid #22b8a0;background:#22b8a022;box-sizing:border-box;pointer-events:none}.tip{position:fixed;top:18px;left:50%;transform:translateX(-50%);background:#102c2a;color:white;border-radius:12px;padding:12px 18px;font:14px system-ui;box-shadow:0 4px 24px #0004}.veil{position:fixed;inset:0;cursor:crosshair;pointer-events:auto;background:#0002}';
    const box = document.createElement('div'); box.className = 'box';
    const tip = document.createElement('div'); tip.className = 'tip';
    tip.textContent = mode === 'element' ? '点击选择区域 · ↑ 扩大到父元素 · ↓ 缩小 · Esc 取消' : '拖动框选截图 · Esc 取消';
    root.append(style);
    let veil;
    if (mode === 'screenshot') { veil = document.createElement('div'); veil.className = 'veil'; root.append(veil); }
    root.append(box, tip); document.documentElement.append(host);
    let selected, previous = [], startPoint;
    const listeners = [];
    const on = (target, type, handler) => { target.addEventListener(type, handler, true); listeners.push([target, type, handler]); };
    cleanup = () => { for (const [target, type, handler] of listeners) target.removeEventListener(type, handler, true); host.remove(); cleanup = () => {}; };
    const draw = rect => Object.assign(box.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    const finish = async payload => {
      cleanup();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try { await send(payload); } catch (error) { console.warn('Codex Translate:', error.message); }
    };
    on(window, 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); }
      if (mode === 'element' && selected && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === 'ArrowUp' && selected.parentElement) { previous.push(selected); selected = selected.parentElement; }
        else if (event.key === 'ArrowDown' && previous.length) selected = previous.pop();
        draw(selected.getBoundingClientRect());
      }
    });
    if (mode === 'element') {
      on(window, 'pointermove', event => {
        selected = document.elementFromPoint(event.clientX, event.clientY); previous = [];
        if (selected) draw(selected.getBoundingClientRect());
      });
      // Block native links/buttons before their click handlers run.
      on(window, 'pointerdown', event => { event.preventDefault(); event.stopImmediatePropagation(); });
      on(window, 'click', event => {
        event.preventDefault(); event.stopImmediatePropagation();
        if (selected) void finish({ mode, text: selected.innerText || '' });
      });
      on(window, 'scroll', () => { if (selected) draw(selected.getBoundingClientRect()); });
    } else {
      const point = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
      const rect = end => ({ x: Math.min(startPoint.x, end.x), y: Math.min(startPoint.y, end.y), width: Math.abs(end.x - startPoint.x), height: Math.abs(end.y - startPoint.y) });
      on(veil, 'pointerdown', event => { event.preventDefault(); startPoint = point(event); veil.setPointerCapture(event.pointerId); });
      on(veil, 'pointermove', event => { if (startPoint) draw(rect(point(event))); });
      on(veil, 'pointerup', event => {
        if (!startPoint) return;
        const area = rect(point(event));
        if (area.width < 4 || area.height < 4) { startPoint = null; return; }
        void finish({ mode, rect: { ...area, viewportWidth: innerWidth, viewportHeight: innerHeight } });
      });
      on(window, 'resize', () => cleanup());
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type !== 'pick') return;
    Promise.resolve().then(() => start(message.mode)).then(() => respond({ ok: true })).catch(error => respond({ ok: false, error: error.message }));
    return true;
  });
})();
