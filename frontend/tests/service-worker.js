const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('mocked push retains alarm flags and notification click opens the application scope',async()=>{
  const events={};let notification,opened,focused=false;
  const self={location:{origin:'https://example.test'},registration:{scope:'https://example.test/TaskFlow-Pro/',showNotification:async(title,options)=>notification={title,options}},clients:{
    matchAll:async()=>[{url:'https://example.test/unrelated/',focus:async()=>{focused=true;}}],
    openWindow:async(url)=>{opened=url;}
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),{self,URL,Date,addEventListener:(event,fn)=>events[event]=fn});
  let work;
  events.push({data:{json:()=>({title:'Important',body:'Task',important:true,tag:'task-123'})},waitUntil:promise=>work=promise});await work;
  assert.equal(notification.options.requireInteraction,true);assert.equal(notification.options.tag,'task-123');assert.ok(notification.options.vibrate.length>0);
  let closed=false;
  events.notificationclick({notification:{close:()=>{closed=true;}},waitUntil:promise=>work=promise});await work;
  assert.equal(closed,true);assert.equal(focused,false);assert.equal(opened,'./index.html');
});
test('push remembers Arabic after worker restart and preserves user-written titles',async()=>{
  const stored=new Map();let notification;
  const cache={put:async(key,response)=>stored.set(key,await response.text()),match:async key=>stored.has(key)?new Response(stored.get(key)):undefined};
  const caches={open:async()=>cache};
  const self={registration:{scope:'https://example.test/TaskFlow-Pro/',showNotification:async(title,options)=>{notification={title,options};}}};
  const load=()=>{
    const events={};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),{self,caches,Response,URL,Date,addEventListener:(name,fn)=>{events[name]=fn;}});
    return events;
  };
  let events=load(),work;
  events.message({data:{type:'TASKFLOW_LANGUAGE',language:'ar'},waitUntil:promise=>{work=promise;}});await work;
  events=load();
  events.push({data:{json:()=>({title:'Reminder: English user title',body:'Task "English user title" is due!',tag:'task-1',important:true})},waitUntil:promise=>{work=promise;}});await work;
  assert.equal(notification.title,'تذكير: English user title');
  assert.equal(notification.options.body,'حان موعد المهمة «English user title»!');
  assert.equal(notification.options.dir,'rtl');
  assert.equal(notification.options.requireInteraction,true);
  events.push({data:{json:()=>({title:'English meeting title',body:'Coming up now',tag:'event-1'})},waitUntil:promise=>{work=promise;}});await work;
  assert.equal(notification.title,'English meeting title');
  assert.equal(notification.options.body,'حان الموعد الآن');
  events.message({data:{type:'TASKFLOW_LANGUAGE',language:'en'},waitUntil:promise=>{work=promise;}});await work;
  events.push({data:{json:()=>({title:'Reminder: Work',body:'Time block is starting!',tag:'timetable-1'})},waitUntil:promise=>{work=promise;}});await work;
  assert.equal(notification.title,'Reminder: Work');
  assert.equal(notification.options.body,'Time block is starting!');
  assert.equal(notification.options.dir,'ltr');
});
