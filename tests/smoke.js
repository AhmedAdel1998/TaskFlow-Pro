const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const http = require('http');

const root = path.resolve(__dirname, '..');
const appUrl = 'file:///' + path.join(root, 'index.html').replace(/\\/g, '/').replace(/ /g, '%20');
const chromePaths = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];
const TEST_API_PORT = 51789;
const TEST_API_URL = `http://127.0.0.1:${TEST_API_PORT}`;

async function step(name, fn, failures) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message.split('\n')[0]}`);
    console.error(`FAIL ${name}: ${err.message.split('\n')[0]}`);
  }
}

function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function poll() {
      http.get(url + '/health/live', res => {
        if (res.statusCode === 200) return resolve();
        res.resume();
        retry();
      }).on('error', retry);
      function retry() {
        if (Date.now() > deadline) return reject(new Error('API did not become healthy in time'));
        setTimeout(poll, 500);
      }
    })();
  });
}

/* Login is now real (username+password against the account database), so smoke tests need a live
   API — never the production one. This spins up a throwaway local instance on a temp SQLite file.
   Runs the pre-built DLL directly (not `dotnet run`, which wraps MSBuild and leaves orphan
   processes behind that a plain proc.kill() can't reach) so the process tree stays killable. */
function buildTestApi() {
  const { execFileSync } = require('child_process');
  execFileSync('dotnet', ['build', path.join(root, 'src/TaskFlow.Api'), '-c', 'Debug'], { cwd: root, stdio: 'ignore' });
  return path.join(root, 'src/TaskFlow.Api/bin/Debug/net9.0/TaskFlow.Api.dll');
}
function startTestApi(dllPath) {
  const dbPath = path.join(os.tmpdir(), `taskflow-smoke-${Date.now()}.db`);
  const jwtKey = require('crypto').randomBytes(48).toString('base64');
  const proc = spawn('dotnet', [dllPath], {
    cwd: path.dirname(dllPath),
    env: {
      ...process.env,
      ASPNETCORE_URLS: TEST_API_URL,
      ASPNETCORE_ENVIRONMENT: 'Development',
      ConnectionStrings__TaskFlow: `Data Source=${dbPath};Default Timeout=5`,
      Jwt__Key: jwtKey
    },
    stdio: 'ignore'
  });
  return { proc, dbPath };
}

(async () => {
  const executablePath = chromePaths.find(p => require('fs').existsSync(p));
  if (!executablePath) throw new Error('Chrome or Edge executable was not found.');

  const dllPath = buildTestApi();
  const { proc: apiProc, dbPath } = startTestApi(dllPath);
  let exitCode = 0;
  try {
    await waitForHealth(TEST_API_URL, 60000);
    exitCode = await runSmokeTests(executablePath);
  } finally {
    if (process.platform === 'win32') {
      try { require('child_process').execFileSync('taskkill', ['/PID', String(apiProc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    } else {
      apiProc.kill();
    }
    for (const f of [dbPath, dbPath + '-shm', dbPath + '-wal']) { try { fs.unlinkSync(f); } catch {} }
  }
  process.exit(exitCode);
})();

async function runSmokeTests(executablePath) {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(4000);
  await page.addInitScript((apiUrl) => { localStorage.setItem('taskflow_api_url', apiUrl); }, TEST_API_URL);

  const runtimeErrors = [];
  const failures = [];
  page.on('pageerror', err => runtimeErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') runtimeErrors.push(msg.text());
  });

  await step('load app', async () => {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForSelector('#loginUsername');
  }, failures);

  await step('register and login', async () => {
    const username = `audit${Date.now()}`.slice(0, 32);
    await page.fill('#loginUsername', username);
    await page.fill('#loginPassword', 'correct-horse-battery-staple');
    await page.click('#loginSwitchLink'); // switch to "Create an account"
    await page.click('button:has-text("Create Account")');
    await page.waitForSelector('#appContainer', { state: 'visible' });
    const skip = page.locator('button:has-text("Skip")');
    if (await skip.isVisible().catch(() => false)) await skip.click();
  }, failures);

  for (const pageName of ['dashboard','myday','tasks','kanban','calendar','timetable','eisenhower','projects','goals','habits','notes','analytics','reports','lifebalance','progress','archive']) {
    await step(`open ${pageName}`, async () => {
      await page.click(`[data-page="${pageName}"]`);
      await page.waitForSelector(`#page-${pageName}.active`);
    }, failures);
  }

  await step('create task and search', async () => {
    await page.click('button:has-text("New Task")');
    await page.fill('#taskTitleInput', 'Audit smoke task');
    await page.selectOption('#taskAssigneeInput', await page.evaluate(() => currentUser));
    await page.click('#saveTaskBtn');
    await page.click('[data-page="tasks"]');
    await page.fill('#searchInput', 'Audit smoke task');
    const searchText = await page.locator('#searchResults').innerText();
    if (!searchText.includes('Audit smoke task')) throw new Error('global search did not return created task');
    await page.selectOption('#filterAssignee', await page.evaluate(() => currentUser));
    await page.waitForSelector('.tag-owner');
  }, failures);

  await step('create planning records', async () => {
    await page.click('[data-page="projects"]');
    await page.click('button:has-text("+ New Project")');
    await page.fill('#projectNameInput', 'Audit Project');
    await page.click('#projectModal button:has-text("Save")');

    await page.click('[data-page="goals"]');
    await page.click('button:has-text("+ New Goal")');
    await page.fill('#goalTitleInput', 'Audit Goal');
    await page.click('#goalModal button:has-text("Save")');

    await page.click('[data-page="habits"]');
    await page.click('button:has-text("+ New Habit")');
    await page.fill('#habitNameInput', 'Audit Habit');
    await page.click('#habitModal button:has-text("Save")');
  }, failures);

  await step('create note and calendar event', async () => {
    await page.click('[data-page="notes"]');
    await page.click('button:has-text("+ New Note")');
    await page.fill('#noteTitleInput', 'Audit Note');
    await page.fill('#noteContentInput', '**Audit**');
    await page.click('#noteEditorModal button:has-text("Save")');
    await page.fill('#noteSearch', 'Audit Note');
    const noteCount = await page.evaluate(() => loadNotes().filter(n => n.title === 'Audit Note').length);
    if (noteCount < 1) throw new Error('note was not saved');

    await page.click('[data-page="calendar"]');
    await page.click('button:has-text("New Event")');
    await page.fill('#eventTitleInput', 'Audit Event');
    await page.fill('#eventDateInput', '2026-08-02');
    await page.fill('#eventTimeInput', '10:00');
    await page.click('#eventModal button:has-text("Save")');
  }, failures);

  await step('dashboard filters and settings status', async () => {
    await page.click('[data-page="dashboard"]');
    await page.selectOption('#dashAssigneeFilter', await page.evaluate(() => currentUser));
    await page.selectOption('#dashDateFilter', 'month');
    await page.waitForSelector('#statsGrid .stat-card');
    await page.locator('.user-bar').click();
    const status = await page.locator('#syncStateLabel').innerText();
    if (!status.includes('Not configured')) throw new Error('sync setup status missing');
    await page.keyboard.press('Escape');
  }, failures);

  await step('import preview validation', async () => {
    await page.evaluate(() => {
      pendingImport = validateBackup({ tasks: [{ title: 'Preview Task', priority: 'high' }], projects: [], goals: [], habits: [], notes: [] });
      document.getElementById('importPreviewSummary').innerHTML = '<div class="sync-row"><span>Tasks</span><strong>1</strong></div>';
      document.getElementById('importPreviewModal').classList.add('active');
    });
    await page.waitForSelector('#importPreviewModal.active');
    await page.click('#importPreviewModal button:has-text("Import")');
    await page.click('[data-page="tasks"]');
    await page.selectOption('#filterAssignee', 'all');
    await page.fill('#searchInput', '');
    await page.waitForSelector('text=Preview Task');
  }, failures);

  await step('accessibility attributes', async () => {
    const data = await page.evaluate(() => ({
      modalRole: document.getElementById('settingsModal').getAttribute('role'),
      labelledButtons: [...document.querySelectorAll('button')].filter(b => b.getAttribute('aria-label')).length
    }));
    if (data.modalRole !== 'dialog') throw new Error('modal role missing');
    if (data.labelledButtons < 5) throw new Error('button labels missing');
  }, failures);

  await step('verify local data', async () => {
    const data = await page.evaluate(() => ({
      tasks: loadTasks().length,
      projects: loadProjects().length,
      goals: loadGoals().length,
      habits: loadHabits().length,
      notes: loadNotes().length,
      events: loadEvents().length
    }));
    if (data.tasks < 1) throw new Error('tasks were not saved');
    if (data.events < 1) throw new Error('events were not saved');
  }, failures);

  await browser.close();

  const unexpectedRuntimeErrors = runtimeErrors.filter(err => !err.includes('Content Security Policy'));
  if (failures.length || unexpectedRuntimeErrors.length) {
    console.error(JSON.stringify({ failures, runtimeErrors: unexpectedRuntimeErrors }, null, 2));
    return 1;
  }
  return 0;
}
