/* ═══════ CONFIG ═══════ */
const ADMIN_EMAIL = 'osama.kamal@gmail.com';
const DEFAULT_SCRIPT_URL = '';
let APPS_SCRIPT_URL = localStorage.getItem('taskflow_script_url') || DEFAULT_SCRIPT_URL;

/* ═══════ i18n ═══════ */
const i18n = {
  en:{dashboard:'Dashboard',my_day:'My Day',all_tasks:'All Tasks',kanban:'Kanban Board',calendar:'Calendar',matrix:'Eisenhower Matrix',projects:'Projects',goals:'Goals',habits:'Habits',notes:'Notes',analytics:'Analytics & Insights',time_reports:'Time Reports',archive:'Archive',pomodoro:'Pomodoro Timer',templates:'Templates',settings:'Settings',new_task:'New Task',nav_main:'Main',nav_plan:'Planning',nav_analytics:'Analytics',nav_categories:'Categories',nav_quick:'Quick',weekly_overview:'Weekly Overview',priority_dist:'Priority Distribution',upcoming:'Upcoming Deadlines',goal_progress:'Goal Progress',habit_streaks:'Habit Streaks',recent_activity:'Recent Activity',daily_notes:'Daily Notes'},
  ar:{dashboard:'\u0644\u0648\u062D\u0629 \u0627\u0644\u062A\u062D\u0643\u0645',my_day:'\u064A\u0648\u0645\u064A',all_tasks:'\u062C\u0645\u064A\u0639 \u0627\u0644\u0645\u0647\u0627\u0645',kanban:'\u0644\u0648\u062D\u0629 \u0643\u0627\u0646\u0628\u0627\u0646',calendar:'\u0627\u0644\u062A\u0642\u0648\u064A\u0645',matrix:'\u0645\u0635\u0641\u0648\u0641\u0629 \u0623\u064A\u0632\u0646\u0647\u0627\u0648\u0631',projects:'\u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639',goals:'\u0627\u0644\u0623\u0647\u062F\u0627\u0641',habits:'\u0627\u0644\u0639\u0627\u062F\u0627\u062A',notes:'\u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A',analytics:'\u0627\u0644\u062A\u062D\u0644\u064A\u0644\u0627\u062A',time_reports:'\u062A\u0642\u0627\u0631\u064A\u0631 \u0627\u0644\u0648\u0642\u062A',archive:'\u0627\u0644\u0623\u0631\u0634\u064A\u0641',pomodoro:'\u0645\u0624\u0642\u062A \u0628\u0648\u0645\u0648\u062F\u0648\u0631\u0648',templates:'\u0627\u0644\u0642\u0648\u0627\u0644\u0628',settings:'\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A',new_task:'\u0645\u0647\u0645\u0629 \u062C\u062F\u064A\u062F\u0629',nav_main:'\u0631\u0626\u064A\u0633\u064A',nav_plan:'\u0627\u0644\u062A\u062E\u0637\u064A\u0637',nav_analytics:'\u0627\u0644\u062A\u062D\u0644\u064A\u0644\u0627\u062A',nav_categories:'\u0627\u0644\u0641\u0626\u0627\u062A',nav_quick:'\u0633\u0631\u064A\u0639',weekly_overview:'\u0646\u0638\u0631\u0629 \u0623\u0633\u0628\u0648\u0639\u064A\u0629',priority_dist:'\u062A\u0648\u0632\u064A\u0639 \u0627\u0644\u0623\u0648\u0644\u0648\u064A\u0627\u062A',upcoming:'\u0627\u0644\u0645\u0648\u0627\u0639\u064A\u062F \u0627\u0644\u0642\u0627\u062F\u0645\u0629',goal_progress:'\u062A\u0642\u062F\u0645 \u0627\u0644\u0623\u0647\u062F\u0627\u0641',habit_streaks:'\u0633\u0644\u0627\u0633\u0644 \u0627\u0644\u0639\u0627\u062F\u0627\u062A',recent_activity:'\u0627\u0644\u0646\u0634\u0627\u0637 \u0627\u0644\u0623\u062E\u064A\u0631',daily_notes:'\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0627\u0644\u064A\u0648\u0645'}
};
let lang = localStorage.getItem('taskflow_lang') || 'en';
function t(key) { return (i18n[lang] && i18n[lang][key]) || i18n.en[key] || key; }
function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (i18n[lang] && i18n[lang][k]) el.textContent = i18n[lang][k];
    else if (i18n.en[k]) el.textContent = i18n.en[k];
  });
  const lbl = document.getElementById('currentLangLabel');
  if (lbl) lbl.textContent = lang === 'ar' ? '\u0627\u0644\u0639\u0631\u0628\u064A\u0629' : 'English';
}
function toggleLang() {
  lang = lang === 'en' ? 'ar' : 'en';
  localStorage.setItem('taskflow_lang', lang);
  applyLang();
}

/* ═══════ USER AUTH ═══════ */
let currentUser = null;
function userKey(base) { return base + '_' + (currentUser || 'anon'); }
function isAdmin() { return currentUser === ADMIN_EMAIL; }
function doLogin() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  if (!email || !email.includes('@') || !email.includes('.')) {
    document.getElementById('loginError').textContent = 'Please enter a valid email address'; return;
  }
  currentUser = email;
  localStorage.setItem('taskflow_current_user', email);
  const users = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
  if (!users.includes(email)) { users.push(email); localStorage.setItem('taskflow_users', JSON.stringify(users)); }
  enterApp();
}
function doLogout() {
  localStorage.removeItem('taskflow_current_user');
  currentUser = null;
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginEmail').value = '';
  closeSettings();
}
function enterApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appContainer').style.display = 'flex';
  const name = currentUser.split('@')[0].replaceAll(/[._]/g,' ').replaceAll(/\b\w/g,c=>c.toUpperCase());
  document.getElementById('userName').textContent = name;
  document.getElementById('greetUser').textContent = name;
  document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('userRole').textContent = isAdmin() ? 'Admin' : 'Member';
  document.getElementById('settingsEmail').textContent = currentUser;
  document.getElementById('adminSyncSetting').style.display = isAdmin() ? 'flex' : 'none';
  refreshSettingsStatus();
  loadPomodoroSettings();
  ensureNumIds();
  initTheme(); applyLang(); setGreeting(); refreshAll();
  checkOnboarding(); processRecurring(); startReminderCheck();
}
function checkAutoLogin() {
  const saved = localStorage.getItem('taskflow_current_user');
  if (saved) { currentUser = saved; enterApp(); }
}

/* ═══════ DATA LAYER ═══════ */
function loadTasks() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_tasks'))) || []; } catch { return []; } }
function saveTasks(tasks) { localStorage.setItem(userKey('taskflow_tasks'), JSON.stringify(tasks)); }
function loadActivity() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_activity'))) || []; } catch { return []; } }
function saveActivity(list) { localStorage.setItem(userKey('taskflow_activity'), JSON.stringify(list.slice(0, 80))); }
function addActivity(text, type='info') { const l = loadActivity(); l.unshift({text,type,time:Date.now()}); saveActivity(l); }
function loadArchive() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_archive'))) || []; } catch { return []; } }
function saveArchive(list) { localStorage.setItem(userKey('taskflow_archive'), JSON.stringify(list)); }
function loadTemplates() { try { return JSON.parse(localStorage.getItem('taskflow_templates')) || []; } catch { return []; } }
function saveTemplates(t) { localStorage.setItem('taskflow_templates', JSON.stringify(t)); }
function loadFilters() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_filters'))) || []; } catch { return []; } }
function saveFilters(f) { localStorage.setItem(userKey('taskflow_filters'), JSON.stringify(f)); }
function loadProjects() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_projects'))) || []; } catch { return []; } }
function saveProjects(p) { localStorage.setItem(userKey('taskflow_projects'), JSON.stringify(p)); }
function loadGoals() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_goals'))) || []; } catch { return []; } }
function saveGoals(g) { localStorage.setItem(userKey('taskflow_goals'), JSON.stringify(g)); }
function loadHabits() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_habits'))) || []; } catch { return []; } }
function saveHabits(h) { localStorage.setItem(userKey('taskflow_habits'), JSON.stringify(h)); }
function loadNotes() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_notes'))) || []; } catch { return []; } }
function saveNotes(n) { localStorage.setItem(userKey('taskflow_notes'), JSON.stringify(n)); }
function loadUsers() { try { return JSON.parse(localStorage.getItem('taskflow_users')) || []; } catch { return []; } }
function getUserLabel(email) {
  const clean=asText(email, 120);
  return clean ? clean.split('@')[0].replaceAll(/[._]/g,' ').replaceAll(/\b\w/g,c=>c.toUpperCase()) : 'Unassigned';
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function ensureNumIds() {
  const tasks = loadTasks();
  let maxId = 0;
  tasks.forEach(t => { if (t.numId && t.numId > maxId) maxId = t.numId; });
  let changed = false;
  tasks.forEach(t => { if (!t.numId) { maxId++; t.numId = maxId; changed = true; } });
  if (changed) saveTasks(tasks);
}
function getNextNumId(existingTasks) {
  const tasks = existingTasks || loadTasks();
  let maxId = 0;
  tasks.forEach(t => { if (t.numId && t.numId > maxId) maxId = t.numId; });
  return maxId + 1;
}
function asText(v, max=500) { return String(v ?? '').trim().slice(0, max); }
function asChoice(v, allowed, fallback) { return allowed.includes(v) ? v : fallback; }
function asDateText(v) {
  const s = asText(v, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function normalizeTask(t, idx=0) {
  const createdAt = Number(t.createdAt) || Date.now();
  const status = asChoice(t.status, ['todo','in-progress','done'], 'todo');
  const task = {
    id: asText(t.id, 80) || genId(),
    numId: Number.parseInt(t.numId) || idx + 1,
    title: asText(t.title, 200) || 'Untitled Task',
    description: asText(t.description, 2000),
    status,
    priority: asChoice(t.priority, ['low','medium','high'], 'medium'),
    category: asText(t.category, 50),
    project: asText(t.project, 80),
    assignee: asText(t.assignee, 120),
    eisenhower: asChoice(t.eisenhower, ['','q1','q2','q3','q4'], ''),
    due: asDateText(t.due),
    due_time: asText(t.due_time, 10),
    progress: Math.min(100, Math.max(0, Number.parseInt(t.progress) || (status === 'done' ? 100 : 0))),
    note: asText(t.note, 500),
    estimated_hours: Math.max(0, Number.parseFloat(t.estimated_hours) || 0),
    logged_hours: Math.max(0, Number.parseFloat(t.logged_hours) || 0),
    link: asText(t.link, 500),
    tags: Array.isArray(t.tags) ? t.tags.map(x=>asText(x, 40)).filter(Boolean).slice(0, 10) : [],
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(s=>({text:asText(s.text,150),done:Boolean(s.done)})).filter(s=>s.text).slice(0,20) : [],
    recurring: asChoice(t.recurring, ['','daily','weekly','monthly'], ''),
    reminder: asText(t.reminder, 40),
    milestone: Boolean(t.milestone),
    dependencies: Array.isArray(t.dependencies) ? t.dependencies.map(x=>asText(x,80)).filter(Boolean).slice(0,20) : [],
    createdAt,
    updatedAt: Number(t.updatedAt) || createdAt,
    completedAt: status === 'done' ? (Number(t.completedAt) || Date.now()) : null,
    comments: Array.isArray(t.comments) ? t.comments.map(c=>({text:asText(c.text,300),user:asText(c.user,80),time:Number(c.time)||Date.now()})).filter(c=>c.text).slice(0,50) : [],
    sortOrder: Number.parseInt(t.sortOrder) || idx,
    myDay: asText(t.myDay, 20),
    myDaySlot: asChoice(t.myDaySlot, ['morning','afternoon','evening'], 'morning')
  };
  task.smartScore = calcSmartScore(task);
  return task;
}
function normalizeProject(p) { return {id:asText(p.id,80)||'p'+Date.now(),name:asText(p.name,100)||'Untitled Project',color:/^#[0-9a-f]{6}$/i.test(p.color||'')?p.color:'#4f46e5',description:asText(p.description,300),createdAt:Number(p.createdAt)||Date.now()}; }
function normalizeGoal(g) { return {id:asText(g.id,80)||'g'+Date.now(),title:asText(g.title,150)||'Untitled Goal',type:asChoice(g.type,['weekly','monthly'],'weekly'),target:Math.max(1,Number.parseInt(g.target)||1),current:Math.max(0,Number.parseInt(g.current)||0),unit:asText(g.unit,30)||'tasks',createdAt:Number(g.createdAt)||Date.now()}; }
function normalizeHabit(h) { return {id:asText(h.id,80)||'h'+Date.now(),name:asText(h.name,100)||'Untitled Habit',completions:(h.completions&&typeof h.completions==='object')?h.completions:{},createdAt:Number(h.createdAt)||Date.now()}; }
function normalizeNote(n) { return {id:asText(n.id,80)||'n'+Date.now(),title:asText(n.title,150)||'Untitled Note',content:String(n.content??'').slice(0,20000),folder:asText(n.folder,50),pinned:Boolean(n.pinned),createdAt:Number(n.createdAt)||Date.now(),updatedAt:Number(n.updatedAt)||Date.now()}; }
function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Backup must be a JSON object');
  return {
    tasks: Array.isArray(data.tasks) ? data.tasks.slice(0,2000).map(normalizeTask) : null,
    projects: Array.isArray(data.projects) ? data.projects.slice(0,500).map(normalizeProject) : null,
    goals: Array.isArray(data.goals) ? data.goals.slice(0,500).map(normalizeGoal) : null,
    habits: Array.isArray(data.habits) ? data.habits.slice(0,500).map(normalizeHabit) : null,
    notes: Array.isArray(data.notes) ? data.notes.slice(0,1000).map(normalizeNote) : null
  };
}

/* ═══════ STATE ═══════ */
let currentPage = 'dashboard';
let editingId = null, selectedIds = new Set(), pendingConfirm = null, tempSubtasks = [];
let calYear, calMonth;
let focusTaskId = null, focusInterval = null, focusSeconds = 0, pomoRunning = false;
let pomoMode = 'work', pomoSessionCount = 0;
let pomoWorkSec = 25*60, pomoBreakSec = 5*60;
let editingProjectId = null, editingGoalId = null, editingHabitId = null, editingNoteId = null;
let editingEventId = null, selectedEventColor = '#818cf8';
let noteFolder = 'all', goalFilter = 'all';
let reminderInterval = null;
let pendingImport = null;

/* ═══════ THEME ═══════ */
function initTheme() {
  const s = localStorage.getItem('taskflow_theme');
  if (s) document.documentElement.dataset.theme = s;
  updateThemeIcon();
}
function toggleTheme() {
  const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = n;
  localStorage.setItem('taskflow_theme', n);
  updateThemeIcon();
}
function updateThemeIcon() {
  const d = document.documentElement.dataset.theme === 'dark';
  document.getElementById('themeIcon').innerHTML = d
    ? '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>'
    : '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
}

/* ═══════ NAV ═══════ */
function showPage(name) {
  currentPage = name;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.add('active');
  const nv = document.querySelector('.nav-item[data-page="'+name+'"]');
  if (nv) nv.classList.add('active');
  if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('open');
  const renderMap = {dashboard:renderDashboard,tasks:renderTasks,kanban:renderKanban,calendar:renderCalendar,analytics:renderAnalytics,archive:renderArchive,myday:renderMyDay,projects:renderProjects,eisenhower:renderEisenhower,goals:renderGoals,habits:renderHabits,notes:renderNotes,reports:renderReports};
  if (renderMap[name]) renderMap[name]();
}
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function setGreeting() {
  const h = new Date().getHours();
  let greet = 'evening'; if (h < 12) { greet = 'morning'; } else if (h < 17) { greet = 'afternoon'; }
  document.getElementById('greeting').textContent = greet;
}

/* ═══════ TOAST ═══════ */
function toast(msg, type='success', undoFn=null) {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  let icon = '&#8505;'; if (type==='success') { icon = '&#10003;'; } else if (type==='error') { icon = '&#10007;'; }
  let html = icon + ' ' + msg;
  if (undoFn) html += '<button class="undo-btn" data-undo="1">Undo</button>';
  el.innerHTML = html;
  if (undoFn) el.querySelector('[data-undo]').addEventListener('click', () => { undoFn(); el.remove(); });
  c.appendChild(el);
  setTimeout(() => { if(el.parentNode) el.remove(); }, undoFn ? 6000 : 3000);
}

/* ═══════ CONFETTI ═══════ */
function launchConfetti() {
  const c = document.getElementById('confettiContainer');
  const colors = ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div');
    const x = Math.random()*100, d = Math.random()*3+2, clr = colors[Math.floor(Math.random()*colors.length)];
    Object.assign(p.style, {position:'absolute',left:x+'%',top:'-10px',width:'8px',height:'8px',background:clr,borderRadius:Math.random()>.5?'50%':'2px',animation:'confettiFall '+d+'s ease-in forwards',animationDelay:(Math.random()*.5)+'s'});
    c.appendChild(p);
  }
  setTimeout(() => { c.innerHTML = ''; }, 4000);
}

/* ═══════ MARKDOWN ═══════ */
function renderMd(s) {
  if (!s) return '';
  return escHtml(s)
    .replaceAll(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replaceAll(/\*(.+?)\*/g,'<em>$1</em>')
    .replaceAll(/`(.+?)`/g,'<code style="background:var(--surface3);padding:1px 4px;border-radius:3px;font-size:.85em">$1</code>')
    .replaceAll('\n','<br>');
}

/* ═══════ HELPERS ═══════ */
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtDate(d) {
  if(!d) { return ''; }
  return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function fmtRelative(ts) {
  const m = Math.floor((Date.now()-ts)/60000);
  if(m<1) { return 'now'; }
  if(m<60) { return m+'m'; }
  const h=Math.floor(m/60);
  if(h<24) { return h+'h'; }
  return Math.floor(h/24)+'d';
}
function isOverdue(t) {
  if(t.status==='done'||!t.due) { return false; }
  const d=new Date();d.setHours(0,0,0,0);
  return new Date(t.due+'T23:59:59')<d;
}
function todayStr() { return new Date().toISOString().slice(0,10); }
function typeColor(type) {
  if(type==='success') { return 'var(--success)'; }
  if(type==='error') { return 'var(--danger)'; }
  return 'var(--primary)';
}
function priorityColor(p) {
  if(p==='high') { return 'var(--danger)'; }
  if(p==='medium') { return 'var(--warning)'; }
  return 'var(--success)';
}
function taskDueHtml(t,od) {
  if(!t.due) { return ''; }
  const s=od?'color:var(--danger);font-weight:600':'';
  return '<span style="'+s+'">'+fmtDate(t.due)+'</span>';
}
function taskTagsHtml(t) {
  const tags=t.tags||[];
  if(!tags.length) { return ''; }
  let h='#'+tags[0];
  if(tags.length>1) { h+=' +'+(tags.length-1); }
  return '<span style="color:var(--primary)">'+h+'</span>';
}
function subtaskBarHtml(stD,stT) {
  if(!stT) { return ''; }
  return '<div class="subtask-progress"><div class="bar" style="width:'+Math.round(stD/stT*100)+'%"></div></div>';
}
function calcSmartScore(t) {
  let score = 0;
  const pw = {high:30,medium:20,low:10};
  score += pw[t.priority] || 10;
  if (t.due) { const daysLeft = (new Date(t.due+'T23:59:59') - Date.now()) / 864e5; score += Math.max(0, Math.min(40, 40-daysLeft*4)); }
  score += Math.min(20, (t.dependencies||[]).length * 5);
  if (t.milestone) score += 10;
  return Math.min(100, Math.round(score));
}
function getProjectName(pid) {
  if(!pid) { return ''; }
  const p=loadProjects().find(x=>x.id===pid);
  return p?p.name:'';
}
function getProjectColor(pid) {
  if(!pid) { return ''; }
  const p=loadProjects().find(x=>x.id===pid);
  return p?p.color:'';
}
function userOptionHtml(selected='') {
  const users=[...new Set([currentUser, ...loadUsers(), ...loadTasks().map(t=>t.assignee)].filter(Boolean))].sort();
  return '<option value="">Unassigned</option>' + users.map(email=>'<option value="'+escHtml(email)+'"'+(email===selected?' selected':'')+'>'+escHtml(getUserLabel(email))+'</option>').join('');
}
function populateAssigneeFilter(){
  const users=[...new Set([currentUser, ...loadUsers(), ...loadTasks().map(t=>t.assignee)].filter(Boolean))].sort();
  ['filterAssignee','dashAssigneeFilter'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    const current=el.value||'all';
    el.innerHTML='<option value="all">All Owners</option><option value="">Unassigned</option>'+users.map(email=>'<option value="'+escHtml(email)+'">'+escHtml(getUserLabel(email))+'</option>').join('');
    el.value=[...el.options].some(o=>o.value===current)?current:'all';
  });
}

/* ═══════ MODAL ═══════ */
function openModal(id) {
  editingId = id || null;
  tempSubtasks = [];
  const projs = loadProjects();
  document.getElementById('taskProjectInput').innerHTML = '<option value="">No Project</option>' + projs.map(p=>'<option value="'+p.id+'">'+escHtml(p.name)+'</option>').join('');
  document.getElementById('taskAssigneeInput').innerHTML = userOptionHtml();
  const allTasks = loadTasks().filter(x=>x.id!==id);
  document.getElementById('taskDepsInput').innerHTML = allTasks.map(x=>'<option value="'+x.id+'">'+escHtml(x.title)+'</option>').join('');
  if (id) {
    const t = loadTasks().find(x=>x.id===id);
    if (!t) return;
    document.getElementById('modalTitle').textContent = 'Edit Task #' + (t.numId || '');
    document.getElementById('saveTaskBtn').textContent = 'Save Changes';
    document.getElementById('taskTitleInput').value = t.title;
    document.getElementById('taskDescInput').value = t.description||'';
    document.getElementById('taskPriorityInput').value = t.priority;
    document.getElementById('taskCategoryInput').value = t.category||'';
    document.getElementById('taskProjectInput').value = t.project||'';
    document.getElementById('taskAssigneeInput').value = t.assignee||'';
    document.getElementById('taskEisenhowerInput').value = t.eisenhower||'';
    document.getElementById('taskDueInput').value = t.due||'';
    document.getElementById('taskDueTimeInput').value = t.due_time||'';
    document.getElementById('taskStatusInput').value = t.status;
    document.getElementById('taskProgressInput').value = t.progress||0;
    document.getElementById('progressVal').textContent = (t.progress||0)+'%';
    document.getElementById('taskEstHoursInput').value = t.estimated_hours||'';
    document.getElementById('taskLogHoursInput').value = t.logged_hours||'';
    document.getElementById('taskLinkInput').value = t.link||'';
    document.getElementById('taskNoteInput').value = t.note||'';
    document.getElementById('taskTagsInput').value = (t.tags||[]).join(', ');
    document.getElementById('taskRecurInput').value = t.recurring||'';
    document.getElementById('taskReminderInput').value = t.reminder||'';
    document.getElementById('taskMilestoneInput').checked = !!t.milestone;
    const deps = t.dependencies||[];
    const depSel = document.getElementById('taskDepsInput');
    Array.from(depSel.options).forEach(o => { o.selected = deps.includes(o.value); });
    tempSubtasks = (t.subtasks||[]).map(s=>({...s}));
    document.getElementById('commentsSection').style.display = 'block';
    renderComments(t.comments||[]);
  } else {
    document.getElementById('modalTitle').textContent = 'New Task';
    document.getElementById('saveTaskBtn').textContent = 'Create Task';
    ['taskTitleInput','taskDescInput','taskCategoryInput','taskDueInput','taskDueTimeInput','taskLinkInput','taskNoteInput','taskTagsInput','taskReminderInput'].forEach(fid=>document.getElementById(fid).value='');
    document.getElementById('taskPriorityInput').value = 'medium';
    document.getElementById('taskProjectInput').value = '';
    document.getElementById('taskAssigneeInput').value = currentUser || '';
    document.getElementById('taskEisenhowerInput').value = '';
    document.getElementById('taskStatusInput').value = 'todo';
    document.getElementById('taskProgressInput').value = 0;
    document.getElementById('progressVal').textContent = '0%';
    document.getElementById('taskEstHoursInput').value = '';
    document.getElementById('taskLogHoursInput').value = '';
    document.getElementById('taskRecurInput').value = '';
    document.getElementById('taskMilestoneInput').checked = false;
    Array.from(document.getElementById('taskDepsInput').options).forEach(o => { o.selected = false; });
    document.getElementById('commentsSection').style.display = 'none';
  }
  updateRecurringPreview();
  renderSubtaskInputs(); updateCatSugg();
  document.getElementById('taskModal').classList.add('active');
  setTimeout(() => document.getElementById('taskTitleInput').focus(), 100);
}
function closeModal() { document.getElementById('taskModal').classList.remove('active'); editingId = null; }
function addSubtaskInput() {
  const v = document.getElementById('newSubtaskInput').value.trim();
  if (!v||tempSubtasks.length>=20) return;
  tempSubtasks.push({text:v,done:false});
  document.getElementById('newSubtaskInput').value = '';
  renderSubtaskInputs();
}
function removeSubtaskInput(i) { tempSubtasks.splice(i,1); renderSubtaskInputs(); }
function renderSubtaskInputs() {
  document.getElementById('subtasksList').innerHTML = tempSubtasks.map((s,i) =>
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px"><input type="checkbox" '+(s.done?'checked':'')+' onchange="tempSubtasks['+i+'].done=this.checked" style="accent-color:var(--primary)"><span style="flex:1;font-size:.82rem">'+escHtml(s.text)+'</span><button onclick="removeSubtaskInput('+i+')" style="color:var(--danger);background:none;border:none;cursor:pointer;font-size:.9rem">&times;</button></div>'
  ).join('');
}
function updateCatSugg() {
  const cats = [...new Set(loadTasks().map(t=>t.category).filter(Boolean))];
  document.getElementById('catSugg').innerHTML = cats.map(c=>'<option value="'+escHtml(c)+'">').join('');
}
function renderComments(comments) {
  document.getElementById('commentList').innerHTML = (comments||[]).map(c =>
    '<div class="comment-item"><div>'+escHtml(c.text)+'</div><div class="ci-meta">'+escHtml(c.user)+' &bull; '+fmtRelative(c.time)+'</div></div>'
  ).join('') || '<p style="color:var(--text3);font-size:.78rem">No comments yet</p>';
}
function updateRecurringPreview(){
  const el=document.getElementById('recurringPreview');
  if(!el) return;
  const mode=document.getElementById('taskRecurInput').value;
  const due=document.getElementById('taskDueInput').value;
  if(!mode){el.textContent='No recurrence';return;}
  const base=due?new Date(due):new Date();
  if(mode==='daily') base.setDate(base.getDate()+1);
  if(mode==='weekly') base.setDate(base.getDate()+7);
  if(mode==='monthly') base.setMonth(base.getMonth()+1);
  el.textContent='Next copy after completion: '+base.toISOString().slice(0,10);
}
function addComment() {
  if (!editingId) return;
  const text = document.getElementById('commentInput').value.trim();
  if (!text) return;
  const tasks = loadTasks(), t = tasks.find(x=>x.id===editingId);
  if (!t) return;
  if (!t.comments) t.comments = [];
  t.comments.push({text, user:currentUser.split('@')[0], time:Date.now()});
  t.updatedAt = Date.now();
  saveTasks(tasks);
  document.getElementById('commentInput').value = '';
  renderComments(t.comments);
  addActivity('Commented on "'+t.title+'"','info');
}

/* ═══════ SAVE TASK ═══════ */
function saveTask() {
  const title = document.getElementById('taskTitleInput').value.trim();
  if (!title) { toast('Title required','error'); return; }
  const tasks = loadTasks();
  const tags = document.getElementById('taskTagsInput').value.split(',').map(t=>t.trim()).filter(Boolean).slice(0,10);
  const selDeps = Array.from(document.getElementById('taskDepsInput').selectedOptions).map(o=>o.value);
  const data = {
    title, description:document.getElementById('taskDescInput').value.trim(),
    priority:document.getElementById('taskPriorityInput').value,
    category:document.getElementById('taskCategoryInput').value.trim(),
    project:document.getElementById('taskProjectInput').value,
    assignee:document.getElementById('taskAssigneeInput').value,
    eisenhower:document.getElementById('taskEisenhowerInput').value,
    due:document.getElementById('taskDueInput').value,
    due_time:document.getElementById('taskDueTimeInput').value,
    status:document.getElementById('taskStatusInput').value,
    progress:Number.parseInt(document.getElementById('taskProgressInput').value)||0,
    note:document.getElementById('taskNoteInput').value.trim(),
    estimated_hours:Number.parseFloat(document.getElementById('taskEstHoursInput').value)||0,
    logged_hours:Number.parseFloat(document.getElementById('taskLogHoursInput').value)||0,
    link:document.getElementById('taskLinkInput').value.trim(),
    tags, subtasks:tempSubtasks.slice(0,20),
    recurring:document.getElementById('taskRecurInput').value,
    reminder:document.getElementById('taskReminderInput').value,
    milestone:document.getElementById('taskMilestoneInput').checked,
    dependencies:selDeps,
  };
  if (editingId) {
    const idx = tasks.findIndex(t=>t.id===editingId);
    if (idx>-1) {
      const old = tasks[idx], prev = old.status;
      Object.assign(old, data, {updatedAt:Date.now()});
      old.smartScore = calcSmartScore(old);
      if (data.status==='done'&&prev!=='done') { old.completedAt=Date.now(); old.progress=100; }
      addActivity('Updated: "'+title+'"','info'); toast('Task updated');
      saveTasks(tasks); sheetPost({action:'UPDATE',...taskToSheetRow(old)});
    }
  } else {
    const nw = {id:genId(),numId:getNextNumId(),...data,createdAt:Date.now(),updatedAt:Date.now(),comments:[]};
    nw.smartScore = calcSmartScore(nw);
    if (data.status==='done') { nw.completedAt=Date.now(); nw.progress=100; }
    tasks.push(nw);
    addActivity('Created: "'+title+'"','success'); toast('Task created');
    if (data.status==='done') launchConfetti();
    saveTasks(tasks); sheetPost({action:'ADD',...taskToSheetRow(nw)});
  }
  closeModal(); refreshAll();
}

/* ═══════ DELETE / TOGGLE / ARCHIVE ═══════ */
function requestDelete(id) {
  const t = loadTasks().find(x=>x.id===id);
  if (!t) return;
  document.getElementById('confirmTitle').textContent = 'Delete Task?';
  document.getElementById('confirmMsg').textContent = '"'+t.title+'" will be deleted.';
  document.getElementById('confirmBtn').textContent = 'Delete';
  pendingConfirm = () => {
    const tasks = loadTasks(), removed = tasks.find(x=>x.id===id);
    saveTasks(tasks.filter(x=>x.id!==id));
    sheetPost({action:'DELETE',id});
    addActivity('Deleted: "'+t.title+'"','error'); refreshAll();
    toast('Task deleted','info',() => { const ts=loadTasks(); ts.push(removed); saveTasks(ts); sheetPost({action:'ADD',...taskToSheetRow(removed)}); refreshAll(); toast('Task restored'); });
  };
  document.getElementById('confirmModal').classList.add('active');
}
function closeConfirm() { document.getElementById('confirmModal').classList.remove('active'); pendingConfirm=null; }
function confirmAction() {
  if(pendingConfirm) { pendingConfirm(); }
  closeConfirm();
}
function toggleDone(id) {
  const tasks = loadTasks(), t = tasks.find(x=>x.id===id);
  if(!t) return;
  if(t.dependencies&&t.dependencies.length>0&&t.status!=='done'){
    const unmet=t.dependencies.filter(did=>{ const dep=tasks.find(x=>x.id===did); return dep&&dep.status!=='done'; });
    if(unmet.length>0){toast('Blocked by '+unmet.length+' dependencies','error');return;}
  }
  if(t.status==='done'){t.status='todo';t.completedAt=null;addActivity('Reopened: "'+t.title+'"','info');}
  else{t.status='done';t.completedAt=Date.now();t.progress=100;addActivity('Completed: "'+t.title+'"','success');launchConfetti();toast('Task completed! &#127881;');}
  t.updatedAt=Date.now(); saveTasks(tasks); sheetPost({action:'UPDATE',...taskToSheetRow(t)}); refreshAll();
}
function toggleSubtask(taskId, idx) {
  const tasks=loadTasks(), t=tasks.find(x=>x.id===taskId);
  if(!t||!t.subtasks||!t.subtasks[idx]) return;
  t.subtasks[idx].done=!t.subtasks[idx].done; t.updatedAt=Date.now();
  saveTasks(tasks); sheetPost({action:'UPDATE',...taskToSheetRow(t)}); refreshAll();
}
function archiveTask(id) {
  const tasks=loadTasks(), t=tasks.find(x=>x.id===id);
  if(!t) return;
  saveTasks(tasks.filter(x=>x.id!==id));
  const arch=loadArchive(); arch.push({...t,archivedAt:Date.now()}); saveArchive(arch);
  addActivity('Archived: "'+t.title+'"','info');
  toast('Task archived','info',()=>{ const ts=loadTasks();ts.push(t);saveTasks(ts); saveArchive(loadArchive().filter(x=>x.id!==id)); refreshAll();toast('Restored'); });
  refreshAll();
}
function restoreFromArchive(id) {
  const arch=loadArchive(), t=arch.find(x=>x.id===id);
  if(!t) return;
  saveArchive(arch.filter(x=>x.id!==id)); delete t.archivedAt;
  const tasks=loadTasks(); tasks.push(t); saveTasks(tasks);
  addActivity('Restored: "'+t.title+'"','success'); toast('Task restored'); refreshAll();
}
function clearArchive() {
  pendingConfirm=()=>{saveArchive([]);toast('Archive cleared');renderArchive();};
  document.getElementById('confirmTitle').textContent='Clear Archive?';
  document.getElementById('confirmMsg').textContent='All archived tasks will be permanently deleted.';
  document.getElementById('confirmBtn').textContent='Clear';
  document.getElementById('confirmModal').classList.add('active');
}
function renderArchive() {
  const arch=loadArchive(), c=document.getElementById('archiveContainer');
  if(!arch.length){c.innerHTML='<div class="empty-state"><h3>Archive is empty</h3><p>Archived tasks appear here</p></div>';return;}
  c.innerHTML='<div class="task-list">'+arch.map(t=>'<div class="task-card completed-card"><div class="task-body"><div class="task-title-text"><span style="color:var(--text3);font-size:.72rem;font-weight:700;margin-right:4px">#'+(t.numId||'')+'</span>'+escHtml(t.title)+'</div><div class="task-meta"><span class="tag tag-'+t.priority+'">'+t.priority+'</span><span>Archived '+fmtRelative(t.archivedAt)+'</span></div></div><div style="display:flex;gap:4px"><button class="btn btn-sm btn-outline" onclick="restoreFromArchive(\''+t.id+'\')">Restore</button></div></div>').join('')+'</div>';
}

/* ═══════ BULK ACTIONS ═══════ */
function toggleSelect(id) { selectedIds.has(id)?selectedIds.delete(id):selectedIds.add(id); updateBulkBar(); renderTasks(); }
function clearSelection() { selectedIds.clear(); updateBulkBar(); renderTasks(); }
function updateBulkBar() {
  const b=document.getElementById('bulkBar');
  if(selectedIds.size>0){b.style.display='flex';document.getElementById('selectedCount').textContent=selectedIds.size+' selected';}
  else b.style.display='none';
}
function bulkAction(act) {
  let tasks=loadTasks();
  if(act==='delete'){
    pendingConfirm=()=>{
      tasks=tasks.filter(t=>!selectedIds.has(t.id)); saveTasks(tasks);
      addActivity('Deleted '+selectedIds.size+' tasks','error'); toast(selectedIds.size+' deleted');
      clearSelection(); refreshAll();
    };
    document.getElementById('confirmTitle').textContent='Delete '+selectedIds.size+' tasks?';
    document.getElementById('confirmMsg').textContent='Cannot be undone.';
    document.getElementById('confirmBtn').textContent='Delete All';
    document.getElementById('confirmModal').classList.add('active'); return;
  }
  if(act==='archive'){
    const arch=loadArchive();
    tasks.forEach(t=>{if(selectedIds.has(t.id))arch.push({...t,archivedAt:Date.now()});});
    tasks=tasks.filter(t=>!selectedIds.has(t.id));
    saveTasks(tasks);saveArchive(arch);toast(selectedIds.size+' archived');clearSelection();refreshAll();return;
  }
  tasks.forEach(t=>{
    if(selectedIds.has(t.id)){
      t.status=act;t.updatedAt=Date.now();
      if(act==='done') { t.completedAt=Date.now(); }
      sheetPost({action:'UPDATE',...taskToSheetRow(t)});
    }
  });
  saveTasks(tasks);toast(selectedIds.size+' updated');clearSelection();refreshAll();
}

/* ═══════ RENDER DASHBOARD ═══════ */
function renderDashboard() {
  const allTasks=loadTasks();
  const tasks=filterDashboardTasks(allTasks), total=tasks.length, done=tasks.filter(t=>t.status==='done').length;
  const inProg=tasks.filter(t=>t.status==='in-progress').length, overdue=tasks.filter(isOverdue).length;
  const pct=total?Math.round(done/total*100):0;
  document.getElementById('statsGrid').innerHTML =
    '<div class="stat-card"><div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></div><div class="stat-info"><h3>Total</h3><div class="num">'+total+'</div></div></div>'+
    '<div class="stat-card"><div class="stat-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="stat-info"><h3>Done</h3><div class="num">'+done+'</div><div class="trend">'+pct+'%</div></div></div>'+
    '<div class="stat-card"><div class="stat-icon amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="stat-info"><h3>In Progress</h3><div class="num">'+inProg+'</div></div></div>'+
    '<div class="stat-card"><div class="stat-icon red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg></div><div class="stat-info"><h3>Overdue</h3><div class="num">'+overdue+'</div></div></div>';
  renderWeeklyChart(tasks); renderPriorityRing(tasks,done,total); renderHeatmap(tasks); renderUpcoming(tasks); renderActivityList(); renderDashGoals(); renderDashHabits();
  document.getElementById('notifDot').style.display=overdue>0?'block':'none';
  document.getElementById('taskBadge').textContent=total-done;
}
function filterDashboardTasks(tasks){
  const dateFilter=document.getElementById('dashDateFilter') ? document.getElementById('dashDateFilter').value : 'all';
  const projectFilter=document.getElementById('dashProjectFilter') ? document.getElementById('dashProjectFilter').value : 'all';
  const assigneeFilter=document.getElementById('dashAssigneeFilter') ? document.getElementById('dashAssigneeFilter').value : 'all';
  let out=tasks.slice();
  if(projectFilter!=='all') out=out.filter(t=>(t.project||'')===projectFilter);
  if(assigneeFilter!=='all') out=out.filter(t=>(t.assignee||'')===assigneeFilter);
  if(dateFilter!=='all'){
    const now=new Date(), start=new Date();
    start.setHours(0,0,0,0);
    if(dateFilter==='week') start.setDate(start.getDate()-6);
    if(dateFilter==='month') start.setDate(start.getDate()-29);
    out=out.filter(t=>{
      const ts=t.completedAt||t.createdAt;
      if(!ts) return false;
      const d=new Date(ts);
      return d>=start&&d<=now;
    });
  }
  return out;
}
function renderWeeklyChart(tasks) {
  const c=document.getElementById('weeklyChart'), days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], counts=new Array(7).fill(0), now=new Date();
  tasks.forEach(t=>{if(t.completedAt){const d=new Date(t.completedAt);if((now-d)/864e5<7)counts[d.getDay()]++;}});
  const max=Math.max(...counts,1), todayIdx=now.getDay(), ordered=[];
  for(let i=6;i>=0;i--){const idx=(todayIdx-i+7)%7;ordered.push({day:days[idx],count:counts[idx],today:i===0});}
  c.innerHTML=ordered.map(d=>'<div class="chart-bar-wrap"><div class="chart-bar" style="height:'+Math.max(d.count/max*160,6)+'px;background:'+(d.today?'var(--primary)':'var(--primary-light)')+';opacity:'+(d.today?1:.6)+'"><span class="tooltip">'+d.count+'</span></div><span class="label" style="'+(d.today?'font-weight:700;color:var(--primary)':'')+'">'+d.day+'</span></div>').join('');
}
function renderPriorityRing(tasks,done,total) {
  const cv=document.getElementById('ringCanvas'),ctx=cv.getContext('2d');
  cv.width=260;cv.height=260;ctx.clearRect(0,0,260,260);
  const data=[{c:tasks.filter(t=>t.priority==='high').length,clr:'#ef4444',l:'High'},{c:tasks.filter(t=>t.priority==='medium').length,clr:'#f59e0b',l:'Medium'},{c:tasks.filter(t=>t.priority==='low').length,clr:'#10b981',l:'Low'}];
  const sum=data.reduce((a,d)=>a+d.c,0)||1;
  let start=-Math.PI/2;
  data.forEach(d=>{const a=(d.c/sum)*Math.PI*2;ctx.beginPath();ctx.arc(130,130,100,start,start+a);ctx.lineWidth=24;ctx.strokeStyle=d.clr;ctx.lineCap='round';ctx.stroke();start+=a+.04;});
  document.getElementById('ringPct').textContent=(total?Math.round(done/total*100):0)+'%';
  document.getElementById('ringLegend').innerHTML=data.map(d=>'<span><span class="dot-legend" style="background:'+d.clr+'"></span>'+d.l+': '+d.c+'</span>').join('');
}
function renderHeatmap(tasks) {
  const w=document.getElementById('heatmapWrap'), completedDates={};
  tasks.forEach(t=>{if(t.completedAt){const d=new Date(t.completedAt).toISOString().slice(0,10);completedDates[d]=(completedDates[d]||0)+1;}});
  let html='<div class="heatmap-grid">';
  const today=new Date();
  for(let week=15;week>=0;week--){html+='<div class="heatmap-col">';for(let day=0;day<7;day++){const d=new Date(today);d.setDate(d.getDate()-week*7-(6-day));const ds=d.toISOString().slice(0,10);const cnt=completedDates[ds]||0;html+='<div class="heatmap-cell" data-count="'+Math.min(cnt,5)+'" title="'+ds+': '+cnt+' tasks"></div>';}html+='</div>';}
  html+='</div><div class="heatmap-legend">Less <div class="heatmap-cell" data-count="0"></div><div class="heatmap-cell" data-count="1"></div><div class="heatmap-cell" data-count="2"></div><div class="heatmap-cell" data-count="3"></div><div class="heatmap-cell" data-count="4"></div><div class="heatmap-cell" data-count="5"></div> More</div>';
  w.innerHTML=html;
}
function renderUpcoming(tasks) {
  const c=document.getElementById('upcomingDeadlines');
  const up=tasks.filter(t=>t.due&&t.status!=='done').sort((a,b)=>a.due.localeCompare(b.due)).slice(0,5);
  if(!up.length){c.innerHTML='<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:16px">No deadlines</p>';return;}
  c.innerHTML=up.map(t=>{const od=isOverdue(t);return'<div class="activity-item" onclick="openModal(\''+t.id+'\')"><div class="activity-dot" style="background:'+(od?'var(--danger)':'var(--success)')+'"></div><span class="activity-text">'+escHtml(t.title)+'</span><span class="activity-time" style="'+(od?'color:var(--danger)':'')+'">'+fmtDate(t.due)+'</span></div>';}).join('');
}
function renderDashGoals() {
  const goals=loadGoals().slice(0,3), c=document.getElementById('dashGoals');
  if(!goals.length){c.innerHTML='<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:12px">No goals set</p>';return;}
  c.innerHTML=goals.map(g=>{const pct=Math.min(100,Math.round((g.current||0)/g.target*100)); return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px"><span>'+escHtml(g.title)+'</span><span style="font-weight:700">'+pct+'%</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+pct+'%;background:var(--primary)"></div></div></div>';}).join('');
}
function renderDashHabits() {
  const habits=loadHabits().slice(0,4), c=document.getElementById('dashHabits'), today=todayStr();
  if(!habits.length){c.innerHTML='<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:12px">No habits tracked</p>';return;}
  c.innerHTML=habits.map(h=>{const done=h.completions&&h.completions[today];const streak=calcHabitStreak(h); return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0"><div style="width:24px;height:24px;border-radius:50%;background:'+(done?'var(--success)':'var(--surface3)')+';display:flex;align-items:center;justify-content:center;font-size:.7rem;color:#fff">'+(done?'&#10003;':'')+'</div><span style="flex:1;font-size:.82rem">'+escHtml(h.name)+'</span><span style="font-size:.72rem;color:var(--text3)">'+streak+' day streak</span></div>';}).join('');
}
function renderActivityList() {
  const list=loadActivity().slice(0,10), c=document.getElementById('activityList');
  if(!list.length){c.innerHTML='<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:16px">No activity</p>';return;}
  c.innerHTML=list.map(a=>'<div class="activity-item"><div class="activity-dot" style="background:'+typeColor(a.type)+'"></div><span class="activity-text">'+escHtml(a.text)+'</span><span class="activity-time">'+fmtRelative(a.time)+'</span></div>').join('');
}

/* ═══════ RENDER TASKS ═══════ */
function renderTasks() {
  let tasks=loadTasks();
  const search=document.getElementById('searchInput').value.trim().toLowerCase();
  const st=document.getElementById('filterStatus').value, pr=document.getElementById('filterPriority').value;
  const cat=document.getElementById('filterCategory').value, proj=document.getElementById('filterProject').value;
  const assignee=document.getElementById('filterAssignee') ? document.getElementById('filterAssignee').value : 'all';
  const sort=document.getElementById('sortBy').value;
  if(search) tasks=tasks.filter(t=>t.title.toLowerCase().includes(search)||(t.description||'').toLowerCase().includes(search)||(t.tags||[]).some(g=>g.toLowerCase().includes(search)));
  if(st!=='all') tasks=tasks.filter(t=>t.status===st);
  if(pr!=='all') tasks=tasks.filter(t=>t.priority===pr);
  if(cat!=='all') tasks=tasks.filter(t=>t.category===cat);
  if(proj!=='all') tasks=tasks.filter(t=>t.project===proj);
  if(assignee!=='all') tasks=tasks.filter(t=>(t.assignee||'')===assignee);
  tasks.forEach(t=>{t.smartScore=calcSmartScore(t);});
  tasks.sort((a,b)=>{switch(sort){case'created-desc':return(b.createdAt||0)-(a.createdAt||0);case'created-asc':return(a.createdAt||0)-(b.createdAt||0);case'due-asc':return(a.due||'9').localeCompare(b.due||'9');case'priority-desc':{const o={high:3,medium:2,low:1};return(o[b.priority]||0)-(o[a.priority]||0);}case'score-desc':return(b.smartScore||0)-(a.smartScore||0);case'alpha-asc':return a.title.localeCompare(b.title);default:return(a.sortOrder||0)-(b.sortOrder||0);}});
  const c=document.getElementById('taskListContainer');
  if(!tasks.length){c.innerHTML='<div class="empty-state"><h3>No tasks found</h3><p>Press Q for quick add</p><button class="btn btn-sm btn-primary" onclick="openModal()">Create Task</button></div>';return;}
  c.innerHTML='<div class="task-list" id="taskDragList">'+tasks.map(t=>renderTaskCard(t)).join('')+'</div>';
  initTaskDrag();
}
function renderTaskCard(t) {
  const od=isOverdue(t), dn=t.status==='done';
  const stD=(t.subtasks||[]).filter(s=>s.done).length, stT=(t.subtasks||[]).length;
  const blocked=(t.dependencies||[]).length>0;
  const pName=getProjectName(t.project), pColor=getProjectColor(t.project);
  const score=t.smartScore||calcSmartScore(t);
  return '<div class="task-card'+(od?' overdue':'')+(dn?' completed-card':'')+(t.milestone?' milestone-card':'')+'" draggable="true" data-id="'+t.id+'" ondblclick="openModal(\''+t.id+'\')">'+
    '<input type="checkbox" '+(selectedIds.has(t.id)?'checked':'')+' onchange="toggleSelect(\''+t.id+'\')" style="accent-color:var(--primary);width:15px;height:15px;cursor:pointer;flex-shrink:0">'+
    '<div class="task-check'+(dn?' checked':'')+'" onclick="toggleDone(\''+t.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>'+
    '<div class="task-body"><div class="task-title-text'+(dn?' done':'')+'">'+
    (t.milestone?'<span style="color:var(--accent2)">&#9733;</span>':'')+
    '<span style="color:var(--text3);font-size:.72rem;font-weight:700;margin-right:4px">#'+(t.numId||'')+'</span>'+
    escHtml(t.title)+
    (t.recurring?' <span style="color:var(--accent);font-size:.7rem">&#8635; '+t.recurring+'</span>':'')+
    (blocked?' <span class="tag tag-blocked">blocked</span>':'')+
    '</div><div class="task-meta">'+
    '<span class="tag tag-'+t.priority+'">'+t.priority+'</span>'+
    (t.category?'<span class="tag tag-category">'+escHtml(t.category)+'</span>':'')+
    (pName?'<span class="tag tag-project" style="border-left:3px solid '+pColor+'">'+escHtml(pName)+'</span>':'')+
    '<span class="tag tag-owner">'+escHtml(getUserLabel(t.assignee))+'</span>'+
    taskDueHtml(t,od)+
    (stT?'<span>'+stD+'/'+stT+'</span>':'')+
    taskTagsHtml(t)+
    '<span class="tag tag-score">'+score+'</span>'+
    (t.link?'<a href="'+escHtml(t.link)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--accent)">&#128279;</a>':'')+
    '</div>'+subtaskBarHtml(stD,stT)+'</div>'+
    '<div class="task-actions">'+
    '<button class="btn-icon" onclick="event.stopPropagation();startTimerForTask(\''+t.id+'\')" title="Timer" style="color:var(--text3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>'+
    '<button class="btn-icon" onclick="event.stopPropagation();archiveTask(\''+t.id+'\')" title="Archive" style="color:var(--text3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg></button>'+
    '<button class="btn-icon" onclick="event.stopPropagation();openModal(\''+t.id+'\')" title="Edit" style="color:var(--text3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'+
    '<button class="btn-icon" onclick="event.stopPropagation();requestDelete(\''+t.id+'\')" title="Delete" style="color:var(--danger)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>'+
    '</div></div>';
}

/* ═══════ DRAG-AND-DROP TASK REORDER ═══════ */
let dragTaskId=null;
function initTaskDrag() {
  const list=document.getElementById('taskDragList');
  if(!list) return;
  list.querySelectorAll('.task-card[draggable]').forEach(card=>{
    card.addEventListener('dragstart',e=>{dragTaskId=card.dataset.id;e.dataTransfer.effectAllowed='move';card.style.opacity='.5';});
    card.addEventListener('dragend',()=>{card.style.opacity='';});
    card.addEventListener('dragover',e=>{e.preventDefault();});
    card.addEventListener('drop',e=>{
      e.preventDefault();
      if(!dragTaskId||dragTaskId===card.dataset.id) return;
      const tasks=loadTasks();
      const fromIdx=tasks.findIndex(t=>t.id===dragTaskId);
      const toIdx=tasks.findIndex(t=>t.id===card.dataset.id);
      if(fromIdx<0||toIdx<0) return;
      const [moved]=tasks.splice(fromIdx,1);
      tasks.splice(toIdx,0,moved);
      tasks.forEach((t,i)=>{t.sortOrder=i;});
      saveTasks(tasks); renderTasks();
      dragTaskId=null;
    });
  });
}

/* ═══════ KANBAN ═══════ */
function renderKanbanCard(t) {
  let dueStyle=''; if(t.due&&isOverdue(t)) dueStyle='color:var(--danger)';
  const dueHtml=t.due?'<span style="'+dueStyle+'">'+fmtDate(t.due)+'</span>':'';
  return '<div class="kanban-card" draggable="true" ondragstart="kanbanDragStart(event,\''+t.id+'\')" ondblclick="openModal(\''+t.id+'\')"><div class="kc-title">'+(t.milestone?'&#9733; ':'')+escHtml(t.title)+'</div><div class="kc-meta"><span><span class="kc-priority" style="background:'+priorityColor(t.priority)+'"></span> '+t.priority+'</span>'+dueHtml+'</div></div>';
}
function renderKanban() {
  const tasks=loadTasks();
  const cols=[{key:'todo',label:'To Do',clr:'var(--text3)'},{key:'in-progress',label:'In Progress',clr:'var(--warning)'},{key:'done',label:'Done',clr:'var(--success)'}];
  document.getElementById('kanbanBoard').innerHTML=cols.map(col=>{
    const ct=tasks.filter(t=>t.status===col.key);
    const cardsHtml=ct.length?ct.map(renderKanbanCard).join(''):'<p style="color:var(--text3);font-size:.75rem;text-align:center;padding:16px">Empty</p>';
    return '<div class="kanban-col" ondrop="kanbanDrop(event,\''+col.key+'\')" ondragover="event.preventDefault();this.style.background=\'var(--surface3)\'" ondragleave="this.style.background=\'\'"><div class="kanban-col-header"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+col.clr+';margin-right:6px"></span>'+col.label+'</span><span class="col-count">'+ct.length+'</span></div><div class="kanban-cards">'+cardsHtml+'</div></div>';
  }).join('');
}
function kanbanDragStart(e,id){dragTaskId=id;e.dataTransfer.effectAllowed='move';}
function kanbanDrop(e,status){
  e.preventDefault();e.currentTarget.classList.remove('drag-over');
  if(!dragTaskId) return;
  const tasks=loadTasks(), t=tasks.find(x=>x.id===dragTaskId);
  if(t&&t.status!==status){t.status=status;t.updatedAt=Date.now();if(status==='done'){t.completedAt=Date.now();t.progress=100;launchConfetti();}
    saveTasks(tasks);sheetPost({action:'UPDATE',...taskToSheetRow(t)});addActivity('Moved "'+t.title+'" to '+status,'info');toast('Moved');refreshAll();}
  dragTaskId=null;
}

/* ═══════ CALENDAR & EVENTS ═══════ */
function initCal(){const n=new Date();calYear=n.getFullYear();calMonth=n.getMonth();}
function calNav(d){calMonth+=d;if(calMonth<0){calMonth=11;calYear--;}if(calMonth>11){calMonth=0;calYear++;}renderCalendar();}
function calToday(){initCal();renderCalendar();}
function loadEvents(){try{return JSON.parse(localStorage.getItem(userKey('taskflow_events')))||[];}catch{return [];}}
function saveEvents(ev){localStorage.setItem(userKey('taskflow_events'),JSON.stringify(ev));}
function openEventModal(dateStr){
  editingEventId=null;selectedEventColor='#818cf8';
  document.getElementById('eventModalTitle').textContent='New Event';
  document.getElementById('eventTitleInput').value='';
  document.getElementById('eventDateInput').value=dateStr||todayStr();
  document.getElementById('eventTimeInput').value='09:00';
  document.getElementById('eventEndTimeInput').value='10:00';
  document.getElementById('eventTypeInput').value='meeting';
  document.getElementById('eventDescInput').value='';
  document.getElementById('eventDeleteBtn').style.display='none';
  document.querySelectorAll('.ev-color-opt').forEach(b=>{b.classList.toggle('active',b.dataset.color==='#818cf8');});
  document.getElementById('eventModal').classList.add('active');
  document.getElementById('eventTitleInput').focus();
}
function editEvent(id){
  const ev=loadEvents().find(e=>e.id===id);if(!ev)return;
  editingEventId=id;selectedEventColor=ev.color||'#818cf8';
  document.getElementById('eventModalTitle').textContent='Edit Event';
  document.getElementById('eventTitleInput').value=ev.title;
  document.getElementById('eventDateInput').value=ev.date;
  document.getElementById('eventTimeInput').value=ev.time||'';
  document.getElementById('eventEndTimeInput').value=ev.endTime||'';
  document.getElementById('eventTypeInput').value=ev.type||'meeting';
  document.getElementById('eventDescInput').value=ev.description||'';
  document.getElementById('eventDeleteBtn').style.display='inline-flex';
  document.querySelectorAll('.ev-color-opt').forEach(b=>{b.classList.toggle('active',b.dataset.color===selectedEventColor);});
  document.getElementById('eventModal').classList.add('active');
}
function closeEventModal(){document.getElementById('eventModal').classList.remove('active');editingEventId=null;}
function pickEventColor(btn){selectedEventColor=btn.dataset.color;document.querySelectorAll('.ev-color-opt').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}
function saveEvent(){
  const title=document.getElementById('eventTitleInput').value.trim();
  const date=document.getElementById('eventDateInput').value;
  if(!title){toast('Please enter a title');return;}
  if(!date){toast('Please select a date');return;}
  const events=loadEvents();
  const data={title,date,time:document.getElementById('eventTimeInput').value,endTime:document.getElementById('eventEndTimeInput').value,type:document.getElementById('eventTypeInput').value,color:selectedEventColor,description:document.getElementById('eventDescInput').value.trim()};
  if(editingEventId){const idx=events.findIndex(e=>e.id===editingEventId);if(idx>=0){events[idx]={...events[idx],...data};}}else{events.push({id:genId(),...data,createdAt:Date.now()});}
  saveEvents(events);closeEventModal();renderCalendar();toast(editingEventId?'Event updated':'Event created');
}
function deleteEvent(){
  if(!editingEventId)return;
  const events=loadEvents().filter(e=>e.id!==editingEventId);
  saveEvents(events);closeEventModal();renderCalendar();toast('Event deleted');
}
function renderCalendar(){
  if(calYear===undefined||calMonth===undefined) initCal();
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calTitle').textContent=months[calMonth]+' '+calYear;
  const tasks=loadTasks(),events=loadEvents(), first=new Date(calYear,calMonth,1), last=new Date(calYear,calMonth+1,0);
  const startDay=first.getDay(), totalDays=last.getDate(), today=todayStr();
  let html='';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d=>{html+='<div class="cal-day-name">'+d+'</div>';});
  const prevLast=new Date(calYear,calMonth,0).getDate();
  for(let i=startDay-1;i>=0;i--) html+='<div class="cal-cell other-month"><div class="cal-date">'+(prevLast-i)+'</div></div>';
  for(let d=1;d<=totalDays;d++){
    const ds=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const isToday=ds===today;
    const dayTasks=tasks.filter(t=>t.due===ds);
    const dayEvents=events.filter(e=>e.date===ds);
    html+='<div class="cal-cell'+(isToday?' today':'')+'" onclick="openEventModal(\''+ds+'\')"><div class="cal-date">'+d+'</div>';
    const items=[];
    dayEvents.forEach(ev=>{items.push('<div class="cal-event ev-'+ev.type+'" style="background:'+(ev.color||'')+'" onclick="event.stopPropagation();editEvent(\''+ev.id+'\')">'+
      (ev.time?'<span style="opacity:.8">'+ev.time+'</span> ':'')+escHtml(ev.title)+'</div>');});
    dayTasks.forEach(t=>{
      let cls='';if(t.status==='done')cls='done';else if(isOverdue(t))cls='overdue-tag';
      items.push('<div class="cal-task '+cls+'" onclick="event.stopPropagation();openModal(\''+t.id+'\')">'+escHtml(t.title)+'</div>');});
    items.slice(0,3).forEach(i=>{html+=i;});
    if(items.length>3) html+='<div class="cal-more" onclick="event.stopPropagation()">+'+(items.length-3)+' more</div>';
    html+='</div>';
  }
  const remaining=(startDay+totalDays)%7;
  if(remaining>0) for(let i=1;i<=7-remaining;i++) html+='<div class="cal-cell other-month"><div class="cal-date">'+i+'</div></div>';
  document.getElementById('calGrid').innerHTML=html;
}

/* ═══════ ANALYTICS ═══════ */
function renderAnalytics(){
  const tasks=loadTasks(),total=tasks.length,done=tasks.filter(t=>t.status==='done').length;
  const pct=total?Math.round(done/total*100):0, overdue=tasks.filter(isOverdue).length, streak=calcStreak(tasks);
  const completed=tasks.filter(t=>t.completedAt&&t.createdAt);
  let avgH=0;if(completed.length)avgH=Math.round(completed.reduce((s,t)=>s+(t.completedAt-t.createdAt),0)/completed.length/36e5*10)/10;
  const estH=tasks.reduce((s,t)=>s+(t.estimated_hours||0),0), logH=tasks.reduce((s,t)=>s+(t.logged_hours||0),0);
  const catMap={};tasks.forEach(t=>{const c=t.category||'Other';catMap[c]=(catMap[c]||0)+1;});
  const catE=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
  document.getElementById('analyticsGrid').innerHTML=
    '<div class="card"><div class="card-title">Completion</div><div style="text-align:center;padding:12px"><div style="font-size:2.5rem;font-weight:900;color:var(--primary)">'+pct+'%</div><p style="color:var(--text3);font-size:.82rem;margin:6px 0 12px">'+done+'/'+total+'</p><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+pct+'%;background:var(--success)"></div></div></div></div>'+
    '<div class="card"><div class="card-title">Streak</div><div class="streak-display"><div class="streak-num">'+streak+'</div><div class="streak-label">day'+(streak===1?'':'s')+' in a row</div></div></div>'+
    '<div class="card"><div class="card-title">Metrics</div><div class="metric-row"><span class="metric-label">Overdue</span><span class="metric-value" style="color:var(--danger)">'+overdue+'</span></div><div class="metric-row"><span class="metric-label">Avg Completion</span><span class="metric-value">'+(avgH?avgH+'h':'—')+'</span></div><div class="metric-row"><span class="metric-label">Est. Hours</span><span class="metric-value">'+estH+'</span></div><div class="metric-row"><span class="metric-label">Logged Hours</span><span class="metric-value">'+logH+'</span></div></div>'+
    '<div class="card"><div class="card-title">Categories</div>'+(catE.length?catE.map(([c,n])=>{const p=Math.round(n/total*100);return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px"><span>'+escHtml(c)+'</span><span style="font-weight:600">'+n+'</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+p+'%;background:var(--primary)"></div></div></div>';}).join(''):'<p style="color:var(--text3);font-size:.82rem;text-align:center">No data</p>')+'</div>'+
    '<div class="card"><div class="card-title">Burndown (7 days)</div><div class="chart-area" id="burndownChart" style="height:160px"></div></div>';
  renderBurndown(tasks); renderGantt(tasks);
}
function calcStreak(tasks){
  const comp=tasks.filter(t=>t.completedAt).map(t=>new Date(t.completedAt).toISOString().slice(0,10));
  const uniq=[...new Set(comp)].sort().reverse();
  if(!uniq.length) return 0;
  let streak=0,check=new Date();check.setHours(0,0,0,0);
  if(!uniq.includes(check.toISOString().slice(0,10))) check.setDate(check.getDate()-1);
  for(let i=0;i<365;i++){const ds=check.toISOString().slice(0,10);if(uniq.includes(ds)){streak++;check.setDate(check.getDate()-1);}else break;}
  return streak;
}
function renderBurndown(tasks){
  const c=document.getElementById('burndownChart');if(!c) return;
  const today=new Date(), bars=[];
  for(let i=6;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);const ds=d.toISOString().slice(0,10);const remaining=tasks.filter(t=>t.status!=='done'||(t.completedAt&&new Date(t.completedAt).toISOString().slice(0,10)>ds)).length;bars.push({day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()],val:remaining,today:i===0});}
  const max=Math.max(...bars.map(b=>b.val),1);
  c.innerHTML=bars.map(b=>'<div class="chart-bar-wrap"><div class="chart-bar" style="height:'+Math.max(b.val/max*140,4)+'px;background:'+(b.today?'var(--accent)':'var(--accent2)')+';opacity:'+(b.today?1:.6)+'"><span class="tooltip">'+b.val+' remaining</span></div><span class="label">'+b.day+'</span></div>').join('');
}
function renderGantt(tasks){
  const c=document.getElementById('ganttContainer');
  const withDue=tasks.filter(t=>t.due&&t.createdAt).slice(0,15);
  if(!withDue.length){c.innerHTML='<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:16px">Add due dates to see timeline</p>';return;}
  const dates=withDue.flatMap(t=>[new Date(t.createdAt),new Date(t.due)]);
  const minD=Math.min(...dates.map(d=>d.getTime())), maxD=Math.max(...dates.map(d=>d.getTime())), range=maxD-minD||864e5;
  c.innerHTML=withDue.map(t=>{
    const s=new Date(t.createdAt).getTime(), e=new Date(t.due).getTime();
    const left=((s-minD)/range*100), width=Math.max(((e-s)/range*100),2);
    let clr='var(--primary)';if(t.status==='done')clr='var(--success)';else if(isOverdue(t))clr='var(--danger)';else if(t.priority==='high')clr='#ef4444';
    return '<div class="gantt-row"><div class="gantt-label">'+escHtml(t.title)+'</div><div class="gantt-timeline"><div class="gantt-bar" style="left:'+left+'%;width:'+width+'%;background:'+clr+'">'+escHtml(t.title)+'</div></div></div>';
  }).join('');
}

/* ═══════ MY DAY ═══════ */
function myDaySlotHtml(label,items){
  let html='<div class="time-block"><h4 class="time-block-label">'+label+'</h4>';
  if(items.length) {
    items.forEach(t=>{
      const dn=t.status==='done';
      html+='<div class="task-card'+(dn?' completed-card':'')+'" ondblclick="openModal(\''+t.id+'\')"><div class="task-check'+(dn?' checked':'')+'" onclick="toggleDone(\''+t.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div><div class="task-body"><div class="task-title-text'+(dn?' done':'')+'"><span style="color:var(--text3);font-size:.72rem;font-weight:700;margin-right:4px">#'+(t.numId||'')+'</span>'+escHtml(t.title)+'</div><div class="task-meta"><span class="tag tag-'+t.priority+'">'+t.priority+'</span>'+taskDueHtml(t,isOverdue(t))+'</div></div><select onchange="setMyDaySlot(\''+t.id+'\',this.value)" style="font-size:.72rem;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:var(--bg)"><option value="morning"'+(t.myDaySlot!=='afternoon'&&t.myDaySlot!=='evening'?' selected':'')+'>Morning</option><option value="afternoon"'+(t.myDaySlot==='afternoon'?' selected':'')+'>Afternoon</option><option value="evening"'+(t.myDaySlot==='evening'?' selected':'')+'>Evening</option></select></div>';
    });
  } else {
    html+='<p style="color:var(--text3);font-size:.8rem;padding:8px">No tasks</p>';
  }
  return html+'</div>';
}
function renderMyDay() {
  const tasks=loadTasks(), today=todayStr();
  const todayTasks=tasks.filter(t=>t.due===today||t.myDay===today);
  const morning=todayTasks.filter(t=>{const h=t.myDaySlot||'morning';return h==='morning';});
  const afternoon=todayTasks.filter(t=>t.myDaySlot==='afternoon');
  const evening=todayTasks.filter(t=>t.myDaySlot==='evening');
  const totalToday=todayTasks.length, doneToday=todayTasks.filter(t=>t.status==='done').length;
  const dailyNote=localStorage.getItem(userKey('dailyNote_'+today))||'';
  document.getElementById('myDayStats').innerHTML=
    '<div class="stat-card" style="flex:1;min-width:120px"><div class="stat-info"><h3>Today\'s Tasks</h3><div class="num">'+totalToday+'</div></div></div><div class="stat-card" style="flex:1;min-width:120px"><div class="stat-info"><h3>Completed</h3><div class="num">'+doneToday+'</div></div></div><div class="stat-card" style="flex:1;min-width:120px"><div class="stat-info"><h3>Remaining</h3><div class="num">'+(totalToday-doneToday)+'</div></div></div>';
  document.getElementById('myDayBlocks').innerHTML=
    '<div class="my-day-grid">'+myDaySlotHtml('&#9728; Morning',morning)+myDaySlotHtml('&#9788; Afternoon',afternoon)+myDaySlotHtml('&#9790; Evening',evening)+'</div>';
  const noteEl=document.getElementById('dailyNoteInput');
  if(noteEl&&!noteEl.matches(':focus')) noteEl.value=dailyNote;
}
function setMyDaySlot(id,slot){const tasks=loadTasks(),t=tasks.find(x=>x.id===id);if(t){t.myDaySlot=slot;saveTasks(tasks);renderMyDay();}}
function saveDailyNote(){const el=document.getElementById('dailyNoteInput');if(el)localStorage.setItem(userKey('dailyNote_'+todayStr()),el.value);}
function addToMyDay(){const tasks=loadTasks().filter(t=>t.status!=='done'&&t.due!==todayStr()&&t.myDay!==todayStr());if(!tasks.length){toast('No tasks available');return;}
  const id=tasks[0].id;const ts=loadTasks(),t=ts.find(x=>x.id===id);if(t){t.myDay=todayStr();saveTasks(ts);renderMyDay();toast('Added to My Day');}}

/* ═══════ PROJECTS ═══════ */
function renderProjects(){
  const projects=loadProjects(), tasks=loadTasks();
  const c=document.getElementById('projectGrid');
  if(!projects.length){c.innerHTML='<div class="empty-state"><h3>No Projects</h3><p>Create your first project</p><button class="btn btn-sm btn-primary" onclick="openProjectModal()">Create Project</button></div>';return;}
  c.innerHTML=projects.map(p=>{
    const pTasks=tasks.filter(t=>t.project===p.id);
    const done=pTasks.filter(t=>t.status==='done').length, total=pTasks.length;
    const pct=total?Math.round(done/total*100):0;
    return '<div class="project-card" onclick="filterByProject(\''+p.id+'\')"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div class="project-dot" style="background:'+escHtml(p.color||'var(--primary)')+'"></div><h3 style="font-size:1rem;font-weight:700">'+escHtml(p.name)+'</h3><div style="margin-left:auto;display:flex;gap:4px"><button class="btn-icon" onclick="event.stopPropagation();openProjectModal(\''+p.id+'\')" title="Edit" style="color:var(--text3)">&#9998;</button><button class="btn-icon" onclick="event.stopPropagation();deleteProject(\''+p.id+'\')" title="Delete" style="color:var(--danger)">&#128465;</button></div></div><p style="font-size:.8rem;color:var(--text3);margin-bottom:10px">'+escHtml(p.description||'')+'</p><div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:6px"><span>'+done+'/'+total+' tasks</span><span>'+pct+'%</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+pct+'%;background:'+escHtml(p.color||'var(--primary)')+'"></div></div></div>';
  }).join('');
}
function openProjectModal(id){
  const p=id?loadProjects().find(x=>x.id===id):null;
  editingProjectId=id||null;
  document.getElementById('projectNameInput').value=p?p.name:'';
  document.getElementById('projectColorInput').value=p?p.color:'#6366f1';
  document.getElementById('projectDescInput').value=p?p.description:'';
  document.getElementById('projectModal').classList.add('active');
}
function closeProjectModal(){document.getElementById('projectModal').classList.remove('active');editingProjectId=null;}
function saveProject(){
  const name=document.getElementById('projectNameInput').value.trim();
  if(!name){toast('Project name required');return;}
  const projects=loadProjects();
  if(editingProjectId){const p=projects.find(x=>x.id===editingProjectId);if(p){p.name=name;p.color=document.getElementById('projectColorInput').value;p.description=document.getElementById('projectDescInput').value.trim();}}
  else{projects.push({id:'p'+Date.now(),name:name,color:document.getElementById('projectColorInput').value,description:document.getElementById('projectDescInput').value.trim(),createdAt:Date.now()});}
  saveProjects(projects);closeProjectModal();renderProjects();populateProjectFilter();toast('Project saved');
}
function deleteProject(id){
  if(!confirm('Delete this project?')) { return; }
  const projects=loadProjects().filter(p=>p.id!==id);saveProjects(projects);
  const tasks=loadTasks();tasks.forEach(t=>{if(t.project===id){t.project='';}});saveTasks(tasks);renderProjects();toast('Project deleted');
}
function filterByProject(id){showPage('tasks');document.getElementById('filterProject').value=id;renderTasks();}
function populateProjectFilter(){
  const projects=loadProjects();
  ['filterProject','taskProjectInput','dashProjectFilter'].forEach(elId=>{
    const el=document.getElementById(elId);if(!el)return;
    const val=el.value;
    const opts='<option value="all">All Projects</option>'+projects.map(p=>'<option value="'+p.id+'">'+escHtml(p.name)+'</option>').join('');
    el.innerHTML=elId==='taskProjectInput'?opts.replace('value="all">All Projects','value="">None'):opts;
    el.value=[...el.options].some(o=>o.value===val)?val:(elId==='taskProjectInput'?'':'all');
  });
  populateAssigneeFilter();
}

/* ═══════ EISENHOWER MATRIX ═══════ */
function renderEisenhower(){
  const tasks=loadTasks().filter(t=>t.status!=='done');
  const quadrants=[
    {key:'q1',label:'Urgent & Important',clr:'#ef4444',desc:'Do First',icon:'\u{1F525}',emptyIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',emptyMsg:'No urgent & important tasks'},
    {key:'q2',label:'Not Urgent & Important',clr:'#3b82f6',desc:'Schedule',icon:'\u{1F4C5}',emptyIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',emptyMsg:'No tasks to schedule'},
    {key:'q3',label:'Urgent & Not Important',clr:'#f59e0b',desc:'Delegate',icon:'\u{1F91D}',emptyIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',emptyMsg:'No tasks to delegate'},
    {key:'q4',label:'Not Urgent & Not Important',clr:'#6b7280',desc:'Eliminate',icon:'\u{1F5D1}',emptyIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',emptyMsg:'Nothing to eliminate'}
  ];
  const categorized={q1:[],q2:[],q3:[],q4:[]};
  tasks.forEach(t=>{
    if(t.eisenhower&&categorized[t.eisenhower]) categorized[t.eisenhower].push(t);
    else{
      const urgent=t.due&&((new Date(t.due)-Date.now())/864e5)<=2;
      const important=t.priority==='high'||t.priority==='medium';
      if(urgent&&important) categorized.q1.push(t);
      else if(!urgent&&important) categorized.q2.push(t);
      else if(urgent&&!important) categorized.q3.push(t);
      else categorized.q4.push(t);
    }
  });
  document.getElementById('eisenhowerGrid').innerHTML=quadrants.map(q=>{
    const items=categorized[q.key];
    const tasksHtml=items.length?items.map(t=>
      '<div class="eq-task" draggable="true" ondragstart="kanbanDragStart(event,\''+t.id+'\')" ondblclick="openModal(\''+t.id+'\')">'+
      '<span class="kc-priority" style="background:'+priorityColor(t.priority)+'"></span>'+
      '<span class="eq-task-title"><span style="color:var(--text3);font-size:.72rem;font-weight:700;margin-right:4px">#'+(t.numId||'')+'</span>'+escHtml(t.title)+'</span>'+
      (t.due?'<span class="eq-task-due">'+fmtDate(t.due)+'</span>':'')+
      '</div>').join('')
      :'<div class="eq-empty">'+q.emptyIcon+'<p>'+q.emptyMsg+'</p></div>';
    return '<div class="eq-quadrant" data-q="'+q.key+'" ondrop="eqDrop(event,\''+q.key+'\')" ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ondragleave="this.classList.remove(\'drag-over\')">'+
      '<div class="eq-quadrant-header"><div class="eq-label"><span class="eq-icon">'+q.icon+'</span><div><div class="eq-title">'+q.label+'</div></div></div><span class="eq-action">'+q.desc+'<span class="eq-count"> &bull; '+items.length+'</span></span></div>'+
      '<div class="eq-tasks">'+tasksHtml+'</div></div>';
  }).join('');
}
function eqDrop(e,quadrant){
  e.preventDefault();e.currentTarget.classList.remove('drag-over');
  if(!dragTaskId) return;
  const tasks=loadTasks(),t=tasks.find(x=>x.id===dragTaskId);
  if(t){t.eisenhower=quadrant;saveTasks(tasks);renderEisenhower();toast('Moved to '+quadrant.toUpperCase());}
  dragTaskId=null;
}

/* ═══════ GOALS ═══════ */
function renderGoals(){
  let goals=loadGoals();
  const filter=goalFilter||'all';
  if(filter!=='all') goals=goals.filter(g=>g.type===filter);
  const c=document.getElementById('goalsList');
  if(!goals.length){c.innerHTML='<div class="empty-state"><h3>No Goals</h3><p>Set your first goal</p><button class="btn btn-sm btn-primary" onclick="openGoalModal()">Create Goal</button></div>';return;}
  c.innerHTML=goals.map(g=>{
    const pct=Math.min(100,Math.round((g.current||0)/g.target*100));
    return '<div class="goal-card"><div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px"><div><h3 style="font-size:.95rem;font-weight:700">'+escHtml(g.title)+'</h3><span class="tag" style="font-size:.65rem;background:var(--surface3)">'+g.type+'</span></div><div style="display:flex;gap:4px"><button class="btn-icon" onclick="openGoalModal(\''+g.id+'\')" style="color:var(--text3)">&#9998;</button><button class="btn-icon" onclick="deleteGoal(\''+g.id+'\')" style="color:var(--danger)">&#128465;</button></div></div><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:4px"><span>'+escHtml(g.unit||'tasks')+'</span><span style="font-weight:700">'+(g.current||0)+'/'+g.target+'</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+pct+'%;background:'+(pct>=100?'var(--success)':'var(--primary)')+'"></div></div><div style="text-align:center;font-size:1.2rem;font-weight:800;margin-top:6px;color:'+(pct>=100?'var(--success)':'var(--primary)')+'">'+pct+'%</div></div>';
  }).join('');
}
function openGoalModal(id){
  const g=id?loadGoals().find(x=>x.id===id):null;
  editingGoalId=id||null;
  document.getElementById('goalTitleInput').value=g?g.title:'';
  document.getElementById('goalTypeInput').value=g?g.type:'weekly';
  document.getElementById('goalTargetInput').value=g?g.target:5;
  document.getElementById('goalCurrentInput').value=g?g.current||0:0;
  document.getElementById('goalUnitInput').value=g?g.unit||'tasks':'tasks';
  document.getElementById('goalModal').classList.add('active');
}
function closeGoalModal(){document.getElementById('goalModal').classList.remove('active');editingGoalId=null;}
function saveGoal(){
  const title=document.getElementById('goalTitleInput').value.trim();
  if(!title){toast('Goal title required');return;}
  const goals=loadGoals();
  const data={title:title,type:document.getElementById('goalTypeInput').value,target:Number.parseInt(document.getElementById('goalTargetInput').value)||5,current:Number.parseInt(document.getElementById('goalCurrentInput').value)||0,unit:document.getElementById('goalUnitInput').value.trim()||'tasks'};
  if(editingGoalId){const g=goals.find(x=>x.id===editingGoalId);if(g)Object.assign(g,data);}
  else{goals.push({id:'g'+Date.now(),...data,createdAt:Date.now()});}
  saveGoals(goals);closeGoalModal();renderGoals();renderDashGoals();toast('Goal saved');
}
function deleteGoal(id){
  if(!confirm('Delete this goal?')) { return; }
  saveGoals(loadGoals().filter(g=>g.id!==id));renderGoals();renderDashGoals();toast('Goal deleted');
}
function filterGoals(type){goalFilter=type;['goalFilterWeekly','goalFilterMonthly','goalFilterAll'].forEach(id=>{const b=document.getElementById(id);if(b)b.classList.toggle('active',id==='goalFilter'+type.charAt(0).toUpperCase()+type.slice(1));});renderGoals();}

/* ═══════ HABITS ═══════ */
function renderHabits(){
  const habits=loadHabits();
  const c=document.getElementById('habitsList');
  if(!habits.length){c.innerHTML='<div class="empty-state"><h3>No Habits</h3><p>Start tracking a habit</p><button class="btn btn-sm btn-primary" onclick="openHabitModal()">Create Habit</button></div>';return;}
  c.innerHTML=habits.map(h=>{
    const streak=calcHabitStreak(h);
    const days=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const ds=d.toISOString().slice(0,10);days.push({ds:ds,done:h.completions&&h.completions[ds],label:['S','M','T','W','T','F','S'][d.getDay()],today:i===0});}
    return '<div class="habit-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="font-size:.95rem;font-weight:700">'+escHtml(h.name)+'</h3><div style="display:flex;gap:4px;align-items:center"><span style="font-size:.72rem;color:var(--text3)">'+streak+' day streak &#128293;</span><button class="btn-icon" onclick="openHabitModal(\''+h.id+'\')" style="color:var(--text3)">&#9998;</button><button class="btn-icon" onclick="deleteHabit(\''+h.id+'\')" style="color:var(--danger)">&#128465;</button></div></div><div class="habit-week">'+days.map(d=>'<div class="habit-day'+(d.done?' done':'')+(d.today?' today':'')+'" onclick="toggleHabitDay(\''+h.id+'\',\''+d.ds+'\')"><div class="habit-dot"></div><span>'+d.label+'</span></div>').join('')+'</div></div>';
  }).join('');
}
function calcHabitStreak(h){
  if(!h.completions) return 0;
  let streak=0, d=new Date();d.setHours(0,0,0,0);
  let ds=d.toISOString().slice(0,10);
  if(!h.completions[ds]){d.setDate(d.getDate()-1);ds=d.toISOString().slice(0,10);}
  for(let i=0;i<365;i++){ds=d.toISOString().slice(0,10);if(h.completions[ds]){streak++;d.setDate(d.getDate()-1);}else break;}
  return streak;
}
function toggleHabitDay(id,ds){
  const habits=loadHabits(),h=habits.find(x=>x.id===id);
  if(!h) return;
  if(!h.completions) h.completions={};
  h.completions[ds]=!h.completions[ds];
  if(!h.completions[ds]) delete h.completions[ds];
  saveHabits(habits);renderHabits();renderDashHabits();
}
function openHabitModal(id){
  const h=id?loadHabits().find(x=>x.id===id):null;
  editingHabitId=id||null;
  document.getElementById('habitNameInput').value=h?h.name:'';
  document.getElementById('habitModal').classList.add('active');
}
function closeHabitModal(){document.getElementById('habitModal').classList.remove('active');editingHabitId=null;}
function saveHabit(){
  const name=document.getElementById('habitNameInput').value.trim();
  if(!name){toast('Habit name required');return;}
  const habits=loadHabits();
  if(editingHabitId){const h=habits.find(x=>x.id===editingHabitId);if(h)h.name=name;}
  else{habits.push({id:'h'+Date.now(),name:name,completions:{},createdAt:Date.now()});}
  saveHabits(habits);closeHabitModal();renderHabits();renderDashHabits();toast('Habit saved');
}
function deleteHabit(id){
  if(!confirm('Delete this habit?')) { return; }
  saveHabits(loadHabits().filter(h=>h.id!==id));renderHabits();renderDashHabits();toast('Habit deleted');
}

/* ═══════ NOTES ═══════ */
function renderNotes(){
  let notes=loadNotes();
  const search=document.getElementById('noteSearch')?document.getElementById('noteSearch').value.trim().toLowerCase():'';
  if(noteFolder) notes=notes.filter(n=>(n.folder||'')===(noteFolder==='unfiled'?'':noteFolder));
  if(search) notes=notes.filter(n=>n.title.toLowerCase().includes(search)||(n.content||'').toLowerCase().includes(search));
  notes.sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt));
  const folders=new Set(loadNotes().map(n=>n.folder||'').filter(Boolean));
  document.getElementById('notesFolders').innerHTML='<div class="note-folder'+(noteFolder===''||!noteFolder?' active':'')+'" onclick="setNoteFolder(\'\')">All Notes</div>'+
    '<div class="note-folder'+(noteFolder==='unfiled'?' active':'')+'" onclick="setNoteFolder(\'unfiled\')">Unfiled</div>'+
    [...folders].map(f=>'<div class="note-folder'+(noteFolder===f?' active':'')+'" onclick="setNoteFolder(\''+escHtml(f)+'\')">&#128193; '+escHtml(f)+'</div>').join('');
  const c=document.getElementById('notesGrid');
  if(!notes.length){c.innerHTML='<div class="empty-state"><h3>No Notes</h3><p>Create your first note</p><button class="btn btn-sm btn-primary" onclick="openNoteEditor()">Create Note</button></div>';return;}
  c.innerHTML=notes.map(n=>{
    const preview=(n.content||'').slice(0,120);
    return '<div class="note-card'+(n.pinned?' pinned':'')+'" onclick="openNoteEditor(\''+n.id+'\')"><div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px"><h3 style="font-size:.9rem;font-weight:700">'+(n.pinned?'&#128204; ':'')+escHtml(n.title)+'</h3><span style="font-size:.65rem;color:var(--text3)">'+fmtRelative(n.updatedAt||n.createdAt)+'</span></div><p style="font-size:.78rem;color:var(--text3);line-height:1.5">'+escHtml(preview)+'</p>'+(n.folder?'<div style="margin-top:6px"><span class="tag" style="font-size:.65rem;background:var(--surface3)">&#128193; '+escHtml(n.folder)+'</span></div>':'')+'</div>';
  }).join('');
}
function setNoteFolder(f){noteFolder=f;renderNotes();}
function openNoteEditor(id){
  const n=id?loadNotes().find(x=>x.id===id):null;
  editingNoteId=id||null;
  document.getElementById('noteTitleInput').value=n?n.title:'';
  document.getElementById('noteContentInput').value=n?n.content:'';
  document.getElementById('noteFolderInput').value=n?n.folder||'':'';
  document.getElementById('notePinInput').checked=n?n.pinned:false;
  document.getElementById('noteEditorModal').classList.add('active');
  updateNotePreview();
}
function closeNoteEditor(){document.getElementById('noteEditorModal').classList.remove('active');editingNoteId=null;}
function updateNotePreview(){
  const md=document.getElementById('noteContentInput').value;
  document.getElementById('notePreview').innerHTML=renderMd(md)||'<p style="color:var(--text3)">Preview will appear here...</p>';
}
function saveNote(){
  const title=document.getElementById('noteTitleInput').value.trim()||'Untitled Note';
  const notes=loadNotes();
  const data={title:title,content:document.getElementById('noteContentInput').value,folder:document.getElementById('noteFolderInput').value.trim(),pinned:document.getElementById('notePinInput').checked,updatedAt:Date.now()};
  if(editingNoteId){const n=notes.find(x=>x.id===editingNoteId);if(n)Object.assign(n,data);}
  else{notes.push({id:'n'+Date.now(),...data,createdAt:Date.now()});}
  saveNotes(notes);closeNoteEditor();renderNotes();toast('Note saved');
}
function deleteNote(){
  if(!editingNoteId||!confirm('Delete this note?')) return;
  saveNotes(loadNotes().filter(n=>n.id!==editingNoteId));closeNoteEditor();renderNotes();toast('Note deleted');
}

/* ═══════ TIME REPORTS ═══════ */
function renderReports(){
  const tasks=loadTasks();
  const logged=tasks.filter(t=>t.logged_hours>0);
  const totalH=logged.reduce((s,t)=>s+(t.logged_hours||0),0);
  const byCategory={},byProject={},byDay={};
  logged.forEach(t=>{
    const c=t.category||'Other';byCategory[c]=(byCategory[c]||0)+(t.logged_hours||0);
    if(t.project){const pn=getProjectName(t.project)||'Unknown';byProject[pn]=(byProject[pn]||0)+(t.logged_hours||0);}
    if(t.completedAt){const ds=new Date(t.completedAt).toISOString().slice(0,10);byDay[ds]=(byDay[ds]||0)+(t.logged_hours||0);}
  });
  function barChart(data,maxH){
    const entries=Object.entries(data).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const max=Math.max(...entries.map(e=>e[1]),1);
    return entries.map(([k,v])=>'<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px"><span>'+escHtml(k)+'</span><span style="font-weight:600">'+v.toFixed(1)+'h</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+Math.round(v/max*100)+'%;background:var(--primary)"></div></div></div>').join('');
  }
  document.getElementById('reportGrid').innerHTML=
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">'+
    '<div class="card"><div class="card-title">Total Logged</div><div style="text-align:center;padding:16px"><div style="font-size:2.5rem;font-weight:900;color:var(--primary)">'+totalH.toFixed(1)+'</div><p style="color:var(--text3);font-size:.82rem">hours across '+logged.length+' tasks</p></div></div>'+
    '<div class="card"><div class="card-title">Hours by Category</div>'+(Object.keys(byCategory).length?barChart(byCategory):'<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:12px">No data</p>')+'</div>'+
    '<div class="card"><div class="card-title">Hours by Project</div>'+(Object.keys(byProject).length?barChart(byProject):'<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:12px">No data</p>')+'</div>'+
    '<div class="card"><div class="card-title">Hours by Day (Recent)</div>'+(Object.keys(byDay).length?barChart(byDay):'<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:12px">No data</p>')+'</div>'+
    '</div>';
}

/* ═══════ POMODORO TIMER ═══════ */
function loadPomodoroSettings(){
  pomoWorkSec=(Number.parseInt(localStorage.getItem(userKey('pomoWork')))||25)*60;
  pomoBreakSec=(Number.parseInt(localStorage.getItem(userKey('pomoBreak')))||5)*60;
  pomoSessionCount=Number.parseInt(localStorage.getItem(userKey('pomoSessions')))||0;
  pomoMode='work';
}
function savePomodoroSettings(){
  localStorage.setItem(userKey('pomoWork'),String(Math.floor(pomoWorkSec/60)));
  localStorage.setItem(userKey('pomoBreak'),String(Math.floor(pomoBreakSec/60)));
  localStorage.setItem(userKey('pomoSessions'),String(pomoSessionCount));
}
function openPomodoro(){
  document.getElementById('focusOverlay').classList.add('active');
  const tasks=loadTasks().filter(t=>t.status!=='done');
  const sel=document.getElementById('focusTaskSelect');
  if(sel){sel.innerHTML='<option value="">-- Select Task --</option>'+tasks.map(t=>'<option value="'+t.id+'"'+(t.id===focusTaskId?' selected':'')+'>'+escHtml(t.title)+'</option>').join('');}
  updatePomodoroDisplay();
}
function closePomodoro(){
  document.getElementById('focusOverlay').classList.remove('active');
  if(focusInterval){clearInterval(focusInterval);focusInterval=null;}
}
function updatePomodoroDisplay(){
  const totalSec=pomoMode==='work'?pomoWorkSec:pomoBreakSec;
  const display=focusSeconds>=0?focusSeconds:totalSec;
  const min=String(Math.floor(display/60)).padStart(2,'0');
  const sec=String(display%60).padStart(2,'0');
  document.getElementById('focusTimer').textContent=min+':'+sec;
  document.getElementById('pomoModeLabel').textContent=pomoMode==='work'?'Work Session':'Break Time';
  document.getElementById('pomoModeLabel').style.background=pomoMode==='work'?'var(--primary)':'var(--success)';
  const dots=document.getElementById('pomoSessions');
  dots.innerHTML='';
  for(let i=0;i<4;i++){const dot=document.createElement('div');dot.className='pomo-dot'+(i<(pomoSessionCount%4)?' filled':'');dots.appendChild(dot);}
}
function togglePomoTimer(){
  if(focusInterval){clearInterval(focusInterval);focusInterval=null;return;}
  if(focusSeconds<=0) focusSeconds=pomoMode==='work'?pomoWorkSec:pomoBreakSec;
  focusInterval=setInterval(()=>{
    focusSeconds--;
    if(focusSeconds<=0){
      clearInterval(focusInterval);focusInterval=null;
      pomoBeep();
      if(pomoMode==='work'){pomoSessionCount++;savePomodoroSettings();toast('Work session complete! Take a break.');pomoMode='break';}
      else{toast('Break over! Start working.');pomoMode='work';}
      focusSeconds=pomoMode==='work'?pomoWorkSec:pomoBreakSec;
      updatePomodoroDisplay();
      return;
    }
    updatePomodoroDisplay();
  },1000);
}
function resetPomoTimer(){
  if(focusInterval){clearInterval(focusInterval);focusInterval=null;}
  focusSeconds=pomoMode==='work'?pomoWorkSec:pomoBreakSec;
  updatePomodoroDisplay();
}
function pomoBeep(){
  try{const ctx=new(globalThis.AudioContext||globalThis.webkitAudioContext)();const o=ctx.createOscillator();o.type='sine';o.frequency.value=800;const g=ctx.createGain();g.gain.value=0.3;o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+0.3);}catch(e){console.debug('Audio unavailable:',e);}
}
function startTimerForTask(id){
  const tasks=loadTasks(),t=tasks.find(x=>x.id===id);
  if(t){document.getElementById('focusTaskTitle').textContent=escHtml(t.title);focusTaskId=id;openPomodoro();}
}
function savePomoTime(){
  if(!focusTaskId){toast('No task selected');return;}
  const tasks=loadTasks(),t=tasks.find(x=>x.id===focusTaskId);
  if(t){t.logged_hours=(t.logged_hours||0)+Math.round(pomoWorkSec/60/60*100)/100;saveTasks(tasks);toast('Time logged to '+escHtml(t.title));}
}
function selectFocusTask(){
  const sel=document.getElementById('focusTaskSelect');
  if(!sel||!sel.value){return;}
  focusTaskId=sel.value;
  const tasks=loadTasks(),t=tasks.find(x=>x.id===sel.value);
  if(t){document.getElementById('focusTaskTitle').textContent=escHtml(t.title);}
}

/* ═══════ REMINDERS ═══════ */
function startReminderCheck(){
  if(reminderInterval) clearInterval(reminderInterval);
  reminderInterval=setInterval(checkReminders,60000);
  checkReminders();
}
function checkReminders(){
  const tasks=loadTasks(), now=new Date();
  tasks.forEach(t=>{
    if(t.reminder&&!t.reminderDismissed){
      const rTime=new Date(t.reminder);
      if(rTime<=now&&(now-rTime)<300000){
        showNotification('Reminder: '+t.title,'Task "'+t.title+'" is due!');
        t.reminderDismissed=true;
      }
    }
  });
  saveTasks(tasks);
}
function showNotification(title,body){
  if('Notification' in globalThis&&Notification.permission==='granted'){new Notification(title,{body:body,icon:'icon-192.png'});}
  else toast(title);
}
function requestNotifPermission(){
  if('Notification' in globalThis&&Notification.permission!=='granted'){Notification.requestPermission().then(p=>{toast(p==='granted'?'Notifications enabled':'Notifications blocked');});}
}

/* ═══════ CATEGORY NAV & PROJECT FILTER ═══════ */
function renderCategoryNav(){
  const tasks=loadTasks(), cats=new Set(tasks.map(t=>t.category).filter(Boolean));
  const el=document.getElementById('categoryNav');
  if(!el) return;
  if(cats.size===0){
    el.innerHTML='<span style="font-size:.72rem;color:var(--text3);padding:2px 0">Add categories to tasks to filter here</span>';
    return;
  }
  el.innerHTML='<button class="cat-pill active" onclick="filterByCat(\'\')">All</button>'+
    [...cats].sort().map(c=>'<button class="cat-pill" onclick="filterByCat(\''+escHtml(c)+'\')">'+escHtml(c)+'</button>').join('');
}

function filterByCat(cat){
  showPage('tasks');
  document.getElementById('filterCategory').value=cat||'all';
  document.querySelectorAll('.cat-pill').forEach(b=>b.classList.remove('active'));
  const active=[...document.querySelectorAll('.cat-pill')].find(b=>b.textContent===(cat||'All'));
  if(active) active.classList.add('active');
  renderTasks();
}

/* ═══════ GLOBAL SEARCH ═══════ */
function handleGlobalSearch(e){
  const input=e&&e.target ? e.target : document.getElementById('searchInput');
  const q=input ? input.value.trim().toLowerCase() : '';
  const results=document.getElementById('searchResults');
  if(!q){results.innerHTML='';results.style.display='none';return;}
  const tasks=loadTasks().filter(t=>t.title.toLowerCase().includes(q)||(t.description||'').toLowerCase().includes(q)||(t.tags||[]).some(tg=>tg.toLowerCase().includes(q)));
  results.style.display='block';
  results.innerHTML=tasks.slice(0,8).map(t=>'<div class="search-result-item" onclick="openModal(\''+t.id+'\');closeSearch()"><span class="tag tag-'+t.priority+'" style="font-size:.6rem">'+t.priority+'</span> '+escHtml(t.title)+(t.due?' <span style="font-size:.7rem;color:var(--text3)">'+fmtDate(t.due)+'</span>':'')+'</div>').join('')||'<div class="search-result-item" style="color:var(--text3)">No results</div>';
}
function closeSearch(){
  const s=document.getElementById('searchResults'),i=document.getElementById('searchInput');
  if(s){s.style.display='none';s.innerHTML='';}
  if(i) i.value='';
}

/* ═══════ QUICK ADD ═══════ */
function openQuickAdd(){document.getElementById('quickAddOverlay').classList.add('active');document.getElementById('quickAddInput').value='';document.getElementById('quickAddInput').focus();}
function closeQuickAdd(){document.getElementById('quickAddOverlay').classList.remove('active');}
function handleQuickAdd(e){
  if(e.key!=='Enter') return;
  let val=document.getElementById('quickAddInput').value.trim();
  if(!val) return;
  let priority='medium',category='',tags=[],project='';
  val=val.replaceAll(/!(\w+)/g,(_,p)=>{
    if(['high','medium','low'].includes(p)) { priority=p; }
    return '';
  });
  val=val.replaceAll(/@(\w+)/g,(_,c)=>{category=c;return '';});
  val=val.replaceAll(/#(\w+)/g,(_,t)=>{tags.push(t);return '';});
  val=val.replaceAll(/~(\w+)/g,(_,p)=>{
    const prj=loadProjects().find(x=>x.name.toLowerCase()===p.toLowerCase());
    if(prj) { project=prj.id; }
    return '';
  });
  val=val.trim();
  if(!val) return;
  const tasks=loadTasks();
  const newT={id:'t'+Date.now(),numId:getNextNumId(),title:val,description:'',status:'todo',priority:priority,category:category,tags:tags,due:'',recurring:'',subtasks:[],progress:0,estimated_hours:0,logged_hours:0,link:'',createdAt:Date.now(),updatedAt:Date.now(),completedAt:null,sortOrder:tasks.length,project:project,assignee:currentUser||'',dependencies:[],eisenhower:'',milestone:false,reminder:'',comments:[],smartScore:0,myDay:'',myDaySlot:'morning'};
  newT.smartScore=calcSmartScore(newT);
  tasks.push(newT);saveTasks(tasks);
  addActivity('Created "'+val+'"','add');
  sheetPost({action:'ADD',...taskToSheetRow(newT)});
  closeQuickAdd();toast('Task created');refreshAll();
}

/* ═══════ TEMPLATES ═══════ */
function saveAsTemplate(){
  const name=prompt('Template name:');if(!name) return;
  const templates=loadTemplates();
  const tasks=loadTasks().filter(t=>selectedIds.has(t.id));
  if(!tasks.length){toast('Select tasks first');return;}
  templates.push({id:'tpl'+Date.now(),name:name,tasks:tasks.map(t=>({title:t.title,description:t.description,priority:t.priority,category:t.category,tags:t.tags||[],subtasks:(t.subtasks||[]).map(s=>({text:s.text,done:false})),estimated_hours:t.estimated_hours||0})),createdAt:Date.now()});
  saveTemplates(templates);clearSelection();toast('Template saved');
}
function openTemplatesModal(){
  const tpls=loadTemplates();
  document.getElementById('templateList').innerHTML=tpls.length?tpls.map(tp=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)"><div><strong>'+escHtml(tp.name)+'</strong><span style="font-size:.72rem;color:var(--text3);margin-left:8px">'+tp.tasks.length+' tasks</span></div><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="useTemplate(\''+tp.id+'\')">Use</button><button class="btn btn-sm" style="color:var(--danger)" onclick="deleteTemplate(\''+tp.id+'\')">Delete</button></div></div>').join(''):'<p style="color:var(--text3);text-align:center;padding:16px">No templates</p>';
  document.getElementById('templatesModal').classList.add('active');
}
function closeTemplates(){document.getElementById('templatesModal').classList.remove('active');}
function useTemplate(id){
  const tpl=loadTemplates().find(t=>t.id===id);if(!tpl) return;
  const tasks=loadTasks();
  let nextTemplateNumId=getNextNumId();
  tpl.tasks.forEach(tt=>{
    tasks.push({id:'t'+Date.now()+Math.random().toString(36).slice(2,6),numId:nextTemplateNumId++,title:tt.title,description:tt.description||'',status:'todo',priority:tt.priority||'medium',category:tt.category||'',tags:tt.tags||[],due:'',recurring:'',subtasks:(tt.subtasks||[]).map(s=>({text:s.text,done:false})),progress:0,estimated_hours:tt.estimated_hours||0,logged_hours:0,link:'',createdAt:Date.now(),completedAt:null,sortOrder:tasks.length,project:'',dependencies:[],eisenhower:'',milestone:false,reminder:'',comments:[],smartScore:0,myDay:'',myDaySlot:'morning'});
  });
  saveTasks(tasks);closeTemplates();toast('Template applied');refreshAll();
}
function deleteTemplate(id){saveTemplates(loadTemplates().filter(t=>t.id!==id));openTemplatesModal();toast('Template deleted');}

/* ═══════ SAVED FILTERS ═══════ */
function openSavedFilters(){
  renderSavedFilters();
  document.getElementById('filtersModal').classList.add('active');
}
function closeFiltersModal(){document.getElementById('filtersModal').classList.remove('active');}
function saveCurrentFilter(){
  const name=prompt('Filter name:');if(!name) return;
  const filters=loadFilters();
  filters.push({id:'f'+Date.now(),name:name,status:document.getElementById('filterStatus').value,priority:document.getElementById('filterPriority').value,category:document.getElementById('filterCategory').value,project:document.getElementById('filterProject')?document.getElementById('filterProject').value:'all',assignee:document.getElementById('filterAssignee')?document.getElementById('filterAssignee').value:'all',sort:document.getElementById('sortBy').value});
  saveFilters(filters);renderSavedFilters();toast('Filter saved');
}
function renderSavedFilters(){
  const filters=loadFilters();
  document.getElementById('savedFiltersList').innerHTML=filters.length?filters.map(f=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)"><span>'+escHtml(f.name)+'</span><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="applyFilter(\''+f.id+'\')">Apply</button><button class="btn btn-sm" style="color:var(--danger)" onclick="deleteFilter(\''+f.id+'\')">Delete</button></div></div>').join(''):'<p style="color:var(--text3);text-align:center;padding:16px">No saved filters</p>';
}
function applyFilter(id){
  const f=loadFilters().find(x=>x.id===id);if(!f) return;
  document.getElementById('filterStatus').value=f.status||'all';
  document.getElementById('filterPriority').value=f.priority||'all';
  document.getElementById('filterCategory').value=f.category||'all';
  if(document.getElementById('filterProject')) document.getElementById('filterProject').value=f.project||'all';
  if(document.getElementById('filterAssignee')) document.getElementById('filterAssignee').value=f.assignee||'all';
  document.getElementById('sortBy').value=f.sort||'created-desc';
  closeFiltersModal();showPage('tasks');renderTasks();toast('Filter applied');
}
function deleteFilter(id){saveFilters(loadFilters().filter(f=>f.id!==id));renderSavedFilters();toast('Filter deleted');}

/* ═══════ RECURRING ═══════ */
function processRecurring(){
  const tasks=loadTasks();let added=false;let nextRecurNumId=getNextNumId(tasks);
  tasks.forEach(t=>{
    if(t.status==='done'&&t.recurring&&t.completedAt){
      const elapsed=(Date.now()-t.completedAt)/864e5;
      let period=0;
      if(t.recurring==='daily') period=1;
      else if(t.recurring==='weekly') period=7;
      else if(t.recurring==='monthly') period=30;
      if(period>0&&elapsed>=period){
        const nd=new Date();
        if(t.due){const dd=new Date(t.due);dd.setDate(dd.getDate()+period);nd.setTime(dd.getTime());}
        tasks.push({id:'t'+Date.now()+Math.random().toString(36).slice(2,6),numId:nextRecurNumId++,title:t.title,description:t.description,status:'todo',priority:t.priority,category:t.category,tags:[...(t.tags||[])],due:nd.toISOString().slice(0,10),recurring:t.recurring,subtasks:(t.subtasks||[]).map(s=>({text:s.text,done:false})),progress:0,estimated_hours:t.estimated_hours||0,logged_hours:0,link:t.link||'',createdAt:Date.now(),updatedAt:Date.now(),completedAt:null,sortOrder:tasks.length,project:t.project||'',assignee:t.assignee||currentUser||'',dependencies:[],eisenhower:t.eisenhower||'',milestone:t.milestone||false,reminder:'',comments:[],smartScore:0,myDay:'',myDaySlot:'morning'});
        t.recurring='';added=true;
      }
    }
  });
  if(added){saveTasks(tasks);refreshAll();}
}

/* ═══════ EXPORT / IMPORT ═══════ */
function exportCSV(){
  const tasks=loadTasks();
  let csv='ID,Title,Status,Priority,Category,Due,Tags,Owner,Created,Updated\n';
  tasks.forEach(t=>{csv+=(t.numId||'')+',"'+t.title.replaceAll('"','""')+'",'+t.status+','+t.priority+',"'+(t.category||'')+'","'+(t.due||'')+'","'+(t.tags||[]).join(';')+'","'+(t.assignee||'')+'",'+new Date(t.createdAt).toISOString()+','+(t.updatedAt?new Date(t.updatedAt).toISOString():'')+'\n';});
  downloadFile('tasks.csv',csv,'text/csv');
}
function exportJSON(){downloadFile('tasks.json',JSON.stringify({tasks:loadTasks(),projects:loadProjects(),goals:loadGoals(),habits:loadHabits(),notes:loadNotes()},null,2),'application/json');}
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('Excel library not loaded','error');return;}
  const users=JSON.parse(localStorage.getItem('taskflow_users')||'[]');
  if(!users.length){toast('No users found','error');return;}
  const wb=XLSX.utils.book_new();
  const usedNames={};
  users.forEach(email=>{
    const key='taskflow_tasks_'+email;
    let tasks=[];
    try{tasks=JSON.parse(localStorage.getItem(key))||[];}catch{/* ignore parse errors */}
    let maxId=0;tasks.forEach(t=>{if(t.numId&&t.numId>maxId)maxId=t.numId;});
    tasks.forEach(t=>{if(!t.numId){maxId++;t.numId=maxId;}});
    tasks.sort((a,b)=>(a.numId||0)-(b.numId||0));
    const sheetData=tasks.map(t=>({
      'ID':t.numId||'','Title':t.title||'','Status':t.status||'','Priority':t.priority||'',
      'Category':t.category||'','Due Date':t.due||'','Tags':(t.tags||[]).join(', '),
      'Owner':t.assignee||'',
      'Progress':(t.progress||0)+'%','Est. Hours':t.estimated_hours||0,'Logged Hours':t.logged_hours||0,
      'Created':t.createdAt?new Date(t.createdAt).toLocaleDateString():'',
      'Completed':t.completedAt?new Date(t.completedAt).toLocaleDateString():'',
      'Description':t.description||'','Note':t.note||''
    }));
    let sheetName=email.split('@')[0].replaceAll(/[\\/*?[\]]/g,'').slice(0,31);
    if(usedNames[sheetName]){let c=2;while(usedNames[sheetName+c]){c++;}sheetName=sheetName+c;}
    usedNames[sheetName]=true;
    const ws=XLSX.utils.json_to_sheet(sheetData.length?sheetData:[{'Info':'No tasks for this user'}]);
    XLSX.utils.book_append_sheet(wb,ws,sheetName);
  });
  XLSX.writeFile(wb,'TaskFlow_Export.xlsx');
  toast('Excel exported with '+users.length+' user sheet(s)');
}
function downloadFile(name,content,type){
  const blob=new Blob([content],{type:type});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href);
}
function importJSON(event){
  let file;
  if(event&&event.target&&event.target.files&&event.target.files[0]){file=event.target.files[0];}
  else{const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=e=>{importJSON(e);};input.click();return;}
  file.text().then(text=>{
    try{
      const data=JSON.parse(text);
      const clean=validateBackup(data);
      pendingImport=clean;
      const summary=[
        ['Tasks',clean.tasks],
        ['Projects',clean.projects],
        ['Goals',clean.goals],
        ['Habits',clean.habits],
        ['Notes',clean.notes]
      ].map(([label,list])=>'<div class="sync-row"><span>'+label+'</span><strong>'+(list?list.length:'unchanged')+'</strong></div>').join('');
      document.getElementById('importPreviewSummary').innerHTML=summary;
      document.getElementById('importPreviewModal').classList.add('active');
    }catch(err){toast('Invalid JSON: '+err.message);}
  });
  if(event&&event.target)event.target.value='';
}
function closeImportPreview(){
  pendingImport=null;
  const modal=document.getElementById('importPreviewModal');
  if(modal) modal.classList.remove('active');
}
function confirmImportPreview(){
  if(!pendingImport) return;
  if(pendingImport.tasks){saveTasks(pendingImport.tasks);toast('Tasks imported ('+pendingImport.tasks.length+')');}
  if(pendingImport.projects){saveProjects(pendingImport.projects);}
  if(pendingImport.goals){saveGoals(pendingImport.goals);}
  if(pendingImport.habits){saveHabits(pendingImport.habits);}
  if(pendingImport.notes){saveNotes(pendingImport.notes);}
  ensureNumIds();
  closeImportPreview();
  refreshAll();
}

/* ═══════ SETTINGS ═══════ */
function openSettings(){document.getElementById('settingsModal').classList.add('active');
  document.getElementById('pomoWorkMin').value=Math.floor(pomoWorkSec/60);
  document.getElementById('pomoBreakMin').value=Math.floor(pomoBreakSec/60);
  refreshSettingsStatus();
}
function closeSettings(){
  document.getElementById('settingsModal').classList.remove('active');
  const w=Number.parseInt(document.getElementById('pomoWorkMin').value)||25;
  const b=Number.parseInt(document.getElementById('pomoBreakMin').value)||5;
  pomoWorkSec=w*60;pomoBreakSec=b*60;savePomodoroSettings();
}
function editSheetUrl(){
  const url=prompt('Google Apps Script URL:',APPS_SCRIPT_URL);
  if(url!==null) {
    APPS_SCRIPT_URL=url.trim();
    if(APPS_SCRIPT_URL) localStorage.setItem('taskflow_script_url', APPS_SCRIPT_URL);
    else localStorage.removeItem('taskflow_script_url');
    refreshSettingsStatus();
  }
}
function getSyncToken(){
  return localStorage.getItem(userKey('taskflow_sync_token')) || '';
}
function requireSyncConfig(){
  if(!APPS_SCRIPT_URL){toast('Set Apps Script URL first','error');return null;}
  const token=getSyncToken();
  if(!token){toast('Set Sync Token first','error');return null;}
  return token;
}
function editSyncToken(){
  const token=prompt('Sync token from Apps Script Properties:', getSyncToken());
  if(token!==null){
    const clean=token.trim();
    if(clean) localStorage.setItem(userKey('taskflow_sync_token'), clean);
    else localStorage.removeItem(userKey('taskflow_sync_token'));
    refreshSettingsStatus();
  }
}
function refreshSettingsStatus(){
  const urlEl=document.getElementById('scriptUrlStatus');
  const tokenEl=document.getElementById('syncTokenStatus');
  const syncEl=document.getElementById('syncStateLabel');
  if(urlEl) urlEl.textContent=APPS_SCRIPT_URL ? 'Configured' : 'Not configured';
  if(tokenEl) tokenEl.textContent=getSyncToken() ? 'Configured for this account' : 'Required for Google Sheets sync';
  if(syncEl) syncEl.textContent=getSyncStatusText();
}
function getLastSyncAt(){return Number(localStorage.getItem(userKey('taskflow_last_sync_at')))||0;}
function setLastSyncAt(ts=Date.now()){localStorage.setItem(userKey('taskflow_last_sync_at'),String(ts));refreshSettingsStatus();}
function getSyncStatusText(){
  const ts=getLastSyncAt();
  if(!APPS_SCRIPT_URL||!getSyncToken()) return 'Not configured';
  return ts ? 'Last synced '+fmtRelative(ts) : 'Ready, not synced yet';
}
function clearAllData(){
  if(!confirm('Delete ALL data for this account? This cannot be undone!')) return;
  const keys=Object.keys(localStorage).filter(k=>k.endsWith('_'+currentUser));
  keys.forEach(k=>localStorage.removeItem(k));
  toast('All data cleared');refreshAll();
}

/* ═══════ ONBOARDING ═══════ */
const onboardSteps=[
  {title:'Welcome to TaskFlow Pro!',desc:'Your all-in-one task management workspace. Let\'s take a quick tour.',target:null},
  {title:'Quick Add Tasks',desc:'Press Q anywhere to quickly create a task. Use !high, @category, #tag, ~project syntax.',target:null},
  {title:'Dashboard',desc:'Your overview with stats, charts, activity heatmap, goals, and habits.',target:'[data-page="dashboard"]'},
  {title:'My Day',desc:'Plan your day with time-blocked tasks and daily notes.',target:'[data-page="myday"]'},
  {title:'Kanban Board',desc:'Drag tasks between columns to update status.',target:'[data-page="kanban"]'},
  {title:'Projects & Goals',desc:'Organize tasks into projects and track weekly/monthly goals.',target:'[data-page="projects"]'},
  {title:'Pomodoro Timer',desc:'Boost focus with work/break cycles. Click the timer icon on any task.',target:null},
  {title:'All Set!',desc:'You\'re ready to be productive. Press Escape to dismiss any overlay.',target:null}
];
function checkOnboarding(){if(!localStorage.getItem(userKey('onboarded'))){document.getElementById('onboardOverlay').classList.add('active');showOnboardStep(0);}}
function showOnboardStep(i){
  onboardIdx=i;
  if(i>=onboardSteps.length){skipOnboarding();return;}
  const s=onboardSteps[i];
  document.getElementById('onboardTitle').textContent=s.title;
  document.getElementById('onboardDesc').textContent=s.desc;
  document.getElementById('onboardProgress').textContent='Step '+(i+1)+' of '+onboardSteps.length;
}
function nextOnboardStep(){showOnboardStep(onboardIdx+1);}
function skipOnboarding(){document.getElementById('onboardOverlay').classList.remove('active');localStorage.setItem(userKey('onboarded'),'1');}
let onboardIdx=0;

/* ═══════ KEYBOARD SHORTCUTS ═══════ */
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT') return;
  if(e.key==='q'||e.key==='Q'){e.preventDefault();openQuickAdd();}
  if(e.key==='/'){e.preventDefault();const s=document.getElementById('searchInput');if(s)s.focus();}
  if(e.key==='Escape'){closeQuickAdd();closePomodoro();closeSearch();closeSettings();closeTemplates();closeFiltersModal();closeProjectModal();closeGoalModal();closeHabitModal();closeNoteEditor();closeImportPreview();closeModal();}
  if(e.altKey&&e.key==='n'){e.preventDefault();openModal();}
});

/* ═══════ MODAL BACKDROP CLICKS ═══════ */
['taskModal','settingsModal','templatesModal','filtersModal','projectModal','goalModal','habitModal','noteEditorModal','eventModal','confirmModal','importPreviewModal'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('click',e=>{if(e.target===el) el.classList.remove('active');});
});
['quickAddOverlay','focusOverlay','onboardOverlay'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('click',e=>{if(e.target===el) el.classList.remove('active');});
});
function initAccessibility(){
  document.querySelectorAll('.modal-overlay,.quick-add-overlay,.focus-overlay,.onboard-overlay').forEach(el=>{
    el.setAttribute('role','dialog');
    el.setAttribute('aria-modal','true');
  });
  document.querySelectorAll('button').forEach(btn=>{
    if(!btn.getAttribute('aria-label')){
      const label=(btn.textContent||btn.title||'').trim();
      if(label) btn.setAttribute('aria-label',label);
      else if(btn.title) btn.setAttribute('aria-label',btn.title);
    }
  });
}
document.addEventListener('focusin',e=>{
  const modal=[...document.querySelectorAll('.modal-overlay.active,.quick-add-overlay.active,.focus-overlay.active,.onboard-overlay.active')].pop();
  if(modal&&!modal.contains(e.target)){
    const target=modal.querySelector('button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
    if(target) target.focus();
  }
});

/* ═══════ REFRESH ALL ═══════ */
function refreshAll(){
  const map={dashboard:renderDashboard,tasks:renderTasks,kanban:renderKanban,calendar:renderCalendar,analytics:renderAnalytics,myday:renderMyDay,projects:renderProjects,eisenhower:renderEisenhower,goals:renderGoals,habits:renderHabits,notes:renderNotes,reports:renderReports,archive:renderArchive};
  const fn=map[currentPage];if(fn)fn();
  renderCategoryNav();populateProjectFilter();processRecurring();
  updateBulkBar();
  document.getElementById('notifDot').style.display=loadTasks().some(isOverdue)?'block':'none';
  document.getElementById('taskBadge').textContent=loadTasks().filter(t=>t.status!=='done').length;
}

/* ═══════ GOOGLE SHEETS SYNC ═══════ */
const SHEET_HEADERS=['ID','Title','Status','Priority','Category','Due Date','Tags','Progress','Est. Hours','Logged Hours','Created','Completed','Description','Note','Owner','Updated'];
function taskToSheetRow(t){return{id:t.id,numId:t.numId||'',title:t.title,status:t.status,priority:t.priority,category:t.category||'',due:t.due||'',tags:(t.tags||[]).join(','),created:new Date(t.createdAt).toISOString(),project:t.project||'',milestone:t.milestone?'yes':'no',assignee:t.assignee||'',updatedAt:t.updatedAt||Date.now()};}
function taskToSheetArray(t){
  return[
    t.numId||'',t.title||'',t.status||'',t.priority||'',
    t.category||'',t.due||'',(t.tags||[]).join(', '),
    (t.progress||0)+'%',t.estimated_hours||0,t.logged_hours||0,
    t.createdAt?new Date(t.createdAt).toLocaleDateString():'',
    t.completedAt?new Date(t.completedAt).toLocaleDateString():'',
    t.description||'',t.note||'',t.assignee||'',t.updatedAt?new Date(t.updatedAt).toISOString():''
  ];
}
function sheetRowToTask(r){return{id:r.id,numId:r.numId||0,title:r.title,description:'',status:r.status,priority:r.priority,category:r.category||'',due:r.due||'',tags:(r.tags||'').split(',').filter(Boolean),recurring:'',subtasks:[],progress:r.status==='done'?100:0,estimated_hours:0,logged_hours:0,link:'',createdAt:new Date(r.created).getTime()||Date.now(),updatedAt:new Date(r.updatedAt||r.updated||r['Updated']).getTime()||Date.now(),completedAt:r.status==='done'?Date.now():null,sortOrder:0,project:r.project||'',assignee:r.assignee||r.owner||r['Owner']||'',dependencies:[],eisenhower:'',milestone:r.milestone==='yes',reminder:'',comments:[],smartScore:0,myDay:'',myDaySlot:'morning'};}
function sheetPost(data){
  if(!APPS_SCRIPT_URL) return;
  const token=getSyncToken();
  if(!token) return;
  data.user=currentUser;
  data.authToken=token;
  fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify(data),headers:{'Content-Type':'text/plain'}})
    .then(r=>r.json()).then(res=>{if(res.status&&res.status!=='ok') toast('Sync failed: '+(res.message||res.status),'error'); else setLastSyncAt();})
    .catch(()=>{toast('Sync failed','error');});
}
function testSyncConnection(){
  const token=requireSyncConfig();
  if(!token) return;
  const label=document.getElementById('syncStateLabel');
  if(label) label.textContent='Testing connection...';
  fetch(APPS_SCRIPT_URL+'?action=PING&user='+encodeURIComponent(currentUser)+'&authToken='+encodeURIComponent(token))
    .then(r=>r.json()).then(data=>{
      if(data.status==='ok'){toast('Sync connection ready');setLastSyncAt(Date.now());}
      else{toast('Sync test failed: '+(data.message||'error'),'error');refreshSettingsStatus();}
    }).catch(()=>{toast('Sync test failed','error');refreshSettingsStatus();});
}
function syncPushAll(){
  if(!requireSyncConfig()) return;
  const tasks=loadTasks();
  tasks.sort((a,b)=>(a.numId||0)-(b.numId||0));
  const rows=[SHEET_HEADERS,...tasks.map(taskToSheetArray)];
  sheetPost({action:'SYNC_PUSH',sheetName:currentUser.split('@')[0],rows:rows,tasks:tasks.map(taskToSheetRow)});
  toast('Syncing to Google Sheets...');
}
function syncAllUsersToSheet(){
  const token=requireSyncConfig();
  if(!token) return;
  const users=JSON.parse(localStorage.getItem('taskflow_users')||'[]');
  if(!users.length){toast('No users found','error');return;}
  const allSheets={};
  users.forEach(email=>{
    const key='taskflow_tasks_'+email;
    let tasks=[];
    try{tasks=JSON.parse(localStorage.getItem(key))||[];}catch{/* skip */}
    let maxId=0;tasks.forEach(t=>{if(t.numId&&t.numId>maxId)maxId=t.numId;});
    tasks.forEach(t=>{if(!t.numId){maxId++;t.numId=maxId;}});
    tasks.sort((a,b)=>(a.numId||0)-(b.numId||0));
    const sheetName=email.split('@')[0].replaceAll(/[\\/*?[\]]/g,'').slice(0,31);
    allSheets[sheetName]=[SHEET_HEADERS,...tasks.map(taskToSheetArray)];
  });
  fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'SYNC_ALL_USERS',user:currentUser,authToken:token,sheets:allSheets}),headers:{'Content-Type':'text/plain'}})
    .then(r=>r.json()).then(res=>{if(res.status&&res.status!=='ok') toast('Sync failed: '+(res.message||res.status),'error'); else setLastSyncAt();})
    .catch(()=>{toast('Sync failed','error');});
  toast('Syncing all users to Google Sheets...');
}
function syncPullAll(){
  const token=requireSyncConfig();
  if(!token) return;
  const last=getLastSyncAt();
  if(last && loadTasks().some(t=>(t.updatedAt||t.createdAt||0)>last) && !confirm('Local tasks changed since last sync. Pulling will replace them. Continue?')) return;
  fetch(APPS_SCRIPT_URL+'?action=SYNC_PULL&user='+encodeURIComponent(currentUser)+'&authToken='+encodeURIComponent(token))
    .then(r=>r.json()).then(data=>{
      if(data.status==='error'){toast('Sync failed: '+(data.message||'error'),'error');return;}
      if(data.tasks&&Array.isArray(data.tasks)){
        const pulled=data.tasks.map(sheetRowToTask).map(normalizeTask);
        saveTasks(pulled);setLastSyncAt();refreshAll();toast('Pulled '+pulled.length+' tasks');
      }
    }).catch(()=>{toast('Sync failed');});
}

/* ═══════ OVERDUE NOTIFICATION ═══════ */
function showOverdueTasks(){
  const overdue=loadTasks().filter(isOverdue);
  if(overdue.length) toast(overdue.length+' overdue task'+(overdue.length>1?'s':'')+'!');
}

/* ═══════ INIT ═══════ */
initAccessibility();
checkAutoLogin();

/* ═══════ SERVICE WORKER & PWA ═══════ */
if ('serviceWorker' in navigator && ['http:','https:'].includes(location.protocol)) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

let deferredInstallPrompt = null;
globalThis.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'inline-flex';
});
globalThis.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'none';
  toast('App installed successfully!');
});
function installApp() {
  if (!deferredInstallPrompt) { toast('Open in browser to install'); return; }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') toast('Installing...');
    deferredInstallPrompt = null;
  });
}
