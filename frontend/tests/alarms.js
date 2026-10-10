const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function alarmTime('),source.indexOf('function saveTasks(')),context);
const time=(item,kind)=>context.alarmTime(item,kind);
test('alarms follow task due time and timetable start without a custom reminder',()=>{
  assert.equal(time({important:true,due:'2026-10-11',due_time:'13:45'}),'2026-10-11T13:45');
  assert.equal(time({important:true,date:'2026-10-11',start:0},'timetable'),'2026-10-11T00:00');
  assert.equal(time({important:true,date:'2026-10-11',start:785},'timetable'),'2026-10-11T13:05');
  assert.equal(time({important:false,due:'2026-10-11',due_time:'13:45'}),'');
  assert.equal(time({important:true,due:'2026-10-11'}),'');
  assert.equal(time({important:true,date:'2026-10-11',start:1440},'timetable'),'');
  assert.equal(time({important:true,reminder:'2026-10-11T12:00',due:'2026-10-11',due_time:'13:45'}),'2026-10-11T12:00');
});

test('permission is not reported as background success when server subscription fails',async()=>{
  const messages=[];
  const ctx=vm.createContext({
    currentUser:'alice',apiConfigured:()=>true,getAuthSession:()=>({}),
    navigator:{serviceWorker:{ready:Promise.resolve({pushManager:{getSubscription:async()=>({toJSON:()=>({endpoint:'test',keys:{p256dh:'key',auth:'auth'}})})}})}},
    PushManager:function(){},setTimeout:()=>{},Date,
    apiRaw:async()=>{throw new Error('offline');},tr:k=>k,toast:msg=>messages.push(msg)
  });
  vm.runInContext(source.slice(source.indexOf('async function subscribeToPush('),source.indexOf('function renderCategoryNav(')),ctx);
  assert.equal(await ctx.subscribeToPush(true),false);
  assert.deepEqual(messages,['push_setup_failed']);
  ctx.apiRaw=async()=>{};
  assert.equal(await ctx.subscribeToPush(true),true);
  assert.deepEqual(messages,['push_setup_failed','notif_enabled']);
});
