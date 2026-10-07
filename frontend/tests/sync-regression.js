const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function harness(fetch){
  const data=new Map();
  const context=vm.createContext({
    localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)},
    navigator:{onLine:true},document:{getElementById:()=>null},fetch,
    toast:()=>{},Date,console,setInterval:()=>{},window:{addEventListener:()=>{}}
  });
  vm.runInContext('let currentUser="alice";'+source.slice(0,source.indexOf('/* ═══════ i18n')),context);
  vm.runInContext('saveAuthSession("alice",{accessToken:"token",refreshToken:"refresh",expiresAt:new Date(Date.now()+600000).toISOString()})',context);
  return {context,data,run:code=>vm.runInContext(code,context)};
}
const response=(status,value)=>({status,ok:status>=200&&status<300,json:async()=>value});
test('failed HTTP writes remain queued for retry',async()=>{
  for(const status of [400,409,429,500]){
    const h=harness(async()=>response(status,{}));
    h.run('setPendingSync({taskflow_tasks_alice:"local"})');
    await h.run('flushSyncQueue()');
    assert.equal(h.run('getPendingSync().taskflow_tasks_alice'),'local');
  }
});
test('in-flight edit is not removed by acknowledgment of an older write',async()=>{
  let release; const h=harness(()=>new Promise(r=>release=r));
  h.run('setPendingSync({taskflow_tasks_alice:"old"})');
  const flushing=h.run('flushSyncQueue()');
  await new Promise(setImmediate);
  h.run('setPendingSync({taskflow_tasks_alice:"new"})');
  release(response(200,{updatedAt:'2026-10-07T00:00:00Z'}));await flushing;
  assert.equal(h.run('getPendingSync().taskflow_tasks_alice'),'new');
});
test('legacy queue migration isolates accounts and excludes credentials',async()=>{
  const sent=[];const h=harness(async(url,opts)=>{sent.push(url);return response(200,{updatedAt:'2026-10-07T00:00:00Z'});});
  h.data.set('taskflow_pending_sync',JSON.stringify({taskflow_tasks_alice:'A',taskflow_tasks_bob:'B',taskflow_tasks_bob_alice:'C',taskflow_auth_alice:'secret'}));
  await h.run('flushSyncQueue()');
  assert.equal(sent.length,1);assert.ok(sent[0].endsWith('taskflow_tasks_alice'));
  assert.equal(JSON.parse(h.data.get('taskflow_pending_sync')).taskflow_tasks_bob,'B');
  assert.equal(JSON.parse(h.data.get('taskflow_pending_sync')).taskflow_tasks_bob_alice,'C');
});
test('hydration preserves unsynced changes and ignores foreign keys',async()=>{
  const h=harness(async(url)=>url.endsWith('/api/data')?response(200,[{key:'taskflow_tasks_alice',value:'server',updatedAt:'date'},{key:'taskflow_tasks_bob',value:'foreign'}]):response(500,{}));
  h.data.set('taskflow_tasks_alice','local');h.run('setPendingSync({taskflow_tasks_alice:"local"})');
  await h.run('hydrateFromServer()');
  assert.equal(h.data.get('taskflow_tasks_alice'),'local');assert.equal(h.data.has('taskflow_tasks_bob'),false);
});
test('concurrent expired requests share one refresh and invalid refresh stops',async()=>{
  let refreshes=0;
  const h=harness(async(url)=>{if(url.endsWith('/refresh')){refreshes++;await new Promise(setImmediate);return response(200,{accessToken:'new',refreshToken:'next',expiresAt:new Date(Date.now()+600000).toISOString()});}return response(200,[]);});
  h.run('saveAuthSession("alice",{accessToken:"old",refreshToken:"refresh",expiresAt:"2000-01-01"})');
  await Promise.all(Array.from({length:8},()=>h.run('apiRaw("/api/data","GET")')));
  assert.equal(refreshes,1);
  let calls=0;const bad=harness(async()=>{calls++;return response(401,{});});
  await assert.rejects(bad.run('apiRaw("/api/data","GET")'));
  await assert.rejects(bad.run('apiRaw("/api/data","GET")'));
  assert.equal(calls,2);assert.equal(bad.run('getAuthSession("alice")'),null);
});
test('account switch during hydration cannot overwrite another account',async()=>{
  let release;const h=harness(()=>new Promise(r=>release=r));
  const hydrate=h.run('hydrateFromServer()');await new Promise(setImmediate);
  h.run('currentUser="bob"');release(response(200,[{key:'taskflow_tasks_alice',value:'server'}]));await hydrate;
  assert.equal(h.data.has('taskflow_tasks_alice'),false);
});
test('storage quota failure rolls back the data instead of losing its queue',()=>{
  const h=harness(async()=>response(200,{}));
  h.data.set('taskflow_tasks_alice','old');
  const original=h.context.localStorage.setItem;
  h.context.localStorage.setItem=(key,value)=>{if(key==='taskflow_pending_sync_alice')throw new Error('QuotaExceededError');original(key,value);};
  assert.throws(()=>h.run('persistData("taskflow_tasks_alice","new")'),/QuotaExceededError/);
  assert.equal(h.data.get('taskflow_tasks_alice'),'old');
});
test('queued deletion survives hydration and is retried as DELETE',async()=>{
  const calls=[];
  const h=harness(async(url,options)=>{
    calls.push(options.method);
    return options.method==='GET'?response(200,[{key:'taskflow_tasks_alice',value:'old',updatedAt:'date'}]):response(204,null);
  });
  h.run('setPendingSync({taskflow_tasks_alice:null})');
  await h.run('hydrateFromServer()');
  assert.equal(h.data.has('taskflow_tasks_alice'),false);
  assert.deepEqual(calls,['GET','DELETE']);
  assert.equal(h.run('Object.keys(getPendingSync()).length'),0);
});
