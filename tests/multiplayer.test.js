import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

let server, handler, url;
before(async () => {
  server = spawn(process.env.PYTHON || 'python', ['-u', 'tests/redis_server.py'], {
    env: {...process.env, PYTHONPATH: path.resolve('.test-deps')}, stdio: ['ignore','pipe','pipe']
  });
  server.stderr.on('data', d => process.stderr.write(d));
  const [chunk] = await Promise.race([once(server.stdout,'data'), once(server,'exit').then(() => { throw Error('Install tests/requirements.txt'); })]);
  url = 'http://127.0.0.1:' + String(chunk).trim();
  process.env.KV_REST_API_URL = url; process.env.KV_REST_API_TOKEN = 'local-test';
  handler = (await import('../api/match.js')).default;
});
after(() => server?.kill());
const player = n => ({pid:'player-'+n,peer:'session-'+n,nick:'PLAYER'+n});
async function request(body, method='POST') {
  if (body && typeof body === 'object') body = { protocol: 3, ...body };
  let status, result;
  await handler({method,body}, {setHeader(){},status(v){status=v;return this;},json(v){result=v;}});
  return {status,...result};
}
async function call(body) { const j = await request(body); assert.equal(j.ok,true,JSON.stringify(j)); return j; }
async function pair(prefix) {
  const h=player(prefix+'-h'), g=player(prefix+'-g');
  await call({...h,action:'code_create',code:prefix.toUpperCase()});
  await call({...g,action:'code_join',code:prefix.toUpperCase()});
  return {h,g,room:h.peer};
}
const relay = (who, room, seq, msgs=[], ack=0, state=null) => call({...who,room,action:'relay',seq,msgs,ack,state});

test('100 concurrent searches make 50 exclusive pairs; lost responses are repeatable',async()=>{
  const players=Array.from({length:100},(_,i)=>player('load'+i));
  await Promise.all(players.map(p=>call({...p,action:'poll'})));
  const results=await Promise.all(players.map(p=>call({...p,action:'poll'})));
  const pairs=new Set();
  results.forEach((r,i)=>{
    assert.equal(r.status,'matched');
    const other=players.findIndex(p=>p.pid===r.opp.pid);
    assert.notEqual(other,-1); assert.notEqual(other,i);
    assert.equal(results[other].opp.pid,players[i].pid);
    pairs.add([players[i].pid,r.opp.pid].sort().join(':'));
  });
  assert.equal(pairs.size,50);
  const again=await Promise.all(players.map(p=>call({...p,action:'poll'})));
  assert.deepEqual(again,results);
});
test('late cancellation cannot remove a new search; delayed old poll stays cancelled',async()=>{
  const old=player('cancel'), fresh={...old,peer:'session-fresh'};
  await call({...old,action:'poll'}); await call({...fresh,action:'poll'});
  await call({...old,action:'leave'});
  assert.equal((await request({...old,action:'poll'})).status,409);
  const match=await call({...player('cancel-rival'),action:'poll'});
  assert.equal(match.opp.peer,fresh.peer);
});
test('private room permits one of 30 joiners and retries return the same opponent',async()=>{
  const h=player('private-h'); await call({...h,action:'code_create',code:'PRIVAT'});
  const guests=Array.from({length:30},(_,i)=>player('private'+i));
  const results=await Promise.all(guests.map(p=>request({...p,action:'code_join',code:'PRIVAT'})));
  assert.equal(results.filter(r=>r.ok).length,1);
  const index=results.findIndex(r=>r.ok);
  assert.deepEqual(await request({...guests[index],action:'code_join',code:'PRIVAT'}),results[index]);
  assert.equal((await call({...h,action:'poll',private:true})).opp.pid,guests[index].pid);
});
test('lost send/read responses: events survive, retry is idempotent and ack deletes them',async()=>{
  const {h,g,room}=await pair('reliable');
  await relay(h,room,1,[{t:'shot',n:1},{t:'round',n:1}]);
  await relay(h,room,1,[{t:'shot',n:1},{t:'round',n:1}]);
  const lost=await relay(g,room,1);
  const retry=await relay(g,room,1);
  assert.deepEqual(retry.events,lost.events); assert.equal(retry.events.length,2);
  assert.deepEqual(retry.events.map(e=>e.m.t),['shot','round']);
  const next=await relay(g,room,2,[],retry.events.at(-1).id);
  assert.deepEqual(next.events,[]);
});
test('latest position replaces old state and is not replayed as a durable event',async()=>{
  const {h,g,room}=await pair('position');
  for(let i=1;i<=50;i++) await relay(h,room,i,[],0,{t:'s',q:i,x:i});
  const result=await relay(g,room,1);
  assert.equal(result.state.q,50); assert.deepEqual(result.events,[]);
});
test('rooms isolate packets and nonparticipants cannot signal, relay, exit or claim',async()=>{
  const a=await pair('isolated-a'), b=await pair('isolated-b');
  await relay(a.h,a.room,1,[{t:'shot'}]);
  assert.deepEqual((await relay(b.g,b.room,1)).events,[]);
  for(const action of ['relay','exit','claim','signal']) {
    const r=await request({...b.g,room:a.room,action,seq:1,ack:0,msgs:[],kind:'offer',sdp:'abc'});
    assert.equal(r.status,403);
  }
});
test('brief interruption does not grant a win; explicit exit has one winner',async()=>{
  const {h,g,room}=await pair('forfeit');
  assert.equal((await call({...h,room,action:'claim'})).decided,false);
  await call({...g,room,action:'exit'});
  assert.equal((await call({...h,room,action:'claim'})).winner,true);
  assert.equal((await call({...g,room,action:'claim'})).winner,false);
});
test('20 second heartbeat grace and deterministic single winner after both disconnect',async()=>{
  const {h,g,room}=await pair('timeout');
  await fetch(url,{method:'POST',body:JSON.stringify(['h','g'].map(role=>['SET','gc:v3:seen:'+room+':'+role,String(Date.now()-21000)]))});
  const results=await Promise.all([h,g].map(p=>call({...p,room,action:'claim'})));
  assert.equal(results.filter(r=>r.winner).length,1);
});
test('out of order batches rejected; overflow preserves existing events',async()=>{
  const {h,g,room}=await pair('bounded');
  assert.equal((await request({...h,room,action:'relay',seq:2,ack:0,msgs:[]})).status,409);
  for(let seq=1;seq<=8;seq++) await relay(h,room,seq,Array.from({length:60},(_,i)=>({t:'shot',i})));
  assert.equal((await request({...h,room,action:'relay',seq:9,ack:0,msgs:Array.from({length:60},()=>({t:'shot'}))})).status,429);
  const r=await relay(g,room,1); assert.equal(r.events.length,100); assert.equal(r.events[0].id,101);
});
test('invalid payloads return controlled errors',async()=>{
  assert.equal((await request({...player('old-version'),action:'poll',protocol:2})).status,409);
  assert.equal((await request('bad-json')).status,400);
  assert.equal((await request(null)).status,400);
  assert.equal((await request({},'GET')).status,405);
  const {h,room}=await pair('invalid');
  for(const msgs of [null,{},[{t:'s'}],Array(61).fill({t:'shot'}),[{t:'shot',data:'x'.repeat(5000)}]]) {
    assert.equal((await request({...h,room,action:'relay',seq:1,ack:0,msgs})).status,400);
  }
});
test('Redis script eviction reloads the atomic operation without losing a match',async()=>{
  const {h,g}=await pair('eviction');
  await fetch(url,{method:'POST',body:JSON.stringify([['SCRIPT','FLUSH']])});
  assert.equal((await call({...h,action:'poll'})).opp.pid,g.pid);
});
test('cancelling after an unseen match notifies the assigned opponent',async()=>{
  const {h,g,room}=await pair('cancelled-match');
  await call({...g,action:'leave'});
  assert.equal((await relay(h,room,1)).left,true);
  assert.equal((await call({...h,room,action:'claim'})).winner,true);
});
