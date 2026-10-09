const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const pages = ['dashboard','tasks','kanban','calendar','timetable','analytics','myday','projects','eisenhower','goals','habits','notes','reports','archive','lifebalance','progress','review'];


async function run(){
 const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!['index.html','styles.css','app.js','config.js','manifest.json','icon-192.png','icon-512.png'].includes(name))return res.writeHead(404).end();
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(name)]||'application/octet-stream');res.end(fs.readFileSync(path.join(root,name)));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath,headless:true});
 const failures=[];
 try{
 const page=await browser.newPage({serviceWorkers:'block',timezoneId:'Africa/Cairo'});
 const origin=process.env.RESPONSIVE_URL||'http://127.0.0.1:'+server.address().port;
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin);
 await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
 await page.evaluate(()=>{
       currentUser='اختبار';
      localStorage.setItem(userKey('onboarded'),'1');
      const put=(key,data)=>localStorage.setItem(userKey(key),JSON.stringify(data));
      const tasks=[normalizeTask({id:'t1',title:'مهمة تجريبية',priority:'high',status:'in-progress',due:todayStr(),myDay:todayStr(),recurring:'daily',estimated_hours:1,logged_hours:.5,dependencies:['t2'],category:'العمل',project:'p1',tags:['اختبار']}),normalizeTask({id:'t2',title:'مهمة منجزة',priority:'low',status:'done',completedAt:Date.now(),due:todayStr(),logged_hours:1})];
      put('taskflow_tasks',tasks);
      put('taskflow_activity',[{text:'Created: "مهمة تجريبية"',type:'success',time:Date.now()},{text:'Moved "مهمة تجريبية" to in-progress',type:'info',time:Date.now()}]);
      put('taskflow_projects',[normalizeProject({id:'p1',name:'مشروع تجريبي'})]);
      put('taskflow_goals',[normalizeGoal({id:'g1',title:'هدف تجريبي',type:'weekly',target:10,current:2})]);
      put('taskflow_habits',[normalizeHabit({id:'h1',name:'عادة تجريبية',completions:{[todayStr()]:true}})]);
      put('taskflow_notes',[{id:'n1',title:'ملاحظة تجريبية',content:'نص تجريبي',folder:'',createdAt:Date.now(),updatedAt:Date.now()}]);
      put('taskflow_events',[{id:'e1',title:'اجتماع تجريبي',date:todayStr(),time:'12:30',type:'meeting'}]);
      put('taskflow_archive',[{...tasks[1],id:'a1',archivedAt:Date.now()}]);
      put('taskflow_templates',[{id:'tpl1',name:'قالب تجريبي',tasks:[tasks[0]]}]);
      put('taskflow_filters',[{id:'f1',name:'تصفية تجريبية'}]);
      put('taskflow_challenges',[normalizeChallenge({id:'ch1',title:'تحدٍ تجريبي',metric:'tasks',target:20,days:7,status:'active'})]);

 put('taskflow_timetable_blocks',[{id:'b1',title:'Study session / جلسة دراسة',date:todayStr(),start:660,end:900,priority:'high'},{id:'b2',title:'Project planning',date:todayStr(),start:930,end:1140,priority:'medium'},{id:'b3',title:'Early start',date:todayStr(),start:480,end:510,priority:'low'}]);
 enterApp();
 document.getElementById('syncStatusBtn').style.display='flex';
 document.getElementById('installBtn').style.display='flex';
 });
 for(const width of [320,360,390,600,768,900,1024,1440]){
 await page.setViewportSize({width,height:844});
 for(const language of ['en','ar']){
 await page.evaluate(language=>{if(lang!==language)toggleLang();},language);
 for(const name of pages){
 await page.evaluate(name=>{showPage(name);document.getElementById('syncStatusBtn').style.display='flex';document.getElementById('installBtn').style.display='flex';},name);
 const bad=await page.evaluate(()=>[...document.querySelectorAll('.page.active,.page.active *, .topbar, .topbar *')].filter(el=>{
  if(!el.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})||el.closest('.kanban-board,.heatmap-wrap,.gantt-container,.notes-sidebar'))return false;
  const r=el.getBoundingClientRect();return r.width>0&&(r.left < -1||r.right>innerWidth+1);
 }).map(el=>el.tagName+'#'+el.id+'.'+el.className).slice(0,12));
 if(bad.length)failures.push({width,language,name,bad});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name}: document fits at ${width}px (${language})`);
 if(name==='timetable'){
 const geometry=await page.evaluate(()=>{const grid=document.getElementById('ttGrid'),r=grid.getBoundingClientRect(),side=document.querySelector('.tt-side').getBoundingClientRect();return {width:r.width,height:r.height,expected:parseFloat(grid.style.height),bottom:r.bottom,sideTop:side.top,block:document.querySelector('.tt-block').getBoundingClientRect().width};});
 if(geometry.width<150||geometry.height!==geometry.expected||(width<=900&&geometry.sideTop<geometry.bottom)||geometry.block<130)failures.push({width,language,name,geometry});
 assert.equal(await page.locator('#ttGrid').evaluate(grid=>{const r=grid.getBoundingClientRect();return [...grid.querySelectorAll('.tt-block')].every(el=>{const b=el.getBoundingClientRect();return b.top>=r.top&&b.bottom<=r.bottom;});}),true,'All blocks stay inside the timeline, including outside working hours');
 await page.locator('.tt-complete-toggle').first().click();
 assert.equal(await page.locator('.tt-manual-block.tt-done').count(),1);
 await page.locator('.tt-complete-toggle').first().click();
 await page.locator('.tt-manual-block .tt-block-title').first().click();
 assert.equal(await page.locator('#timetableBlockModal').isVisible(),true);
 await page.evaluate(()=>closeTimetableBlockModal());
 }
 }
 for(const fn of ['openModal','openSettings','openProjectModal','openGoalModal','openHabitModal','openNoteEditor','openEventModal','openTimetableBlockModal','openChallengeModal','openPomodoro','openTemplatesModal','openSavedFilters']){
 await page.evaluate(fn=>{document.querySelectorAll('.modal-overlay,.focus-overlay').forEach(el=>el.classList.remove('active'));globalThis[fn]();},fn);
 const bad=await page.evaluate(()=>[...document.querySelectorAll('.modal-overlay.active *, .focus-overlay.active *')].filter(el=>{if(!el.checkVisibility())return false;const r=el.getBoundingClientRect();return r.width>0&&(r.left < -1||r.right>innerWidth+1);}).map(el=>el.tagName+'#'+el.id+'.'+el.className).slice(0,10));
 if(bad.length)failures.push({width,language,fn,bad});
 }
 await page.evaluate(()=>document.querySelectorAll('.modal-overlay,.focus-overlay').forEach(el=>el.classList.remove('active')));
 }
 }
 fs.mkdirSync(path.join(root,'../artifacts'),{recursive:true});
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{showPage('timetable');document.documentElement.setAttribute('data-theme','dark');});
 await page.screenshot({path:path.join(root,'../artifacts/timetable-mobile-ar.png'),fullPage:true});
 await page.evaluate(()=>toggleLang());
 await page.screenshot({path:path.join(root,'../artifacts/timetable-mobile-en.png'),fullPage:true});
 console.log(JSON.stringify(failures,null,2));
 assert.equal(failures.length,0,'Responsive overflow or timetable geometry failures');
 console.log('PASS responsive: 17 pages and 12 dialogs at 8 widths in English and Arabic');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
