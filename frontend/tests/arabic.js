const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const pages = ['dashboard','tasks','kanban','calendar','timetable','analytics','myday','projects','eisenhower','goals','habits','notes','reports','archive','lifebalance','progress','review'];

async function untranslated(page, scope = 'body') {
  return page.evaluate(scope => {
    const out = [];
    const visible = el => el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    const check = value => {
      // File formats, URL syntax and keyboard shortcuts intentionally retain their spelling.
      const text = value.replace(/https:\/\/\.\.\.|CSV|JSON|!high|Q/g, '').trim();
      if (/[A-Za-z]/.test(text)) out.push(value);
    };
    const area = document.querySelector(scope);
    const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement.closest('script,style') && visible(node.parentElement)) check(node.textContent);
    }
    for (const el of area.querySelectorAll('[title],[placeholder],[aria-label]')) {
      if (visible(el)) for (const attr of ['title','placeholder','aria-label']) check(el.getAttribute(attr) || '');
    }
    return [...new Set(out)];
  }, scope);
}

async function run() {
  const executablePath = [process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
  assert.ok(executablePath, 'Set CHROME_PATH to a Chromium browser executable');
  const server = http.createServer((req,res) => {
    const name = new URL(req.url,'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html','app.js','config.js','styles.css','manifest.json','icon-192.png','icon-512.png'].includes(name)) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(name)]);
    res.end(fs.readFileSync(path.join(root,name)));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({executablePath,headless:true});
    const page = await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
    const errors = [];
    page.on('pageerror',error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    // This test never contacts the user's API or changes their browser profile.
    await page.route('**/*',route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin);
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
    await page.evaluate(() => { toggleAuthMode(); toggleLang(); });
    assert.equal(await page.locator('#loginSubmitBtn').textContent(),'إنشاء حساب');
    assert.deepEqual(await untranslated(page,'#loginScreen'),[]);
    await page.evaluate(() => doLogin());
    assert.match(await page.locator('#loginError').textContent(),/اسم المستخدم/);
    await page.evaluate(() => {
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
      enterApp();
    });
    assert.equal(await page.evaluate(() => loadTasks().find(t=>t.id==='t2').status),'done');
    await page.evaluate(()=>{document.getElementById('searchInput').value='تجريبية';handleGlobalSearch();});
    assert.deepEqual(await untranslated(page,'#searchResults'),[],'Search priority labels');
    await page.evaluate(()=>{closeSearch();document.getElementById('searchInput').value='';});
    for (const name of pages) {
      await page.evaluate(name => showPage(name),name);
      assert.deepEqual(await untranslated(page),[],`Untranslated populated page: ${name}`);
    }
    await page.evaluate(() => {showPage('lifebalance');toggleLbSources();});
    assert.deepEqual(await untranslated(page),[],'Life Balance sources');
    for (const fn of ['openModal','openSettings','openProjectModal','openGoalModal','openHabitModal','openNoteEditor','openEventModal','openTimetableBlockModal','openChallengeModal','openPomodoro','openTemplatesModal','openSavedFilters']) {
      await page.evaluate(fn => {
        document.querySelectorAll('.modal-overlay,.focus-overlay').forEach(el=>el.classList.remove('active'));
        globalThis[fn]();
      },fn);
      assert.deepEqual(await untranslated(page),[],`Untranslated modal: ${fn}`);
    }
    await page.evaluate(() => {
      document.querySelectorAll('.modal-overlay,.focus-overlay').forEach(el=>el.classList.remove('active'));
      showPage('tasks');openModal('t1');
      document.getElementById('taskTitleInput').value='English user content';
      toggleLang();toggleLang();
    });
    assert.equal(await page.locator('#taskTitleInput').inputValue(),'English user content');
    assert.match(await page.locator('#modalTitle').textContent(),/تعديل المهمة/);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#taskStatusInput option')].map(el=>el.value)),['todo','in-progress','done']);
    assert.equal(await page.evaluate(() => new Intl.DateTimeFormat('ar-EG',{hour:'numeric',minute:'2-digit'}).format(new Date(2000,0,1,9,30))===fmtHourLabel(9.5)),true);
    assert.equal(await page.evaluate(() => tr('auto_challenge_period',{target:5,unit:'مهام',days:7}).includes('undefined')),false);
    assert.match(await page.evaluate(() => localizedApiError('forbidden',403)),/إذن/);
    const invalidBackup=await page.evaluate(()=>{try{validateBackup({tasks:[null]});}catch(error){return error.message;}});
    assert.match(invalidBackup,/سجل غير صالح/);
    assert.doesNotMatch(invalidBackup,/[A-Za-z]/);
    await page.evaluate(() => {
      closeModal();
      for(const base of ['tasks','projects','goals','habits','notes','events','archive','challenges']) localStorage.setItem(userKey('taskflow_'+base),'[]');
      document.getElementById('lbSources').style.display='none';
    });
    for (const name of pages) {
      await page.evaluate(name => showPage(name),name);
      assert.deepEqual(await untranslated(page),[],`Untranslated empty page: ${name}`);
    }
    await page.evaluate(() => {showPage('dashboard');toggleLang();});
    assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
    assert.match(await page.locator('#statsGrid').textContent(),/Total/);
    await page.evaluate(() => toggleLang());
    assert.match(await page.locator('#statsGrid').textContent(),/الإجمالي/);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => {showPage('timetable');toggleSidebar();});
    assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
    assert.equal(await page.locator('#sidebar').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1),true);
    assert.deepEqual(errors,[]);
    console.log(`PASS Arabic: ${pages.length} populated and empty pages, 13 dialogs, source notes, validation, state-preserving language switches, canonical statuses, minute precision, and mobile RTL`);
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
