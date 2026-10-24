// End-to-end smoke test against a local server + Lua Redis emulator.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const redis = spawn(process.env.PYTHON || 'python',['-u','tests/redis_server.py'],{env:{...process.env,PYTHONPATH:path.resolve('.test-deps')},stdio:['ignore','pipe','pipe']});
redis.stderr.on('data', d=>process.stderr.write(d));
const [port] = await once(redis.stdout,'data');
process.env.KV_REST_API_URL='http://127.0.0.1:'+String(port).trim();
process.env.KV_REST_API_TOKEN='local-test';
const root=process.cwd();
const server=createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://local').pathname;
    if (/^\/api\/[a-z]+$/.test(pathname)) {
      const chunks=[]; for await(const chunk of req) chunks.push(chunk);
      const handler=(await import(pathToFileURL(path.join(root,pathname+'.js')))).default;
      await handler({method:req.method,body:Buffer.concat(chunks).toString() || undefined}, {
        setHeader:(...args)=>res.setHeader(...args),
        status(code){res.statusCode=code;return this;},
        json(body){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));}
      });
    } else {
      const filename=pathname==='/'?'index.html':pathname.slice(1);
      if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {res.writeHead(404).end();return;}
      const content=await readFile(path.join(root,filename));
      const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
      res.setHeader('Content-Type',types[path.extname(filename)] || 'application/octet-stream');res.end(content);
    }
  } catch(error) {res.writeHead(500).end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'chromium', args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-features=WebRtcHideLocalIpsWithMdns']});
  const errors=[];
  if (!process.env.DIRECT_ONLY) {
  const gate=await browser.newPage({viewport:{width:390,height:844}});
  gate.on('pageerror',e=>errors.push(e.message));
  await gate.goto(url);
  assert.equal(await gate.locator('.ig-btn').count(),3);
  assert.equal(await gate.locator('[data-ig="gamingcitysanisidro"]').getAttribute('href'),'https://www.instagram.com/gamingcitysanisidro/');
  for (const name of ['gamingcitycomputacion','gamingcitybelgrano']) {
    await gate.locator(`[data-ig="${name}"]`).evaluate(el=>{el.addEventListener('click',e=>e.preventDefault(),{once:true});el.click();});
  }
  await gate.waitForTimeout(500);
  assert.equal(await gate.locator('#gate-follow-ok').isDisabled(),true);
  await gate.locator('[data-ig="gamingcitysanisidro"]').evaluate(el=>{el.addEventListener('click',e=>e.preventDefault(),{once:true});el.click();});
  await gate.waitForFunction(()=>!document.querySelector('#gate-follow-ok').disabled);
  await mkdir('test-output',{recursive:true});
  await gate.screenshot({path:'test-output/san-isidro-mobile.png',fullPage:true});
  console.log('PASS mobile: three branches and follow gate');
  await gate.close();

  const contexts=[]; const pages=[]; let lost=false;
  for(let i=0;i<2;i++) {
    const context=await browser.newContext({viewport:{width:1280,height:720}});contexts.push(context);
    await context.addInitScript(({i})=>{
      window.GC_FORCE_RELAY=true;window.GC_DEBUG=true;
      const pid='browser-player-'+i;
      localStorage.setItem('gc_pid',JSON.stringify(pid));
      localStorage.setItem('gc_player',JSON.stringify({pid,nick:'TEST'+i,ig:'test'+i,synced:true}));
      localStorage.setItem('gc_sound','false');
    },{i});
    const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));
    // Delay responses to emulate a remote player. Lose one response AFTER the
    // server executed it, the failure that used to destroy relay events.
    if(i===1) await page.route('**/api/match',async route=>{
      const body=route.request().postDataJSON();
      const response=await route.fetch();
      if(!lost && body.action==='relay' && body.msgs?.length) {lost=true;await route.abort('failed');return;}
      await new Promise(r=>setTimeout(r,100+Math.random()*80));
      await route.fulfill({response});
    });
    await page.goto(url);
  }
  await Promise.all(pages.map(p=>p.locator('#play-online').click()));
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.__gc?.state().M?.mode==='online',{},{timeout:30000})));
  assert.equal(lost,true);
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.__gc.state().S.rt.q>3,{},{timeout:15000})));
  console.log('PASS relay: two browsers start and exchange states after response loss + latency/jitter');
  await contexts[1].setOffline(true);
  await pages[0].waitForTimeout(4000);
  assert.equal(await pages[0].evaluate(()=>!!window.__gc.state().M.result),false);
  await contexts[1].setOffline(false);
  const q=await pages[0].evaluate(()=>window.__gc.state().S.rt.q);
  await pages[0].waitForFunction(q=>window.__gc.state().S.rt.q>q,q,{timeout:15000});
  assert.equal(await pages[0].evaluate(()=>!!window.__gc.state().M.result),false);
  await pages[0].screenshot({path:'test-output/online-reconnected.png'});
  console.log('PASS reconnection: 4s interruption recovers without forfeit');
  await pages[1].evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  await pages[0].waitForFunction(()=>!!window.__gc.state().M.result,{},{timeout:15000});
  assert.equal(await pages[0].evaluate(()=>window.__gc.state().M.result.won),true);
  assert.deepEqual(errors,[]);
  console.log('PASS exit: opponent wins once; no browser JavaScript errors');
  await Promise.all(contexts.map(c=>c.close()));
  }
  console.log('Testing direct WebRTC');
  const direct=[];
  for(let i=0;i<2;i++) {
    const context=await browser.newContext({viewport:{width:1280,height:720}});
    await context.addInitScript(({i})=>{
      window.GC_DEBUG=true;
      window.testConnections=[]; window.testIceEvents=[];
      const Original=window.RTCPeerConnection;
      window.RTCPeerConnection=class extends Original {
        constructor(...args){super(...args);window.testConnections.push(this);
          this.addEventListener('iceconnectionstatechange',()=>window.testIceEvents.push(this.iceConnectionState));
          this.addEventListener('icecandidateerror',e=>window.testIceEvents.push('error:'+e.errorCode));
        }
        async setRemoteDescription(...args) {try{return await super.setRemoteDescription(...args);}catch(e){window.testIceEvents.push(e.message);throw e;}}
      };
      const pid='direct-player-'+i;
      localStorage.setItem('gc_pid',JSON.stringify(pid));
      localStorage.setItem('gc_player',JSON.stringify({pid,nick:'DIRECT'+i,ig:'direct'+i,synced:true}));
      localStorage.setItem('gc_sound','false');
    },{i});
    const page=await context.newPage();direct.push(page);page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/ice',route=>route.fulfill({json:{ok:true,iceServers:[]}}));
    await page.goto(url,{waitUntil:'domcontentloaded'});
  }
  await Promise.all(direct.map(p=>p.locator('#play-online').click()));
  try {
    await Promise.all(direct.map(p=>p.waitForFunction(()=>window.__gc?.state().S?.rt.q>3 && document.querySelector('#net-badge').textContent.includes('Directa'),{},{timeout:30000})));
  } catch(error) {
    console.error('Direct diagnostics:',JSON.stringify(await Promise.all(direct.map(p=>p.evaluate(()=>({
      badge:document.querySelector('#net-badge').textContent,search:document.querySelector('#s-sub').textContent,
      round:window.__gc?.state().M?.roundNo,received:window.__gc?.state().S?.rt.q,
      events:window.testIceEvents,
      peers:window.testConnections.map(pc=>({connection:pc.connectionState,ice:pc.iceConnectionState,signaling:pc.signalingState}))
    }))))));
    console.error('Browser errors:',errors);throw error;
  }
  await direct[0].evaluate(()=>window.testConnections.forEach(pc=>pc.close()));
  await Promise.all(direct.map(p=>p.waitForFunction(()=>document.querySelector('#net-badge').textContent.includes('Servidor'),{},{timeout:15000})));
  const prior=await direct[1].evaluate(()=>window.__gc.state().S.rt.q);
  await direct[1].waitForFunction(q=>window.__gc.state().S.rt.q>q,prior,{timeout:10000});
  assert.equal(await direct[1].evaluate(()=>!!window.__gc.state().M.result),false);
  assert.deepEqual(errors,[]);
  console.log('PASS WebRTC: direct channel starts; forced channel closure recovers through server');
} finally {
  await browser?.close();
  server.closeAllConnections();server.close();redis.kill();
}
