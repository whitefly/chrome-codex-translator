const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// 验证真实 DOM 排版、安全边界与流式半成品，不调用真实模型。
(async () => {
    const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
    try {
        const page = await browser.newPage({viewport: {width: 320, height: 800}});
        await page.setContent('<div id="result" style="white-space:pre-wrap"></div>');
        const {outputFiles} = await require('esbuild').build({
            stdin: {contents: "import * as markdown from './src/shared/markdown.ts'; globalThis.testMarkdown = markdown;", resolveDir: path.resolve(__dirname, '..')},
            bundle: true, format: 'iife', write: false, platform: 'browser', target: 'chrome116'
        });
        await page.addScriptTag({content: outputFiles[0].text});
        await page.evaluate(() => testMarkdown.install(document.head));
        const source = '# 核心结论\n\n**清晰分层**帮助阅读。\n\n## 关键要点\n\n- 第一项\n  - 子要点\n- 第二项\n\n3. 步骤三\n4. 步骤四\n\n> 保留重要限制\n\n```js\nconst text = "**不是粗体**";\n  <script>alert(1)</script>\n```\n\n| 主题 | 说明 |\n| --- | --- |\n| 阅读 | 更清楚 |';
        const render = (text, markdown = true) => page.evaluate(({text, markdown}) => testMarkdown.render(document.querySelector('#result'), text, markdown), {text, markdown});
        await render(source);
        assert.equal(await page.locator('h1').innerText(), '核心结论');
        assert.equal(await page.locator('ul ul li').innerText(), '子要点');
        assert.equal(await page.locator('ol').getAttribute('start'), '3');
        assert.equal(await page.locator('strong').innerText(), '清晰分层');
        assert.equal(await page.locator('table tr').count(), 2);
        assert.match(await page.locator('pre code').textContent(), /  <script>/);
        fs.mkdirSync(path.resolve(__dirname, '../test-artifacts'), {recursive: true});
        await page.screenshot({path: path.resolve(__dirname, '../test-artifacts/markdown.png'), fullPage: true});
        await render(source, false);
        const plain = await page.locator('#result').textContent();
        assert.doesNotMatch(plain, /# 核心|\*\*清晰|```/);
        assert.match(plain, /  • 子要点/);
        assert.match(plain, /3\. 步骤三/);
        assert.match(plain, /"\*\*不是粗体\*\*"/);
        assert.equal(await page.locator('#result *').count(), 0);
        assert.equal(plain, await page.evaluate(source => testMarkdown.toPlain(source), source));

        const requests = [];
        page.on('request', request => requests.push(request.url()));
        await render('<img src="https://evil.test/x" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[x](javascript:alert%281%29) ![图](https://evil.test/pixel)\n\n&lt;svg onload=alert(1)&gt;');
        assert.equal(await page.locator('#result img, #result script, #result svg, #result a, #result iframe').count(), 0);
        assert.match(await page.locator('#result').textContent(), /<img/);
        assert.deepEqual(requests, []);
        for (const text of ['## 标', '## 标题\n\n**重点', '## 标题\n\n**重点**\n\n```js\na()', '## 标题\n\n**重点**\n\n```js\na()\n```']) {
            await render(text);
            assert.equal(await page.locator('h2').count(), 1);
        }
        assert.equal(await page.locator('pre code').textContent(), 'a()');
        await render('```\n' + 'long'.repeat(1000) + '\n```\n\n| a | b | c |\n|---|---|---|\n| ' + 'value'.repeat(100) + '| b | c |');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        console.log('PASS: Markdown hierarchy, nested lists, tables, plain text, code preservation, untrusted output, streaming and narrow overflow.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
