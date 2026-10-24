const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage();
  await page.route('http://localhost/**', route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto('http://localhost/');
  await page.evaluate(()=>{
   window.listeners=[];window.posted=[];window.tabMessages=[];window.broadcasts=[];window.sessionData={};window.scriptCalls=[];window.menus=[];window.sidePanelCalls=[];
   const event=()=>({addListener:()=>{}});
   window.native={disconnect:()=>{},postMessage:m=>posted.push(m),onMessage:{addListener:fn=>window.nativeReceive=fn},onDisconnect:{addListener:fn=>window.nativeDisconnect=fn}};
   window.chrome={runtime:{id:'test',connectNative:()=>native,sendMessage:async message=>broadcasts.push(message),onMessage:{addListener:fn=>listeners.push(fn)},onInstalled:{addListener:fn=>window.installed=fn}},
    storage:{local:{get:async()=>({model:'test',effort:'low',language:'English'})},session:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in sessionData).map(key=>[key,sessionData[key]])),set:async values=>Object.assign(sessionData,values)}},scripting:{executeScript:async args=>scriptCalls.push(args)},
    tabs:{onRemoved:{addListener:fn=>window.tabRemoved=fn},onUpdated:{addListener:fn=>window.tabUpdated=fn},sendMessage:async(...args)=>{tabMessages.push(args);return {ok:true};},query:async()=>[{id:1,windowId:1,title:'Test page',url:'https://example.test/article'}],captureVisibleTab:async()=>{const c=document.createElement('canvas');c.width=800;c.height=600;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,800,600);return c.toDataURL();}},
    action:{onClicked:event()},contextMenus:{onClicked:{addListener:fn=>window.menuClick=fn},removeAll:fn=>{menus=[];fn();},create:item=>menus.push(item)},commands:{onCommand:{addListener:fn=>window.command=fn}},sidePanel:{open:async args=>sidePanelCalls.push(args)}};
   window.send=(m,s={id:'test'})=>new Promise(resolve=>listeners[0](m,s,resolve));
  });
  await page.addScriptTag({type:'module',path:path.resolve(__dirname,'../dist/background.js')});
  await page.evaluate(()=>installed());
  const menus=await page.evaluate(()=>menus);
  assert.deepEqual(menus.map(item=>item.id),['translate','select-region']);
  assert.equal(menus[1].title,'框选翻译区域');
  assert.ok(menus[1].contexts.includes('page') && menus[1].contexts.includes('link'));
  await page.evaluate(()=>send({type:'connect'}));
  await page.evaluate(()=>nativeReceive({type:'ready',models:[],loggedIn:true}));
  const result=await page.evaluate(()=>send({type:'picked',mode:'screenshot',rect:{x:50,y:30,width:100,height:50,viewportWidth:400,viewportHeight:300}},{id:'test',tab:{id:1,windowId:1,title:'Test'},frameId:0}));
  assert.equal(result.ok,true);
  const dimensions=await page.evaluate(async()=>{const {data}=await send({type:'getState'});const image=await createImageBitmap(await(await fetch(data.source.image)).blob());return [image.width,image.height];});
  assert.deepEqual(dimensions,[200,100]);
  await page.evaluate(()=>send({type:'translate',text:'Hello',model:'test',language:'English'}));
  const request=await page.evaluate(()=>posted.find(m=>m.type==='translate'));
  assert.ok(request.image.startsWith('data:image/png;base64,'));
  await page.evaluate(()=>nativeReceive({type:'delta',requestId:'stale',text:'wrong'}));
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.result),'');
  await page.evaluate(id=>nativeReceive({type:'delta',requestId:id,text:'Hello'}),request.requestId);
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.result),'Hello');
  await page.evaluate(()=>send({type:'cancel'}));
  assert.equal(await page.evaluate(()=>posted.at(-1).type),'cancel');
  await page.evaluate(id=>nativeReceive({type:'error',requestId:id,message:'test error'}),request.requestId);
  await page.evaluate(id=>nativeReceive({type:'done',requestId:id,text:'Hello',cancelled:false}),request.requestId);
  const state=await page.evaluate(async()=>(await send({type:'getState'})).data);
  assert.equal(state.busy,false);assert.equal(state.status,'处理失败');
  const rejected=await page.evaluate(()=>send({type:'translate',text:'malicious'},{id:'test',tab:{id:1},frameId:0}));
  assert.equal(rejected.ok,false);
  const sender={id:'test',tab:{id:1,windowId:1,url:'https://example.test/article'},url:'https://example.test/article',frameId:0,documentId:'doc-1'};
  const blocked=await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'h0',text:'Before activation'},sender),sender);
  assert.equal(blocked.ok,false);
  await page.evaluate(()=>send({type:'enableHover'}));
  await page.evaluate(()=>nativeReceive({type:'ready',loggedIn:true,models:[{model:'test',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]}));
  const launched=await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'hover-1',text:'Hover paragraph',paths:[[0,1]],kind:'translate'},sender),sender);
  assert.equal(launched.ok,true);
  const hoverRequest=await page.evaluate(()=>posted.at(-1));
  assert.equal(hoverRequest.text,'Hover paragraph');assert.equal(hoverRequest.language,'English');assert.equal(hoverRequest.image,undefined);
  const other=await page.evaluate(()=>send({type:'hoverTranslate',requestId:'wrong',text:'bad'},{id:'test',tab:{id:2},frameId:0}));
  assert.equal(other.ok,false);
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.error),'');
  await page.evaluate(()=>nativeReceive({type:'delta',requestId:'hover-1',text:'Inline translation'}));
  await page.waitForTimeout(80);
  const delivered=await page.evaluate(()=>tabMessages.filter(args=>args[1].type==='hoverState').at(-1));
  assert.equal(delivered[0],1);assert.equal(delivered[1].result,'Inline translation');assert.equal(delivered[2].documentId,'doc-1');
  await page.evaluate(sender=>send({type:'hoverCancel',requestId:'hover-1'},sender),sender);
  assert.equal(await page.evaluate(()=>posted.at(-1).type),'cancel');
  await page.evaluate(()=>nativeReceive({type:'done',requestId:'hover-1',text:'Inline translation',cancelled:true}));
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.busy),false);
  assert.deepEqual(await page.evaluate(sender=>send({type:'hoverCacheLoad'},sender).then(r=>r.data),sender),[]);
  const summary=await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'hover-2',text:'Hover paragraph',paths:[[0,1]],kind:'summary'},sender),sender);
  assert.equal(summary.ok,true);
  assert.equal(await page.evaluate(()=>posted.at(-1).task),'summary');
  await page.evaluate(()=>nativeReceive({type:'done',requestId:'hover-2',text:'Concise summary',cancelled:false}));
  await page.waitForTimeout(50);
  let cached=await page.evaluate(sender=>send({type:'hoverCacheLoad'},sender).then(r=>r.data),sender);
  assert.equal(cached[0].summary,'Concise summary');
  assert.deepEqual(cached[0].paths,[[0,1]]);
  assert.equal(cached[0].translate,undefined);
  const translation=await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'hover-3',text:'Hover paragraph',paths:[[0,1]],kind:'translate'},sender),sender);
  assert.equal(translation.ok,true);
  await page.evaluate(()=>nativeReceive({type:'done',requestId:'hover-3',text:'Saved translation',cancelled:false}));
  await page.waitForTimeout(50);
  cached=await page.evaluate(sender=>send({type:'hoverCacheLoad'},sender).then(r=>r.data),sender);
  assert.equal(cached.length,1);assert.equal(cached[0].translate,'Saved translation');assert.equal(cached[0].summary,'Concise summary');
  const otherPage=await page.evaluate(sender=>send({type:'hoverCacheLoad'}, {...sender,url:'https://example.test/other'}).then(r=>r.data),sender);
  assert.deepEqual(otherPage,[]);
  // 跨元素缓存必须保留所有路径，且不能覆盖同一首段的单段落结果。
  const group=await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'group-1',text:'Hover paragraph\n\nSecond paragraph',paths:[[0,1],[0,2]],kind:'translate'},sender),sender);
  assert.equal(group.ok,true);
  await page.evaluate(()=>nativeReceive({type:'done',requestId:'group-1',text:'Grouped translation',cancelled:false}));
  await page.waitForTimeout(50);
  cached=await page.evaluate(sender=>send({type:'hoverCacheLoad'},sender).then(r=>r.data),sender);
  assert.equal(cached.length,2);
  assert.deepEqual(cached[0].paths,[[0,1],[0,2]]);
  assert.equal(cached[1].translate,'Saved translation');
  const beforeInvalid=await page.evaluate(()=>posted.length);
  for(const paths of [undefined,[],[[]],[[0,-1]],[[0,1.5]],[[0,'1']],[[0,1],[0,1]],[[0],[0,1]],[[...Array(31).fill(0)]],Array.from({length:201},(_,i)=>[i])]) {
   const invalid=await page.evaluate(({sender,paths})=>send({type:'hoverTranslate',requestId:'invalid',text:'Invalid selection',paths,kind:'translate'},sender),{sender,paths});
   assert.equal(invalid.ok,false);
  }
  assert.equal(await page.evaluate(()=>posted.length),beforeInvalid);
  const wrongDocument=await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'frame',text:'Other frame',paths:[[0]],kind:'translate'},{...sender,frameId:1}),sender);
  assert.equal(wrongDocument.ok,false);
  await page.evaluate(()=>command('enter-translation-mode',{id:1,windowId:1,url:'https://example.test/article'}));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>tabMessages.filter(args=>args[1].type==='hoverEnable').at(-1)[1].enabled),true);
  await page.evaluate(()=>command('enter-translation-mode',{id:1,windowId:1,url:'https://example.test/article'}));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>tabMessages.filter(args=>args[1].type==='hoverEnable').at(-1)[1].enabled),true);
  assert.equal(await page.evaluate(()=>scriptCalls.at(-1).files.at(-1)),'hover.js');
  assert.deepEqual(await page.evaluate(()=>scriptCalls.at(-1).files),['hover.js']);
  const disabled=await page.evaluate(sender=>send({type:'hoverDisable'},sender),sender);
  assert.equal(disabled.ok,true);
  assert.equal((await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'after-exit',text:'Blocked'},sender),sender)).ok,false);
  // 未启用的页面也能从原生右键菜单直接框选，不打开侧栏或调用模型。
  const modelCalls=await page.evaluate(()=>posted.length);
  const panelCalls=await page.evaluate(()=>sidePanelCalls.length);
  await page.evaluate(()=>menuClick({menuItemId:'select-region'},{id:1,windowId:1,url:'https://example.test/article'}));
  await page.waitForFunction(()=>tabMessages.some(args=>args[1].type==='hoverEnable' && args[1].mode==='region'));
  assert.equal(await page.evaluate(()=>tabMessages.at(-1)[0]),1);
  assert.deepEqual(await page.evaluate(()=>tabMessages.at(-1)[1]),{type:'hoverEnable',enabled:true,mode:'region'});
  assert.equal(await page.evaluate(()=>posted.length),modelCalls);
  assert.equal(await page.evaluate(()=>sidePanelCalls.length),panelCalls);
  // 原有划词右键入口继续交给侧栏，不与框选混淆。
  await page.evaluate(()=>menuClick({menuItemId:'translate',selectionText:'Context selection'},{id:1,windowId:1}));
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.source.text),'Context selection');
  assert.equal(await page.evaluate(()=>sidePanelCalls.length),panelCalls+1);
  await page.evaluate(()=>command('enter-translation-mode',{id:1,windowId:1}));
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>tabMessages.filter(args=>args[1].type==='hoverEnable').at(-1)[1].enabled),true);
  const manifest=require('../dist/manifest.json');
  assert.deepEqual(Object.keys(manifest.commands),['enter-translation-mode']);
  assert.equal(manifest.commands['enter-translation-mode'].suggested_key,undefined);
  // 流式广播省略原文，清空操作则显式发送 null。
  await page.evaluate(()=>send({type:'translate',text:'Keep source',model:'test',language:'English'}));
  const panelRequest=await page.evaluate(()=>posted.at(-1));
  await page.waitForTimeout(60);
  await page.evaluate(id=>nativeReceive({type:'delta',requestId:id,text:'First'}),panelRequest.requestId);
  await page.waitForTimeout(60);
  assert.equal(await page.evaluate(()=>Object.hasOwn(broadcasts.at(-1).state,'source')),false);
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.source.text),'Context selection');
  await page.evaluate(id=>nativeReceive({type:'done',requestId:id,text:'First',cancelled:false}),panelRequest.requestId);
  await page.evaluate(()=>send({type:'clear'}));
  await page.waitForTimeout(60);
  assert.equal(await page.evaluate(()=>broadcasts.at(-1).state.source),null);

  // 连接中取消立即释放任务，迟到的 ready 不得提交已取消任务。
  await page.evaluate(()=>nativeDisconnect());
  await page.evaluate(sender=>{
   window.pendingStart=send({type:'hoverTranslate',requestId:'connecting-old',text:'Cancelled before ready',paths:[[0,5]],kind:'translate'},sender);
  },sender);
  await page.waitForFunction(()=>posted.at(-1).type==='connect');
  const beforeReady=await page.evaluate(()=>posted.filter(m=>m.type==='translate').length);
  assert.equal((await page.evaluate(sender=>send({type:'hoverCancel',requestId:'connecting-old'},sender),sender)).ok,true);
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.busy),false);
  assert.equal((await page.evaluate(()=>pendingStart)).ok,true);
  await page.evaluate(()=>nativeReceive({type:'ready',models:[{model:'test'}],loggedIn:true}));
  assert.equal(await page.evaluate(()=>posted.filter(m=>m.type==='translate').length),beforeReady);
  assert.deepEqual(await page.evaluate(()=>posted.filter(m=>m.type==='cancel' && m.requestId==='connecting-old')),[]);

  // 取消后的增量不再写入结果，旧请求错误不影响后续任务。
  await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'cancel-running',text:'Running',paths:[[0,6]],kind:'translate'},sender),sender);
  await page.evaluate(sender=>send({type:'hoverCancel',requestId:'cancel-running'},sender),sender);
  await page.evaluate(()=>nativeReceive({type:'delta',requestId:'cancel-running',text:'Must be ignored'}));
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.result),'');
  await page.evaluate(()=>nativeReceive({type:'done',requestId:'cancel-running',text:'Partial',cancelled:false}));
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.status),'已取消');
  assert.equal((await page.evaluate(sender=>send({type:'hoverCacheLoad'},sender),sender)).data.some(e=>e.source==='Running'),false);
  await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'next-task',text:'Next',paths:[[0,7]],kind:'summary'},sender),sender);
  await page.evaluate(()=>nativeReceive({type:'error',requestId:'cancel-running',message:'Old error'}));
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.error),'');
  const bad=await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'bad-kind',text:'Bad',paths:[[0,8]],kind:'invalid'},sender),sender);
  assert.equal(bad.ok,false);
  assert.equal(await page.evaluate(async()=>(await send({type:'getState'})).data.error),'');
  await page.evaluate(()=>nativeReceive({type:'done',requestId:'next-task',text:'Next summary',cancelled:false}));
  // 导航撤销网页授权，只有重新进入模式后才可发起请求。
  await page.evaluate(()=>tabUpdated(1,{status:'loading'}));
  await page.waitForTimeout(30);
  assert.equal((await page.evaluate(sender=>send({type:'hoverTranslate',requestId:'after-navigation',text:'Blocked',paths:[[0,8]],kind:'translate'},sender),sender)).ok,false);
  console.log('PASS: source omission/clear semantics, cancellation before connection, ignored late events, next-task recovery and navigation authorization.');
  console.log('PASS: summary request, per-page temporary cache, cancelled-result exclusion, shortcut entry and exit authorization.');
  console.log('PASS: hover activation, saved preferences, document-scoped routing, cross-tab rejection, inline cancellation.');
  console.log('PASS: screenshot crop at 2x, source forwarding, stale event filtering, stream/cancel/error completion, content-script boundary.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
