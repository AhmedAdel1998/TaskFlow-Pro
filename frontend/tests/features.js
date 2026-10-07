const assert=require('node:assert/strict');
module.exports=async function features(page,step,failures){
  await step('known dashboard counts, goal progress, habit streak and overdue time',async()=>{
    const result=await page.evaluate(()=>{
      const tasks=[
        normalizeTask({id:'done',title:'Done',status:'done',project:'project',completedAt:Date.now(),logged_hours:2}),
        normalizeTask({id:'active',title:'Active',status:'in-progress',due:addDaysToDateStr(todayStr(),-1),estimated_hours:3}),
        normalizeTask({id:'future',title:'Future',status:'todo',due:addDaysToDateStr(todayStr(),1)})
      ];
      saveTasks(tasks);
      for(const id of ['dashDateFilter','dashProjectFilter','dashAssigneeFilter'])document.getElementById(id).value='all';
      renderDashboard();
      const habit={id:'h',completions:{[todayStr()]:true,[addDaysToDateStr(todayStr(),-1)]:true}};
      return {counts:[...document.querySelectorAll('#statsGrid .num')].map(e=>Number(e.textContent)),
        goal:computeGoalProgress({linkType:'project',linkId:'project',type:'weekly',target:2},tasks,[]),
        streak:calcHabitStreak(habit), overdue:isOverdue({status:'todo',due:todayStr(),due_time:'00:00'})};
    });
    assert.deepEqual(result.counts,[3,1,1,1]);assert.equal(result.goal.pct,50);assert.equal(result.streak,2);assert.equal(result.overdue,true);
  },failures);
  await step('task dependencies, subtasks, completion, archive, restore and deletion',async()=>{
    const result=await page.evaluate(()=>{
      saveTasks([normalizeTask({id:'parent',title:'Parent',subtasks:[{text:'step',done:false}]}),normalizeTask({id:'child',title:'Child',dependencies:['parent']})]);
      toggleDone('child');const blocked=loadTasks().find(t=>t.id==='child').status==='todo';
      toggleSubtask('parent',0);const sub=loadTasks().find(t=>t.id==='parent').subtasks[0].done;
      toggleDone('parent');toggleDone('child');const completed=loadTasks().every(t=>t.status==='done');
      archiveTask('child');const archived=loadArchive().some(t=>t.id==='child')&&!loadTasks().some(t=>t.id==='child');
      restoreFromArchive('child');const restored=loadTasks().some(t=>t.id==='child');
      requestDelete('child');confirmAction();
      return {blocked,sub,completed,archived,restored,deleted:!loadTasks().some(t=>t.id==='child')};
    });
    assert.ok(Object.values(result).every(Boolean),JSON.stringify(result));
  },failures);
  await step('task editor preserves all supported fields and rearms changed reminder',async()=>{
    const result=await page.evaluate(()=>{
      const t=normalizeTask({id:'fields',title:'Fields',description:'Description',priority:'high',category:'Work',eisenhower:'q2',due:todayStr(),due_time:'22:00',progress:40,note:'note',estimated_hours:2,logged_hours:1,link:'https://example.com',tags:['tag'],subtasks:[{text:'step',done:true}],recurring:'weekly',reminder:todayStr()+'T23:00',reminderDismissed:true,important:true,milestone:true,comments:[{text:'comment',user:currentUser,time:Date.now()}]});
      saveTasks([t]);openModal(t.id);saveTask();const unchanged=loadTasks()[0];
      openModal(t.id);document.getElementById('taskReminderInput').value=todayStr()+'T23:15';saveTask();const edited=loadTasks()[0];
      return {unchanged,edited};
    });
    assert.equal(result.unchanged.reminderDismissed,true);assert.equal(result.edited.reminderDismissed,false);
    for(const [key,value] of Object.entries({title:'Fields',description:'Description',priority:'high',category:'Work',eisenhower:'q2',due_time:'22:00',progress:40,note:'note',estimated_hours:2,logged_hours:1,recurring:'weekly',important:true,milestone:true}))assert.equal(result.edited[key],value,key);
    assert.equal(result.edited.comments[0].text,'comment');assert.equal(result.edited.subtasks[0].done,true);assert.deepEqual(result.edited.tags,['tag']);
  },failures);
  await step('quick-add syntax and recurrence produce exactly one new copy',async()=>{
    const result=await page.evaluate(()=>{
      saveProjects([{id:'p',name:'Work'}]);openQuickAdd();document.getElementById('quickAddInput').value='Report !high @Office #finance ~Work';handleQuickAdd({key:'Enter'});
      const quick=loadTasks().find(t=>t.title==='Report');
      saveTasks([normalizeTask({id:'repeat',title:'Repeat',status:'done',recurring:'daily',completedAt:Date.now()-2*864e5,due:addDaysToDateStr(todayStr(),-2)})]);
      processRecurring();processRecurring();return {quick,total:loadTasks().length};
    });
    assert.equal(result.quick.priority,'high');assert.equal(result.quick.category,'Office');assert.equal(result.quick.project,'p');assert.deepEqual(result.quick.tags,['finance']);assert.equal(result.total,2);
  },failures);
  await step('reports, achievements, life balance and Pomodoro use known quantities',async()=>{
    const result=await page.evaluate(()=>{
      const original=loadTasks();const archive=loadArchive();
      saveTasks([normalizeTask({id:'timed',title:'Timed',logged_hours:2,status:'todo'}),normalizeTask({id:'finished',title:'Finished',logged_hours:1,status:'done'})]);
      saveArchive([normalizeTask({id:'archivedTodo',title:'Unfinished',status:'todo'})]);
      renderReports();const report=document.getElementById('reportGrid').innerText;
      const badges=computeBadgeContext();
      focusTaskId='timed';focusElapsedSeconds=90;focusLoggedSeconds=0;savePomoTime();savePomoTime();
      const hours=loadTasks().find(t=>t.id==='timed').logged_hours;
      const score=lbDailyScore({sleep:8,exercise:0.5,leisure:2,social:1,study:0,work:8});
      resetPomoTimer();saveTasks(original);saveArchive(archive);
      return {report,count:badges.tasksDoneCount,hours,score};
    });
    assert.match(result.report,/3\.0/);assert.equal(result.count,1);assert.equal(result.hours,2.025);assert.equal(result.score,100);
  },failures);
  await step('unsafe text, category quotes, CSV formulas and missing Excel dependency',async()=>{
    const result=await page.evaluate(()=>{
      const original=loadTasks();const category="Bob's "+'"'+'work';
      saveTasks([normalizeTask({id:'safe',title:'<img src=x onerror=alert(1)>',category,link:'javascript:alert(1)'})]);
      closeSearch();for(const id of ['filterStatus','filterPriority','filterProject','filterAssignee'])document.getElementById(id).value='all';
      renderCategoryNav();const button=[...document.querySelectorAll('.cat-pill')].find(b=>b.textContent===category);button.click();
      renderTasks();const href=document.querySelector('.task-card a')?.getAttribute('href');
      toast('<img src=x onerror=alert(1)>');const injected=document.querySelector('.toast img');
      const csv=csvCell('=SUM(1,2)');
      const lib=globalThis.XLSX;globalThis.XLSX=undefined;exportExcel();globalThis.XLSX=lib;
      const dependencyError=document.getElementById('toastContainer').textContent.includes('Excel library not loaded');
      const categoryValue=document.getElementById('filterCategory').value;
      document.getElementById('filterCategory').value='all';saveTasks(original);
      return {href,injected:!!injected,csv,dependencyError,categoryValue,category};
    });
    assert.equal(result.href,'#');assert.equal(result.injected,false);assert.equal(result.csv,'"\'=SUM(1,2)"');assert.ok(result.dependencyError);assert.equal(result.categoryValue,result.category);
  },failures);
  await step('Escape closes the task modal while an input has focus',async()=>{
    await page.evaluate(()=>openModal());await page.focus('#taskTitleInput');await page.keyboard.press('Escape');
    assert.equal(await page.locator('#taskModal').evaluate(e=>e.classList.contains('active')),false);
  },failures);
  await step('backup validation and task round-trip preserve supported data',async()=>{
    const result=await page.evaluate(()=>{
      let rejected=0;for(const bad of [null,[],{}, {tasks:{}},{tasks:[null]},{tasks:[{id:'same'},{id:'same'}]},{tasks:Array(2001).fill({title:'x'})}]){try{validateBackup(bad);}catch{rejected++;}}
      const original=loadTasks();const copy=validateBackup(JSON.parse(JSON.stringify({tasks:original}))).tasks;
      const projects=validateBackup({projects:[{name:'one'},{name:'two'}]}).projects;
      return {rejected,ids:copy.map(t=>t.id),originalIds:original.map(t=>t.id),unique:new Set(projects.map(p=>p.id)).size};
    });
    assert.equal(result.rejected,7);assert.deepEqual(result.ids,result.originalIds);assert.equal(result.unique,2);
  },failures);
  await step('real API sync, reload, offline edit and reconnection',async()=>{
    await page.waitForFunction(()=>!syncInFlight&&!hydrationInFlight);
    await page.evaluate(async()=>{await flushSyncQueue();});
    await page.waitForFunction(()=>Object.keys(getPendingSync()).length===0);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!currentUser&&!hydrationInFlight&&!syncInFlight);
    assert.equal(await page.evaluate(()=>loadTasks().length),2);
    await page.context().setOffline(true);
    await page.evaluate(()=>{const tasks=loadTasks();tasks[0].title='Offline preserved';saveTasks(tasks);});
    await page.waitForFunction(()=>!syncInFlight);
    assert.ok(await page.evaluate(()=>Object.keys(getPendingSync()).length>0));
    await page.context().setOffline(false);
    await page.evaluate(async()=>{await flushSyncQueue();});
    await page.waitForFunction(()=>Object.keys(getPendingSync()).length===0);
    const persisted=await page.evaluate(async()=>JSON.parse((await apiRaw('/api/data','GET')).find(x=>x.key===userKey('taskflow_tasks')).value)[0].title);
    assert.equal(persisted,'Offline preserved');
  },failures);
  await step('Arabic RTL and mobile navigation',async()=>{
    await page.evaluate(()=>{lang='ar';applyLang();showPage('tasks');});
    assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
    await page.setViewportSize({width:390,height:844});
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(e).position!=='fixed').slice(0,12).map(e=>({tag:e.tagName,cls:e.className,id:e.id,right:e.getBoundingClientRect().right}))}));
    assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));
    await page.evaluate(()=>{lang='en';applyLang();});
    await page.setViewportSize({width:1280,height:800});
  },failures);
  await step('local calendar dates across Cairo midnight and DST',async()=>{
    const result=await page.evaluate(()=>({
      midnight:localDateStr(new Date('2026-10-06T22:30:00Z')),
      summer:reminderUtc('2026-10-07T09:00'),winter:reminderUtc('2026-12-07T09:00'),
      monthly:localDateStr(advanceRecurrence(new Date('2026-01-31T12:00:00'),'monthly'))
    }));
    assert.equal(result.midnight,'2026-10-07');assert.equal(result.summer,'2026-10-07T06:00:00.000Z');assert.equal(result.winter,'2026-12-07T07:00:00.000Z');
    assert.equal(result.monthly,'2026-02-28');
  },failures);
  await step('PWA subpath offline startup and app asset availability',async()=>{
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await page.context().setOffline(true);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('#appContainer',{state:'visible'});
    assert.equal(await page.evaluate(()=>typeof loadTasks),'function');
    await page.context().setOffline(false);
  },failures);
  await step('logout clears credentials and account switching isolates templates and tasks',async()=>{
    const result=await page.evaluate(async()=>{
      const oldUser=currentUser;saveTemplates([{name:'private'}]);await flushSyncQueue();doLogout();
      const cleared=getAuthSession(oldUser)===null;
      const name='switch'+Date.now();const auth=await apiRegister(name,'password123');saveAuthSession(name,auth);finishLogin(name);skipOnboarding();
      return {cleared,tasks:loadTasks().length,templates:loadTemplates().length,users:loadUsers()};
    });
    assert.equal(result.cleared,true);assert.equal(result.tasks,0);assert.equal(result.templates,0);assert.equal(result.users.length,1);
  },failures);
  await step('Kanban transitions, matrix placement, and reserved timetable hours',async()=>{
    const result=await page.evaluate(()=>{
      const original=loadTasks(),reserved=loadTimetableBlocks();
      saveTasks([normalizeTask({id:'schedule',title:'Schedule',due:todayStr(),estimated_hours:1,eisenhower:'q1'})]);
      dragTaskId='schedule';kanbanDrop({preventDefault(){},currentTarget:{classList:{remove(){}}}},'done');
      const complete=loadTasks()[0];
      dragTaskId='schedule';kanbanDrop({preventDefault(){},currentTarget:{classList:{remove(){}}}},'todo');
      const reopened=loadTasks()[0];renderEisenhower();
      const matrix=document.getElementById('page-eisenhower').innerText.includes('Schedule');
      saveTimetableBlocks([{id:'reserved',date:todayStr(),start:540,end:600,title:'Reserved'}]);
      const schedule=buildTimetableSchedule(todayStr(),{start:9,end:12});
      saveTasks(original);saveTimetableBlocks(reserved);
      return {complete,reopened,matrix,schedule};
    });
    assert.equal(result.complete.progress,100);assert.equal(result.reopened.completedAt,null);assert.equal(result.reopened.progress,0);assert.ok(result.matrix);
    assert.equal(result.schedule.reservedMin,60);assert.equal(result.schedule.blocks[0].start,600);
  },failures);
  await step('calendar reminder rearming, alarm dismissal and mocked snooze timer',async()=>{
    const result=await page.evaluate(()=>{
      openEventModal(todayStr());document.getElementById('eventTitleInput').value='Reminder event';
      document.getElementById('eventRemindInput').value='10';document.getElementById('eventImportantInput').checked=true;saveEvent();
      const event=loadEvents().find(e=>e.title==='Reminder event');
      checkEventReminders(new Date(new Date(event.date+'T'+event.time).getTime()-600000));
      const fired=loadEvents().find(e=>e.id===event.id).reminderFired;
      const alarm=document.getElementById('alarmModal').classList.contains('active');dismissAlarm();
      editEvent(event.id);document.getElementById('eventTimeInput').value='11:00';saveEvent();
      const rearmed=!loadEvents().find(e=>e.id===event.id).reminderFired;
      triggerAlarm('Test','Snooze');const originalTimeout=window.setTimeout;let delay;
      window.setTimeout=(fn,ms)=>{if(ms===300000){delay=ms;return 999999;}return originalTimeout(fn,ms);};
      try{snoozeAlarm();}finally{window.setTimeout=originalTimeout;dismissAlarm();}
      return {fired,alarm,rearmed,delay,dismissed:!document.getElementById('alarmModal').classList.contains('active')};
    });
    assert.ok(result.fired&&result.alarm&&result.rearmed&&result.dismissed);assert.equal(result.delay,300000);
  },failures);
  await step('root hosting loads the same independent frontend',async()=>{
    await page.goto(new URL('/index.html',page.url()).href,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#appContainer',{state:'visible'});
    assert.equal(await page.evaluate(()=>typeof saveTasks),'function');
    const response=await page.request.get(new URL('/config.js',page.url()).href);
    assert.equal(response.status(),200);assert.match(await response.text(),/http:\/\/localhost:5299/);
  },failures);
  await step('clear account data persists server deletions across reload',async()=>{
    await page.waitForFunction(()=>!syncInFlight&&!hydrationInFlight);
    await page.evaluate(async()=>{await flushSyncQueue();});
    await page.waitForFunction(()=>!syncInFlight);
    page.once('dialog',dialog=>dialog.accept());
    await page.evaluate(async()=>{await clearAllData();});
    await page.waitForFunction(()=>!syncInFlight&&Object.keys(getPendingSync()).length===0);
    const data=await page.evaluate(async()=>await apiRaw('/api/data','GET'));
    assert.equal(data.length,0);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!currentUser&&!hydrationInFlight);
    assert.equal(await page.evaluate(()=>loadTasks().length),0);
  },failures);
};
