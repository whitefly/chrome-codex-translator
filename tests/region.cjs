const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixture = `<html><body style="margin:0;background:#101417;color:#d7dedf;font:18px/1.7 system-ui">
<article style="max-width:760px;margin:65px auto;padding:0 20px">
<h1>Getting started</h1><ol style="padding-left:32px">
<li id="first">Start the server with <code>codex app-server</code> (default stdio transport).</li>
<li id="second">Connect a client, then send <code>initialize</code> followed by <code>initialized</code>.</li>
<li id="third">Start a thread and a turn, then keep reading notifications.</li>
</ol><p id="outside">Example (Node.js / TypeScript):</p>
<pre id="code" style="padding:16px;background:#202b31;border-radius:10px">const client = connect();\n  client.start();</pre>
<div id="nested">Introduction <p id="nested-child">Nested paragraph with <strong>inline emphasis</strong>.</p></div>
<div id="plain">Plain container text.</div><a id="link" href="/unexpected">An ordinary link</a>
<p id="editable" contenteditable="true">PRIVATE EDITOR</p><input value="PRIVATE INPUT">
<p hidden>HIDDEN SECRET</p><p style="visibility:hidden">INVISIBLE SECRET</p>
<div style="height:1200px"></div></article></body></html>`;

// 使用隔离页面和模拟扩展通信，不访问个人资料或真实模型。
async function setup(browser, html = fixture, saved = []) {
    const page = await browser.newPage({viewport: {width: 1120, height: 850}});
    await page.route('http://localhost/**', route => route.fulfill({contentType: 'text/html', body: html}));
    await page.goto('http://localhost/region');
    await page.evaluate(saved => {
        window.messages = [];
        window.listeners = [];
        window.chrome = {runtime: {
            sendMessage: async message => {
                messages.push(message);
                return message.type === 'hoverCacheLoad' ? {ok: true, data: saved} : {ok: true};
            }, onMessage: {addListener: listener => listeners.push(listener)}
        }};
        window.receive = message => listeners.forEach(listener => listener(message, {}, () => {}));
    }, saved);
    await page.evaluate(require('./storage-mock.cjs'));
    for (const name of ['hover.js']) {
        await page.addScriptTag({path: path.resolve(__dirname, '../dist', name)});
    }
    await page.evaluate(() => receive({type: 'hoverEnable', enabled: true}));
    return page;
}

const ui = (page, name) => page.locator('#codex-hover-translator ' + name);
const requests = page => page.evaluate(() => messages.filter(message => message.type === 'hoverTranslate'));

async function drag(page, start, end) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, {steps: 8});
    await page.mouse.up();
}

async function finish(page, request, result) {
    await page.evaluate(({request, result}) => receive({
        type: 'hoverState', requestId: request.requestId, result, busy: false, error: '',
        status: request.kind === 'summary' ? '总结完成' : '翻译完成'
    }), {request, result});
}

// 混合选区以主要正文而非首个大标题为基准，并验证纯文本切换与响应式更新。
async function verifyTypography(browser) {
    const html = `<html><body style="margin:0;background:#101417;color:#d7dedf;font:18px/1.7 system-ui">
        <article style="margin:35px auto;max-width:680px;padding:0 20px">
        <h1 style="font-size:36px;font-weight:750">Initialization</h1>
        <p id="note" style="font-size:12px">Short note</p>
        <ul><li class="prose">Clients must initialize a connection before calling other methods. Keep the original text readable.</li>
        <li class="prose">The server responds with its platform information. Use clientInfo to identify your integration.</li></ul>
        <pre style="font-size:24px;font-weight:700">initialize()</pre>
        <div style="height:1000px"></div></article></body></html>`;
    const page = await setup(browser, html);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await ui(page, '.region-start').click();
    const heading = await page.locator('h1').boundingBox(), code = await page.locator('pre').boundingBox();
    await drag(page, {x: heading.x + 2, y: heading.y + 2}, {x: code.x + 100, y: code.y + code.height - 2});
    await ui(page, '.trigger.translate').click();
    const request = (await requests(page))[0];
    assert.match(request.text, /^Initialization/);
    const result = '# 初始化\n\n客户端必须先**初始化连接**，然后调用其他方法。\n\n## 关键步骤\n\n- 发送 `initialize` 请求\n- 用 `clientInfo` 标识集成';
    await finish(page, request, result);
    const appearance = () => page.evaluate(() => {
        const root = document.querySelector('#codex-hover-translator').shadowRoot;
        const body = getComputedStyle(root.querySelector('.body'));
        const original = getComputedStyle(document.querySelector('.prose'));
        const style = selector => getComputedStyle(root.querySelector(selector));
        return {size: body.fontSize, weight: body.fontWeight, line: body.lineHeight, family: body.fontFamily,
            original: {size: original.fontSize, weight: original.fontWeight, line: original.lineHeight, family: original.fontFamily},
            heading: parseFloat(style('.body h1').fontSize), subheading: parseFloat(style('.body h2').fontSize),
            strong: style('.body strong').fontWeight, code: parseFloat(style('.body code').fontSize),
            paragraph: style('.body p').fontWeight};
    });
    let actual = await appearance();
    assert.deepEqual({size: actual.size, weight: actual.weight, line: actual.line, family: actual.family}, actual.original);
    assert.equal(actual.size, '18px');
    assert.equal(actual.paragraph, '400');
    assert.ok(Number(actual.strong) > Number(actual.paragraph));
    assert.ok(actual.heading > 18 && actual.heading <= 18 * 1.17);
    assert.ok(actual.subheading < actual.heading);
    assert.ok(Math.abs(actual.code - 18) < 1);
    await page.screenshot({path: path.resolve(__dirname, '../test-artifacts/typography-mixed.png')});
    await page.evaluate(() => chrome.storage.local.set({markdown: false}));
    assert.equal(await ui(page, '.body h1').count(), 0);
    assert.equal(await ui(page, '.body').evaluate(node => getComputedStyle(node).fontSize), '18px');
    await page.evaluate(() => chrome.storage.local.set({markdown: true}));
    await page.evaluate(() => document.querySelectorAll('.prose').forEach(node => node.style.fontSize = '20px'));
    await page.setViewportSize({width: 360, height: 800});
    await page.waitForFunction(() => {
        const root = document.querySelector('#codex-hover-translator').shadowRoot;
        const rect = root.querySelector('.card').getBoundingClientRect();
        return getComputedStyle(root.querySelector('.body')).fontSize === '20px' && rect.left >= 0 && rect.right <= innerWidth;
    });
    actual = await appearance();
    assert.equal(actual.line, actual.original.line);
    assert.ok(actual.heading <= 20 * 1.17);
    const bounds = await ui(page, '.card').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360);
    await page.screenshot({path: path.resolve(__dirname, '../test-artifacts/typography-narrow.png')});
    assert.equal((await requests(page)).length, 1);
    // 仅选择标题也不能以标题字号作为正文基准，再被 Markdown 放大一次。
    await page.setViewportSize({width: 1120, height: 850});
    await ui(page, '.region-start').click();
    const title = await page.locator('article > h1').boundingBox();
    await drag(page, {x: title.x + 2, y: title.y + 2}, {x: title.x + 30, y: title.y + 15});
    await ui(page, '.trigger.translate').click();
    await finish(page, (await requests(page)).at(-1), '# 初始化');
    assert.equal(await ui(page, '.body').evaluate(node => getComputedStyle(node).fontSize), '18px');
    assert.equal(await ui(page, '.body').evaluate(node => getComputedStyle(node).fontWeight), '400');
    assert.ok(await ui(page, '.body h1').evaluate(node => parseFloat(getComputedStyle(node).fontSize)) < 22);
    assert.deepEqual(errors, []);
    await page.close();
}

// 覆盖真实鼠标路径、结果缓存和取消，确保框选不会顺带发起模型请求。
(async () => {
    const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
    try {
        const page = await setup(browser);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        fs.mkdirSync(path.resolve(__dirname, '../test-artifacts'), {recursive: true});
        await verifyTypography(browser);
        const first = await page.locator('#first').boundingBox(), third = await page.locator('#third').boundingBox();
        const start = {x: first.x + 10, y: first.y + first.height - 3};
        const end = {x: third.x + 35, y: third.y + 3};
        await page.evaluate(() => document.querySelector('#codex-hover-translator').shadowRoot.querySelector('.region-start').click());
        assert.equal(await ui(page, '.region-veil').isVisible(), false);
        await page.evaluate(() => receive({type: 'hoverEnable', enabled: false}));
        await page.evaluate(() => receive({type: 'hoverEnable', enabled: true, mode: 'region'}));
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, {steps: 8});
        await ui(page, '.region-hit').nth(2).waitFor();
        assert.equal(await ui(page, '.region-hit').count(), 3);
        await page.screenshot({path: path.resolve(__dirname, '../test-artifacts/region-drag.png')});
        await page.mouse.up();
        await ui(page, '.trigger.translate').waitFor();
        assert.equal((await requests(page)).length, 0);
        await page.mouse.move(10, 10);
        assert.equal(await ui(page, '.region-hit').count(), 3);
        await ui(page, '.trigger.translate').click();
        let calls = await requests(page);
        const original = calls[0];
        const expected = await page.locator('li').allInnerTexts();
        assert.equal(original.text, expected.join('\n\n'));
        assert.equal(original.paths.length, 3);
        await finish(page, original, '启动服务，连接客户端，然后开始对话。');
        await page.screenshot({path: path.resolve(__dirname, '../test-artifacts/region-result.png')});
        await ui(page, '.operation[data-kind="summary"]').click();
        calls = await requests(page);
        assert.equal(calls[1].kind, 'summary');
        assert.deepEqual(calls[1].paths, original.paths);
        assert.equal(calls[1].text, original.text);
        await finish(page, calls[1], '三步完成服务连接。');
        await ui(page, '.close').click();
        await ui(page, '.marker').click();
        assert.equal(await ui(page, '.body').innerText(), '三步完成服务连接。');
        await ui(page, '.operation[data-kind="translate"]').click();
        assert.equal((await requests(page)).length, 2);

        // 失焦、指针中断、窗口变化和切换旧选择器均回收遮罩及捕获状态。
        for (const action of ['blur', 'pointercancel', 'resize', 'pick']) {
            await ui(page, '.region-start').click();
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            await page.mouse.move(end.x, end.y);
            await page.evaluate(action => {
                if (action === 'pick') receive({type: 'pick', mode: 'element'});
                else if (action === 'pointercancel') document.querySelector('#codex-hover-translator').shadowRoot.querySelector('.region-veil').dispatchEvent(new PointerEvent('pointercancel'));
                else window.dispatchEvent(new Event(action));
            }, action);
            await page.mouse.up();
            assert.equal(await ui(page, '.region-veil').isVisible(), false);
            assert.equal(await ui(page, '.region-hit').count(), 0);
            await page.evaluate(() => receive({type: 'hoverEnable', enabled: true}));
        }

        // 反向拖选得到同样的整块内容，重复操作复用结果。
        await ui(page, '.region-start').click();
        await drag(page, end, start);
        assert.equal(await ui(page, '.region-hit').count(), 3);
        await ui(page, '.trigger.translate').click();
        assert.equal((await requests(page)).length, 2);

        // 多元素缓存恢复必须匹配全部文字；其中一块改动后不恢复。
        const saved = [{paths: original.paths, source: original.text, translate: '整组缓存'}];
        const restored = await setup(browser, fixture, saved);
        await ui(restored, '.marker').click();
        assert.equal(await ui(restored, '.body').innerText(), '整组缓存');
        assert.equal(await ui(restored, '.region-hit').count(), 3);
        assert.equal((await requests(restored)).length, 0);
        await restored.evaluate(() => window.scrollTo(0, 800));
        await restored.waitForTimeout(80);
        assert.equal(await ui(restored, '.card').isVisible(), false);
        await restored.evaluate(() => window.scrollTo(0, 0));
        await restored.waitForTimeout(80);
        assert.equal(await ui(restored, '.card').isVisible(), true);
        await restored.close();
        const changed = await setup(browser, fixture.replace('Connect a client', 'Changed content'), saved);
        assert.equal(await ui(changed, '.marker').count(), 0);
        await changed.close();

        // 空白、轻点和超限均留在框选模式，不会发送模型请求。
        await ui(page, '.region-start').click();
        await drag(page, {x: 3, y: 3}, {x: 8, y: 8});
        assert.match(await ui(page, '.region-tip').innerText(), /没有选中正文/);
        await drag(page, start, {x: start.x + 1, y: start.y + 1});
        assert.equal(await ui(page, '.trigger.translate').isVisible(), false);
        await page.keyboard.press('Escape');
        assert.equal(await ui(page, '.region-veil').isVisible(), false);
        assert.equal(await ui(page, '.dock').isVisible(), true);
        await ui(page, '.region-start').click();
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y);
        await page.keyboard.press('Escape');
        await page.mouse.up();
        assert.equal(await ui(page, '.region-hit').count(), 0);
        assert.equal((await requests(page)).length, 2);

        // 重选期间取消旧请求，迟到结果不得覆盖新的选择。
        await ui(page, '.region-start').click();
        const code = await page.locator('#code').boundingBox();
        await drag(page, {x: code.x + 4, y: code.y + 4}, {x: code.x + 14, y: code.y + 14});
        await ui(page, '.trigger.translate').click();
        calls = await requests(page);
        assert.equal(calls.at(-1).text, 'const client = connect();\n  client.start();');
        await ui(page, '.region-start').click();
        assert.equal(await page.evaluate(() => messages.at(-1).type), 'hoverCancel');
        await finish(page, calls.at(-1), 'LATE RESULT');
        assert.equal(await ui(page, '.card').isVisible(), false);
        await page.keyboard.press('Escape');

        // 嵌套正文不重复，布局祖先和隐藏、可编辑内容不混入选区。
        const nested = await page.locator('#nested-child').boundingBox();
        await ui(page, '.region-start').click();
        await drag(page, {x: nested.x + 5, y: nested.y + 5}, {x: nested.x + 20, y: nested.y + 15});
        await ui(page, '.trigger.translate').click();
        calls = await requests(page);
        assert.equal(calls.at(-1).text, 'Nested paragraph with inline emphasis.');
        assert.equal(calls.at(-1).paths.length, 1);
        await finish(page, calls.at(-1), '嵌套段落');
        await ui(page, '.region-start').click();
        await drag(page, {x: 1, y: 1}, {x: 1000, y: 700});
        await ui(page, '.trigger.translate').click();
        calls = await requests(page);
        assert.doesNotMatch(calls.at(-1).text, /PRIVATE|SECRET/);
        assert.equal(calls.at(-1).text.split('Nested paragraph').length, 2);
        await finish(page, calls.at(-1), '页面范围');

        // 底层链接不会因框选而导航，退出后恢复正常点击。
        await ui(page, '.region-start').click();
        const link = await page.locator('#link').boundingBox();
        await drag(page, {x: link.x + 2, y: link.y + 2}, {x: link.x + 15, y: link.y + 12});
        assert.equal(page.url(), 'http://localhost/region');
        await page.keyboard.press('Escape');
        await page.setViewportSize({width: 360, height: 800});
        await ui(page, '.region-start').click();
        const small = await page.locator('#first').boundingBox();
        await drag(page, {x: small.x + 1, y: small.y + 1}, {x: small.x + 12, y: small.y + 12});
        await ui(page, '.trigger.translate').click();
        calls = await requests(page);
        await finish(page, calls.at(-1), '窄屏框选结果');
        await page.screenshot({path: path.resolve(__dirname, '../test-artifacts/region-narrow.png')});
        for (const selector of ['.card', '.dock']) {
            const rect = await ui(page, selector).boundingBox();
            assert.ok(rect.x >= 0 && rect.x + rect.width <= 360);
        }
        await page.keyboard.press('Escape');
        assert.equal(await ui(page, '.dock').isVisible(), false);
        await page.locator('#link').click();
        assert.equal(page.url(), 'http://localhost/unexpected');
        assert.deepEqual(errors, []);

        const long = await setup(browser, '<html><body><p>' + 'x'.repeat(12001) + '</p></body></html>');
        await ui(long, '.region-start').click();
        await drag(long, {x: 10, y: 18}, {x: 30, y: 30});
        assert.match(await ui(long, '.region-tip').innerText(), /12,000/);
        assert.equal((await requests(long)).length, 0);
        await long.close();
        const clipped = await setup(browser, '<html><body><div style="position:absolute;left:20px;top:20px;width:200px;height:20px;overflow:hidden"><p style="margin:40px 0 0">CLIPPED SECRET</p></div><p style="position:absolute;left:20px;top:60px;margin:0">Visible paragraph</p></body></html>');
        await ui(clipped, '.region-start').click();
        await drag(clipped, {x: 21, y: 61}, {x: 35, y: 75});
        await ui(clipped, '.trigger.translate').click();
        assert.equal((await requests(clipped))[0].text, 'Visible paragraph');
        await clipped.close();
        const crowded = await setup(browser, '<html><body><div style="display:grid;grid-template-columns:repeat(201,2px)">' + '<p style="margin:0;font-size:2px">x</p>'.repeat(201) + '</div></body></html>');
        await ui(crowded, '.region-start').click();
        await drag(crowded, {x: 5, y: 5}, {x: 500, y: 40});
        assert.match(await ui(crowded, '.region-tip').innerText(), /200/);
        assert.equal((await requests(crowded)).length, 0);
        await crowded.close();
        console.log('PASS: intersecting/reverse region selection, whole blocks, nesting, limits, privacy, cancellation, grouped cache, scrolling, narrow layout and link interception.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
