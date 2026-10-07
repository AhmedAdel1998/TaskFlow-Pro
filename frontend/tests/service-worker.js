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
