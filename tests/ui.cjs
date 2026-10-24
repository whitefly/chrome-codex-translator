// Browser tests with a mocked Chrome bridge; no model requests or personal profile.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req,res) => {
  if(req.url === '/fixture') { res.setHeader('Content-Type','text/html'); return res.end('<html><body style="margin:40px"><article><h1>Reading test</h1><p id="text">Hello, world! This is a translation test.</p><a id="link" href="/wrong">Never navigate while picking</a></article></body></html>'); }
  const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404); return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const context=await browser.newContext({viewport:{width:390,height:1080},deviceScaleFactor:2});
    await context.addInitScript(()=>{
      window.listeners=[]; window.sent=[]; window.shortcutValue=''; window.openedTabs=[];
      window.testState={connected:true,loggedIn:true,busy:false,status:'就绪',error:'',result:'',source:null,
        models:[{model:'text',displayName:'Text model',isDefault:true,inputModalities:['text'],supportedReasoningEfforts:[{reasoningEffort:'low'}]},
                {model:'vision',displayName:'Vision model',inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]};
      window.chrome={commands:{getAll:async()=>[{name:'enter-translation-mode',shortcut:window.shortcutValue}]},tabs:{create:async options=>openedTabs.push(options)},runtime:{id:'a'.repeat(32),onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async m=>{sent.push(m);return {ok:true,data:m.type==='getState'?testState:undefined};}},storage:{local:{get:async()=>({}),set:async()=>{}}}};
      window.updateState=patch=>{Object.assign(testState,patch);listeners.forEach(fn=>fn({type:'state',state:testState}));};
    });
    await context.addInitScript(require('./storage-mock.cjs'));
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/dist/sidepanel.html');
    await page.waitForFunction(()=>document.querySelector('#model').value==='text');
    await page.waitForFunction(()=>document.querySelector('#shortcut').textContent==='未设置');
    await page.locator('#configure-shortcut').click();
    assert.equal(await page.evaluate(()=>openedTabs.at(-1).url),'chrome://extensions/shortcuts');
    await page.evaluate(()=>{window.shortcutValue='Ctrl+Shift+K';window.dispatchEvent(new Event('focus'));});
    await page.waitForFunction(()=>document.querySelector('#shortcut').textContent==='Ctrl+Shift+K');
    await page.locator('#source').fill('Hello, world!');
    await page.locator('#translate').click();
    assert.equal(await page.evaluate(()=>sent.find(m=>m.type==='translate').text),'Hello, world!');
    await page.evaluate(()=>updateState({busy:true,result:'你好'}));
    assert.equal(await page.locator('#translate').isDisabled(),true);
    await page.locator('#cancel').click();
    assert.equal(await page.evaluate(()=>sent.at(-1).type),'cancel');
    await page.evaluate(()=>updateState({busy:false,result:'你好，世界！',status:'翻译完成'}));
    assert.equal(await page.locator('#result').innerText(),'你好，世界！');
    await page.evaluate(()=>updateState({source:{mode:'selection',text:'Keep this original'}}));
    await page.evaluate(()=>{
      const {source,...patch}=testState;
      listeners.forEach(fn=>fn({type:'state',state:{...patch,result:'Only the result changed'}}));
    });
    assert.equal(await page.locator('#source').inputValue(),'Keep this original');
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
    await page.evaluate(image=>updateState({source:{mode:'screenshot',image,text:''}}),image);
    assert.equal(await page.locator('#model').inputValue(),'vision');
    assert.equal(await page.locator('#model option').count(),1);
    await page.evaluate(()=>updateState({source:{mode:'selection',text:'<script>alert(1)</script>'},result:'<img src=x onerror=alert(1)>'}));
    assert.equal(await page.locator('#result img').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    fs.mkdirSync(path.join(root,'test-artifacts'),{recursive:true});
    await page.evaluate(()=>updateState({source:{mode:'selection',text:'Good design makes complex things feel simple.'},result:'好的设计，让复杂的事物变得简单。'}));
    await page.screenshot({path:path.join(root,'test-artifacts/sidepanel.png'),fullPage:true});
    await page.setViewportSize({width:320,height:800});
    await page.evaluate(()=>{const option=document.querySelector('#model').selectedOptions[0];option.textContent='A very long model display name for narrow panels';});
    const controls=await Promise.all(['language','model','effort'].map(id=>page.locator('#'+id).boundingBox()));
    assert.equal(controls[0].y,controls[1].y);assert.equal(controls[1].y,controls[2].y);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(root,'test-artifacts/sidepanel-narrow.png'),fullPage:true});
    const markdownSource='## 核心结论\n\n**清晰的结构**让阅读更轻松。\n\n### 关键要点\n\n- 结论优先\n  - 按主题分层\n- 保留重要细节\n\n```js\nconst keep = "**literal**";\n```';
    assert.equal(await page.locator('#markdown').isChecked(),true);
    await page.evaluate(result=>updateState({result,busy:true}),markdownSource);
    assert.equal(await page.locator('#result h2').innerText(),'核心结论');
    await page.locator('#copy').click();
    assert.equal(await page.evaluate(()=>copied),markdownSource);
    await page.screenshot({path:path.join(root,'test-artifacts/sidepanel-markdown.png'),fullPage:true});
    await page.locator('#markdown').uncheck();
    assert.equal(await page.locator('#result h2').count(),0);
    assert.doesNotMatch(await page.locator('#result').innerText(),/##|\*\*清晰/);
    await page.locator('#copy').click();
    assert.match(await page.evaluate(()=>copied),/"\*\*literal\*\*"/);
    assert.doesNotMatch(await page.evaluate(()=>copied),/##|\*\*清晰/);
    await page.screenshot({path:path.join(root,'test-artifacts/sidepanel-plain.png'),fullPage:true});
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#model').value==='text');
    assert.equal(await page.locator('#markdown').isChecked(),false);
    await page.evaluate(result=>updateState({result}),markdownSource);
    assert.equal(await page.locator('#result h2').count(),0);
    await page.evaluate(()=>chrome.storage.local.set({markdown:true}));
    assert.equal(await page.locator('#markdown').isChecked(),true);
    assert.equal(await page.locator('#result h2').count(),1);
    const content=await context.newPage();await content.goto(base+'/fixture');
    await content.addScriptTag({path:path.join(root,'dist/content.js')});
    await content.addScriptTag({path:path.join(root,'dist/content.js')});
    async function pick(mode){ await content.evaluate(mode=>new Promise(resolve=>listeners.at(-1)({type:'pick',mode},{},resolve)),mode); }
    await content.evaluate(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('#text'));getSelection().removeAllRanges();getSelection().addRange(r);});
    await pick('selection');
    assert.equal(await content.evaluate(()=>sent.at(-1).text),'Hello, world! This is a translation test.');
    await pick('element');await content.locator('#link').hover();await content.locator('#link').click();
    await content.waitForFunction(()=>sent.some(m=>m.mode==='element'));
    assert.equal(content.url(),base+'/fixture');
    assert.equal(await content.evaluate(()=>sent.at(-1).text),'Never navigate while picking');
    await pick('screenshot');await content.mouse.move(60,80);await content.mouse.down();await content.mouse.move(260,240);await content.mouse.up();
    await content.waitForFunction(()=>sent.some(m=>m.mode==='screenshot'));
    const rect=await content.evaluate(()=>sent.at(-1).rect);assert.equal(rect.width,200);assert.equal(rect.height,160);
    await pick('element');await content.keyboard.press('Escape');
    assert.equal(await content.evaluate(()=>[...document.querySelectorAll('div')].some(e=>e.style.zIndex==='2147483647')),false);
    await content.locator('#text').screenshot({path:path.join(root,'test-artifacts/english-selection.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS: panel, model/image filter, streaming state, cancel, safe rendering, selection, element/link interception, rectangle, Escape.');
    await context.close();
  } finally { await browser.close();server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
