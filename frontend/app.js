/* ═══════ CONFIG ═══════ */
const ADMIN_EMAIL = 'osama.kamal@gmail.com';
const DEFAULT_SCRIPT_URL = '';
let APPS_SCRIPT_URL = localStorage.getItem('taskflow_script_url') || DEFAULT_SCRIPT_URL;
const DEFAULT_API_URL = globalThis.TASKFLOW_CONFIG?.apiBaseUrl || 'http://localhost:5299';
let API_BASE_URL = localStorage.getItem('taskflow_api_url') ?? DEFAULT_API_URL;
let authMode = 'login';

/* ═══════ ACCOUNT DATABASE (real per-account persistence, server-of-record) ═══════ */
function apiConfigured(){ return !!API_BASE_URL; }
function authKey(email){ return 'taskflow_auth_'+(email||currentUser); }
function saveAuthSession(email,r){ localStorage.setItem(authKey(email),JSON.stringify({accessToken:r.accessToken,refreshToken:r.refreshToken,expiresAt:r.expiresAt,organizationId:r.organizationId})); }
function getAuthSession(email){ try{ return JSON.parse(localStorage.getItem(authKey(email))); }catch{ return null; } }
function clearAuthSession(email){ localStorage.removeItem(authKey(email)); }
// Capture identity at request start; never attach a new account to an old request.
const refreshFlights = new Map();
async function refreshAccessToken(user, rejectedToken){
  const run=async()=>{
    const session=getAuthSession(user);
    if(!session) throw new Error(tr("Please sign in again"));
    if(rejectedToken && session.accessToken!==rejectedToken) return session.accessToken;
    try{
      const result=await apiRaw('/api/auth/refresh','POST',{refreshToken:session.refreshToken},false,user);
      if(getAuthSession(user)?.refreshToken!==session.refreshToken) throw new Error(tr("Session changed"));
      saveAuthSession(user,result);
      return result.accessToken;
    }catch(error){
      if(error.status===401 && getAuthSession(user)?.refreshToken===session.refreshToken) clearAuthSession(user);
      throw error;
    }
  };
  if(!refreshFlights.has(user)){
    const promise=(navigator.locks ? navigator.locks.request('taskflow-refresh-'+API_BASE_URL+'-'+user,run) : run())
      .finally(()=>refreshFlights.delete(user));
    refreshFlights.set(user,promise);
  }
  return refreshFlights.get(user);
}
async function apiRaw(path, method, body, needsAuth=true, user=currentUser){
  if(!apiConfigured()){ const err=new Error(tr("API not configured")); err.isNetworkError=true; throw err; }
  const base=API_BASE_URL;
  const opts={method, headers:{'Content-Type':'application/json'}};
  if(needsAuth) opts.headers.Authorization='Bearer '+(await ensureFreshToken(user));
  if(body!==undefined) opts.body=JSON.stringify(body);
  const send=async()=>{
    if(needsAuth && (currentUser!==user || API_BASE_URL!==base)) throw new Error(tr("Account changed"));
    try{return await fetch(base+path,opts);}catch{const err=new Error(tr("Cannot reach the account database"));err.isNetworkError=true;throw err;}
  };
  let res=await send();
  if(res.status===401&&needsAuth){
    opts.headers.Authorization='Bearer '+await refreshAccessToken(user,opts.headers.Authorization.slice(7));
    res=await send(); // Exactly one retry.
  }
  if(!res.ok){
    let msg=tr("Request failed (")+res.status+')';
    try{ const j=await res.json(); if(j?.error) msg=j.error; }catch{}
    const err=new Error(localizedApiError(msg,res.status)); err.status=res.status; throw err;
  }
  return res.status===204 ? null : res.json();
}
async function ensureFreshToken(user=currentUser){
  const s=getAuthSession(user);
  if(!s) throw new Error(tr("Not signed in to the account database"));
  if(new Date(s.expiresAt).getTime()-Date.now()>60000) return s.accessToken;
  return refreshAccessToken(user,s.accessToken);
}
function apiRegister(username,password){ return apiRaw('/api/auth/register','POST',{username,password,organizationName:username+"'s Workspace"},false); }
function apiLogin(username,password){ return apiRaw('/api/auth/login','POST',{username,password},false); }
function ownsDataKey(key,user=currentUser){
  if(!user||!key.endsWith('_'+user))return false;
  const base=key.slice(0,-user.length-1);
  return /^(taskflow_(tasks|activity|archive|templates|filters|projects|goals|habits|notes|events|timetable_blocks|workhours|challenges|badges_seen)|pomoWork|pomoBreak|pomoSessions|onboarded)$/.test(base)||/^(dailyNote_|taskflow_timelog_)\d{4}-\d{2}-\d{2}$/.test(base);
}
function pendingSyncKey(user=currentUser){ return 'taskflow_pending_sync_'+user; }
function getPendingSync(user=currentUser){
  let pending={},legacy={};
  try{pending=JSON.parse(localStorage.getItem(pendingSyncKey(user)))||{};}catch{}
  try{legacy=JSON.parse(localStorage.getItem('taskflow_pending_sync'))||{};}catch{}
  const migrating=Object.keys(legacy).filter(key=>ownsDataKey(key,user));
  for(const key of migrating)if(!(key in pending))pending[key]=legacy[key];
  if(migrating.length){
    try{
      setPendingSync(pending,user);
      for(const key of migrating)delete legacy[key];
      localStorage.setItem('taskflow_pending_sync',JSON.stringify(legacy));
    }catch{} // Preserve the original legacy copy if browser storage is full.
  }
  return pending;
}
function persistData(key,value){
  const previous=localStorage.getItem(key);
  try{
    localStorage.setItem(key,value);
    if(currentUser&&ownsDataKey(key)){
      const pending=getPendingSync();pending[key]=value;setPendingSync(pending);
    }
  }catch(error){
    if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous);
    toast(tr("Browser storage is full or unavailable. Export a backup and free space before saving."),'error');
    throw error;
  }
  updateSyncStatusUI();flushSyncQueue();
}
function setPendingSync(map,user=currentUser){ localStorage.setItem(pendingSyncKey(user), JSON.stringify(map)); }
function getSyncVersions(user=currentUser){try{return JSON.parse(localStorage.getItem('taskflow_sync_versions_'+user))||{};}catch{return {};}}
function setSyncVersion(key,version,user){const versions=getSyncVersions(user);versions[key]=version;localStorage.setItem('taskflow_sync_versions_'+user,JSON.stringify(versions));}
let syncInFlight=false;
let hydrationInFlight=false;
function syncKey(key){
  if(!currentUser||!ownsDataKey(key)) return;
  const value=localStorage.getItem(key);
  if(value===null) return;
  const pending=getPendingSync(); pending[key]=value; setPendingSync(pending);
  updateSyncStatusUI();
  flushSyncQueue();
}
async function flushSyncQueue(){
  updateSyncStatusUI();
  if(syncInFlight||hydrationInFlight||!apiConfigured()||!currentUser||!getAuthSession(currentUser)) return;
  const user=currentUser;
  syncInFlight=true; updateSyncStatusUI();
  try{
    const snapshot=getPendingSync(user);
    for(const key of Object.keys(snapshot)){
      if(currentUser!==user) break;
      if(!ownsDataKey(key,user)) continue;
      try{
        const deleting=snapshot[key]===null;
        const result=await apiRaw('/api/data/'+encodeURIComponent(key),deleting?'DELETE':'PUT',deleting?undefined:{
          value:snapshot[key],expectedUpdatedAt:getSyncVersions(user)[key]||null,requireVersion:true
        },true,user);
        setSyncVersion(key,result?.updatedAt||null,user);
        const pending=getPendingSync(user);
        // An edit made during this PUT must remain queued.
        if(pending[key]===snapshot[key]) delete pending[key];
        setPendingSync(pending,user);
      }catch(e){
        if(e.status===409 && currentUser===user) toast(tr("Sync conflict: local changes retained. Export a backup before resolving with the other device."),'error');
        break; // Keep every failed write, including 401/429/500, for a later retry.
      }
    }
  } finally { syncInFlight=false; updateSyncStatusUI(); }
}
async function hydrateFromServer(){
  const user=currentUser;
  hydrationInFlight=true;
  try{
    const items=await apiRaw('/api/data','GET',undefined,true,user);
    if(currentUser!==user) return;
    const pending=getPendingSync(user);
    for(const it of items){
      if(!ownsDataKey(it.key,user)) continue;
      if(pending[it.key]===it.value){delete pending[it.key];setPendingSync(pending,user);}
      if(!(it.key in pending)){
        localStorage.setItem(it.key,it.value);
        setSyncVersion(it.key,it.updatedAt,user);
      }
    }
  }finally{hydrationInFlight=false;}
  if(currentUser===user) await flushSyncQueue();
}
async function resolveSyncConflicts(){
  const user=currentUser;
  if(!user||syncInFlight||hydrationInFlight){toast(tr("Wait for synchronization to finish"));return;}
  try{
    const items=await apiRaw('/api/data','GET');
    if(user!==currentUser)return;
    const pending=getPendingSync(user);
    if(!Object.keys(pending).length){toast(tr("No queued changes"));return;}
    downloadFile('taskflow-conflict-backup.json',JSON.stringify({local:pending,server:items},null,2),'application/json');
    const choice=prompt(tr("Both versions have been downloaded as a backup. Type LOCAL to keep this device?s queued changes, or SERVER to replace those sections with the server copy. Cancel leaves everything unchanged."));
    if(!['LOCAL','SERVER'].includes(choice?.trim().toUpperCase()))return;
    const queue=getPendingSync(user);
    for(const key of Object.keys(pending)){
      if(queue[key]!==pending[key])continue;
      const server=items.find(item=>item.key===key);
      setSyncVersion(key,server?.updatedAt||null,user);
      if(choice.trim().toUpperCase()==='SERVER'){
        if(server)localStorage.setItem(key,server.value);else localStorage.removeItem(key);
        delete queue[key];
      }
    }
    setPendingSync(queue,user);refreshAll();await flushSyncQueue();
  }catch(error){toast(error.message,'error');}
}
function updateSyncStatusUI(){
  const btn=document.getElementById('syncStatusBtn'), settingRow=document.getElementById('syncNowSetting');
  const active=apiConfigured()&&!!getAuthSession(currentUser);
  setSyncControlsVisibility(active,btn,settingRow);
  if(!active) return;
  const pendingCount=Object.keys(getPendingSync()).length;
  const dot=document.getElementById('syncPendingDot');
  const icon=document.getElementById('syncStatusIcon');
  const desc=document.getElementById('syncPendingStatus');
  const status=getSyncStatus(pendingCount,!navigator.onLine);
  if(btn) btn.title=status.title;
  if(icon) icon.style.color=status.color;
  if(dot) dot.style.display=(pendingCount||status.offline)?'block':'none';
  if(desc) desc.textContent=status.description;
}
function setSyncControlsVisibility(active,btn,settingRow){
  if(btn) btn.style.display=active?'flex':'none';
  if(settingRow) settingRow.style.display=active?'flex':'none';
}
function getSyncStatus(pendingCount,offline){
  if(offline){
    return {title:tr("Offline")+(pendingCount?' — '+pendingCount+tr(" change(s) waiting to sync"):''),description:tr("Offline")+(pendingCount?' — '+pendingCount+tr(" change(s) queued"):tr(" — will sync when back online")),color:'var(--text3)',offline:true};
  }
  if(syncInFlight) return {title:tr("Syncing..."),description:tr("Syncing..."),color:'var(--primary)',offline:false};
  if(pendingCount){
    const message=pendingCount+tr(" change(s) waiting to sync");
    return {title:message,description:message,color:'var(--warning)',offline:false};
  }
  return {title:tr("Up to date"),description:tr("Up to date"),color:'var(--success)',offline:false};
}
function editApiUrl(){
  const url=prompt(tr("Account Database (API) URL:"),API_BASE_URL);
  if(url===null) return;
  const candidate=url.trim();
  try{const parsed=new URL(candidate);if(!['http:','https:'].includes(parsed.protocol))throw new Error();}catch{toast(tr("Enter a valid HTTP or HTTPS API URL"),'error');return;}
  if(currentUser)doLogout();
  API_BASE_URL=candidate;
  while(API_BASE_URL.endsWith('/')) API_BASE_URL=API_BASE_URL.slice(0,-1);
  if(API_BASE_URL) localStorage.setItem('taskflow_api_url',API_BASE_URL);
  else localStorage.removeItem('taskflow_api_url');
  refreshSettingsStatus();
  toast(tr("Account database URL updated — log out and back in to switch accounts to it"));
}
let syncHeartbeat=null;
function startSyncHeartbeat(){
  updateSyncStatusUI();
  if(syncHeartbeat) return;
  syncHeartbeat=setInterval(flushSyncQueue,30000);
  window.addEventListener('online',()=>{ updateSyncStatusUI(); flushSyncQueue(); });
  window.addEventListener('offline',updateSyncStatusUI);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') flushSyncQueue(); });
}
function pushAllLocalDataToServer(){
  const keys=Object.keys(localStorage).filter(k=>ownsDataKey(k));
  keys.forEach(k=>syncKey(k));
  return flushSyncQueue();
}
function testApiConnection(){
  const el=document.getElementById('apiUrlStatus');
  if(!apiConfigured()){ toast(tr("Set an Account Database URL first"),'error'); return; }
  if(el) el.textContent=tr("Testing...");
  fetch(API_BASE_URL+'/health/ready').then(r=>{
    if(r.ok){ toast(tr("Account database reachable")); if(el) el.textContent=tr("Configured — reachable"); }
    else { toast(tr("Account database not ready"),'error'); if(el) el.textContent=tr("Configured — not ready"); }
  }).catch(()=>{ toast(tr("Cannot reach account database"),'error'); if(el) el.textContent=tr("Configured — unreachable"); });
}

/* ═══════ i18n ═══════ */
const i18n = {
  "en": {
    "backup_section_limit": "{section} must be an array with at most {limit} records",
    "backup_invalid_record": "Invalid record in {section}",
    "backup_invalid_id": "Invalid or duplicate ID in {section}",
    "backup_invalid_json": "The file is not valid JSON. Choose a TaskFlow backup file.",
    "backup_read_failed": "Could not read the backup file. Please try again.",
    "dashboard": "Dashboard",
    "my_day": "My Day",
    "all_tasks": "All Tasks",
    "kanban": "Kanban Board",
    "calendar": "Calendar",
    "timetable": "Timetable",
    "matrix": "Eisenhower Matrix",
    "projects": "Projects",
    "goals": "Goals",
    "habits": "Habits",
    "notes": "Notes",
    "analytics": "Analytics & Insights",
    "time_reports": "Time Reports",
    "life_balance": "Life Balance",
    "progress": "Progress",
    "archive": "Archive",
    "pomodoro": "Pomodoro Timer",
    "templates": "Templates",
    "settings": "Settings",
    "new_task": "New Task",
    "nav_main": "Main",
    "nav_plan": "Planning",
    "nav_analytics": "Analytics",
    "nav_categories": "Categories",
    "nav_quick": "Quick",
    "weekly_overview": "Weekly Overview",
    "priority_dist": "Priority Distribution",
    "upcoming": "Upcoming Deadlines",
    "goal_progress": "Goal Progress",
    "habit_streaks": "Habit Streaks",
    "recent_activity": "Recent Activity",
    "daily_notes": "Daily Notes",
    "heatmap_title": "Productivity Heatmap",
    "heatmap_subtitle": "Last 16 weeks",
    "done_label": "done",
    "greet_morning": "Good morning",
    "greet_afternoon": "Good afternoon",
    "greet_evening": "Good evening",
    "filter_all_dates": "All Dates",
    "filter_today": "Today",
    "filter_this_week": "This Week",
    "filter_this_month": "This Month",
    "filter_all_projects": "All Projects",
    "filter_all_owners": "All Owners",
    "filter_all": "All",
    "login_tagline": "Team Task Monitoring System",
    "ph_username": "Username",
    "ph_password": "Password (min 6 characters)",
    "sign_in": "Sign In",
    "create_account": "Create Account",
    "new_here": "New here?",
    "have_account": "Already have an account?",
    "switch_to_create": "Create an account",
    "switch_to_signin": "Sign in",
    "login_footer": "Powered by TaskFlow Pro - Team Edition",
    "please_wait": "Please wait...",
    "member": "Member",
    "admin": "Admin",
    "logged_in_as": "Logged in as",
    "logout": "Logout",
    "title_sync_status": "Sync status",
    "title_toggle_theme": "Toggle theme",
    "title_overdue_tasks": "Overdue tasks",
    "title_language": "Language / RTL",
    "title_install_app": "Install App",
    "ph_search_tasks": "Search tasks...",
    "ph_daily_notes": "Write your notes for today...",
    "filter_all_status": "All Status",
    "status_todo": "To Do",
    "status_inprogress": "In Progress",
    "status_done": "Done",
    "filter_all_priorities": "All Priorities",
    "priority_high": "High",
    "priority_medium": "Medium",
    "priority_low": "Low",
    "filter_all_categories": "All Categories",
    "sort_newest": "Newest",
    "sort_oldest": "Oldest",
    "sort_due_soon": "Due Soon",
    "sort_priority": "Priority",
    "sort_smart_score": "Smart Score",
    "sort_az": "A-Z",
    "title_saved_filters": "Saved filters",
    "bulk_mark_done": "Mark Done",
    "bulk_mark_todo": "Mark To Do",
    "action_archive": "Archive",
    "action_delete": "Delete",
    "action_cancel": "Cancel",
    "kanban_subtitle": "Drag and drop tasks between columns to update status",
    "title_prev_month": "Previous month",
    "title_next_month": "Next month",
    "today_label": "Today",
    "new_event": "New Event",
    "timetable_subtitle": "Tasks are auto-scheduled into free hours",
    "title_prev_day": "Previous day",
    "title_next_day": "Next day",
    "label_from": "From",
    "label_to": "To",
    "tt_not_scheduled": "Not Scheduled Today",
    "tt_add_block": "Add time block",
    "modal_new_time_block": "New time block",
    "modal_edit_time_block": "Edit time block",
    "tt_block_title": "What will you work on?",
    "tt_block_saved": "Time block saved",
    "tt_block_deleted": "Time block deleted",
    "tt_time_error": "Choose an end time after the start time",
    "tt_manual_block": "Fixed time block",
    "tt_progress": "Completed",
    "tt_mark_done": "Mark time block complete",
    "tt_mark_undone": "Reopen time block",
    "eisenhower_subtitle": "Prioritize tasks by urgency and importance",
    "eh_do_first": "Do First",
    "eh_schedule": "Schedule",
    "eh_delegate": "Delegate",
    "eh_eliminate": "Eliminate",
    "new_project": "+ New Project",
    "new_goal": "+ New Goal",
    "new_habit": "+ New Habit",
    "new_note": "+ New Note",
    "goal_weekly": "Weekly",
    "goal_monthly": "Monthly",
    "ph_search_notes": "Search notes...",
    "gantt_timeline": "Gantt Timeline",
    "lb_subtitle": "Log how you actually spend your day",
    "lb_log_hours": "Log Today's Hours",
    "lb_category_breakdown": "Category Breakdown",
    "lb_weekly_check": "Weekly Work-Hours Check",
    "lb_show_sources": "Show Methodology & Sources",
    "lb_hide_sources": "Hide Methodology & Sources",
    "progress_subtitle": "Auto-calculated from your activity",
    "new_challenge": "+ New Challenge",
    "progress_activity_chart": "Activity Score",
    "progress_tasks_chart": "Tasks Completed",
    "progress_habit_consistency": "Habit Consistency",
    "your_challenges": "Your Challenges",
    "beat_your_record": "Beat Your Record",
    "beat_record_subtitle": "Suggested challenges based on your record.",
    "clear_archive": "Clear Archive",
    "modal_new_task": "New Task",
    "modal_edit_task": "Edit Task",
    "btn_save_changes": "Save Changes",
    "field_title": "Title *",
    "ph_task_title": "What needs to be done?",
    "field_description": "Description",
    "ph_add_details": "Add details...",
    "field_priority": "Priority",
    "field_category": "Category",
    "ph_category_example": "e.g. Work",
    "field_project": "Project",
    "option_no_project": "No Project",
    "field_owner": "Owner",
    "option_unassigned": "Unassigned",
    "field_quadrant": "Quadrant",
    "option_auto": "Auto",
    "option_urgent_important": "Urgent & Important",
    "option_important": "Important",
    "option_urgent": "Urgent",
    "option_neither": "Neither",
    "field_recurring": "Recurring",
    "option_none": "None",
    "option_daily": "Daily",
    "option_weekly": "Weekly",
    "option_monthly": "Monthly",
    "no_recurrence": "No recurrence",
    "field_due_date": "Due Date",
    "field_due_time": "Due Time",
    "field_status": "Status",
    "field_progress": "Progress",
    "field_est_hours": "Est. Hours",
    "field_logged_hours": "Logged Hours",
    "field_link": "Link / URL",
    "field_note": "Note",
    "ph_notes_dots": "Notes...",
    "field_tags": "Tags (comma separated)",
    "ph_tags_example": "urgent, frontend",
    "field_reminder": "Reminder",
    "field_milestone": "Milestone",
    "field_dependencies": "Dependencies",
    "field_subtasks": "Subtasks",
    "ph_add_subtask": "Add subtask...",
    "field_comments": "Comments",
    "ph_add_comment": "Add a comment...",
    "btn_post": "Post",
    "btn_save_template": "Template",
    "title_save_template": "Save as template",
    "btn_cancel": "Cancel",
    "btn_create_task": "Create Task",
    "btn_update_task": "Update Task",
    "confirm_delete_title": "Delete?",
    "confirm_delete_msg": "This cannot be undone.",
    "btn_delete": "Delete",
    "setting_api_url": "Account Database URL",
    "setting_not_configured": "Not configured",
    "btn_test": "Test",
    "btn_edit": "Edit",
    "setting_sync_status": "Sync Status",
    "setting_up_to_date": "Up to date",
    "btn_sync_now": "Sync Now",
    "setting_apps_script_url": "Apps Script URL",
    "setting_sync_token": "Sync Token",
    "setting_sync_token_desc": "Required for Google Sheets sync",
    "setting_gsheets_sync": "Google Sheets Sync",
    "setting_not_synced": "Not synced yet",
    "btn_pull": "Pull",
    "btn_push": "Push",
    "setting_sync_all": "Sync All to Google Sheets",
    "setting_sync_all_desc": "Admin token required",
    "btn_sync_all": "Sync All",
    "setting_pomo_work": "Pomodoro Work (min)",
    "setting_pomo_break": "Pomodoro Break (min)",
    "setting_default_prefix": "Default",
    "setting_language": "Language / RTL",
    "current_lang_label": "English",
    "btn_toggle": "Toggle",
    "setting_export": "Export Tasks",
    "setting_export_desc": "CSV, JSON, or Excel",
    "setting_import": "Import Tasks",
    "setting_import_desc": "Upload JSON backup",
    "btn_import": "Import",
    "setting_notifications": "Enable Notifications",
    "setting_notifications_desc": "Reminders even when the app is closed",
    "btn_enable": "Enable",
    "setting_clear_data": "Clear All Data",
    "setting_clear_data_desc": "Permanently erase",
    "btn_clear": "Clear",
    "notif_enabled": "Notifications enabled — you’ll get reminders even when the app is closed",
    "notif_blocked": "Notifications blocked — enable them in your browser/phone settings",
    "modal_templates_title": "Task Templates",
    "no_templates": "No templates yet.",
    "modal_saved_filters": "Saved Filters",
    "btn_save_current_filter": "Save Current Filter",
    "modal_new_project": "New Project",
    "field_name": "Name",
    "ph_project_name": "Project name",
    "ph_description_dots": "Description...",
    "field_color": "Color",
    "btn_save": "Save",
    "modal_new_goal": "New Goal",
    "field_goal": "Goal",
    "ph_goal_example": "e.g. Complete 10 tasks",
    "field_type": "Type",
    "field_target": "Target",
    "field_unit": "Unit",
    "ph_unit_example": "tasks, hours, etc.",
    "field_current_progress": "Current Progress",
    "modal_new_habit": "New Habit",
    "field_habit_name": "Habit Name",
    "ph_habit_example": "e.g. Read 30 minutes",
    "modal_new_challenge": "New Challenge",
    "field_title_optional": "Title (optional)",
    "ph_auto_generated": "Auto-generated if left blank",
    "field_track": "Track",
    "opt_tasks_completed": "Tasks Completed",
    "opt_hours_logged": "Hours Logged",
    "opt_habit_checkins": "Habit Check-ins",
    "opt_daily_streak": "Daily Completion Streak",
    "field_over_days": "Over how many days",
    "btn_start_challenge": "Start Challenge",
    "modal_new_event": "New Event",
    "ph_event_title": "Meeting with team...",
    "field_date": "Date",
    "field_time": "Time",
    "field_end_time": "End Time",
    "opt_meeting": "Meeting",
    "opt_event": "Event",
    "opt_reminder": "Reminder",
    "opt_deadline": "Deadline",
    "field_description_optional": "Description (optional)",
    "modal_new_note": "New Note",
    "ph_note_title": "Note title",
    "field_folder": "Folder",
    "ph_folder_general": "General",
    "field_pin_note": "Pin Note",
    "field_content_md": "Content (Markdown)",
    "ph_write_note": "Write your note...",
    "field_preview": "Preview",
    "preview_placeholder": "Preview will appear here...",
    "modal_import_preview": "Import Preview",
    "import_no_file": "No file selected",
    "import_note": "Import replaces matching data after validation.",
    "ph_quick_add": "Quick add task... (Enter to create)",
    "quick_add_hint": "Enter = create, Esc = close",
    "pomo_work": "WORK",
    "pomo_break": "BREAK",
    "pomo_select_task": "Select a task to focus on",
    "btn_start": "Start",
    "btn_reset": "Reset",
    "btn_save_time": "Save Time",
    "onboard_welcome": "Welcome to TaskFlow Pro!",
    "onboard_desc": "Your all-in-one professional task platform.",
    "btn_skip": "Skip",
    "btn_next": "Next",
    "review": "Weekly Review",
    "review_subtitle": "Goals, habits and life balance pulled together in one place, with a suggestion for what to focus on next.",
    "review_goals_title": "Goals This Period",
    "review_habits_title": "Habit Consistency",
    "review_velocity_title": "Tasks Completed: This Week vs Last Week",
    "review_lifebalance_title": "Life Balance This Week",
    "field_auto_track": "Auto-track from",
    "opt_link_none": "None (manual)",
    "opt_link_project": "Project",
    "opt_link_category": "Category",
    "opt_link_habit": "Habit",
    "field_which": "Which one",
    "goal_auto_hint": "Progress is counted automatically from completed tasks or habit check-ins in the current week/month — no need to update it by hand.",
    "goal_on_track": "On track",
    "goal_behind": "Behind pace",
    "goal_auto_badge": "Auto",
    "review_no_goals": "No goals yet — add one to see it tracked here.",
    "review_no_habits": "No habits tracked yet.",
    "review_this_week": "This week",
    "review_last_week": "Last week",
    "review_no_lb": "Log a day in Life Balance to see your weekly average here.",
    "review_lb_avg": "7-day average score",
    "focus_great": "Everything is tracking well this week — keep it up.",
    "focus_goal": "Your goal \"{name}\" is behind pace — give it some attention this week.",
    "focus_habit": "Your habit \"{name}\" has slipped — try to check it in today.",
    "focus_lb": "Your Life Balance score has been low this week — worth a look.",
    "todays_focus_title": "Today’s Focus",
    "todays_focus_all_clear": "Nothing urgent today — nice work.",
    "focus_tag_overdue": "Overdue",
    "focus_tag_due_today": "Due today",
    "focus_tag_goal": "Goal",
    "focus_tag_habit": "Habit",
    "focus_do_task_for_goal": "\"{task}\" — moves goal \"{goal}\" forward",
    "focus_checkin_habit": "Check off \"{habit}\" — keeps goal \"{goal}\" on track",
    "focus_update_goal": "Update \"{goal}\" — it’s behind pace",
    "achievements_title": "Achievements",
    "achievements_subtitle": "Milestones earned from your own real activity — nothing to buy, nothing to fake.",
    "badge_first_task": "First Steps",
    "badge_first_task_hint": "Complete your first task",
    "badge_ten_tasks": "Getting Things Done",
    "badge_ten_tasks_hint": "Complete 10 tasks",
    "badge_fifty_tasks": "Half Century",
    "badge_fifty_tasks_hint": "Complete 50 tasks",
    "badge_hundred_tasks": "Century Club",
    "badge_hundred_tasks_hint": "Complete 100 tasks",
    "badge_streak_3": "On a Roll",
    "badge_streak_3_hint": "3-day completion streak",
    "badge_streak_7": "Unstoppable",
    "badge_streak_7_hint": "7-day completion streak",
    "badge_streak_14": "Streak Legend",
    "badge_streak_14_hint": "14-day best streak ever",
    "badge_goal_getter": "Goal Getter",
    "badge_goal_getter_hint": "Reach 100% on a goal",
    "badge_habit_builder": "Habit Builder",
    "badge_habit_builder_hint": "7-day streak on a habit",
    "badge_challenger": "Challenger",
    "badge_challenger_hint": "Win a challenge",
    "badge_balanced_life": "Balanced Life",
    "badge_balanced_life_hint": "Score 85+ in Life Balance",
    "new_badge_toast": "Achievement unlocked: {name}! 🏆",
    "notif_digest_title": "Today’s reminders",
    "notif_digest_overdue": "{n} overdue",
    "notif_digest_due": "{n} due today",
    "notif_digest_goals": "{n} goal(s) behind pace",
    "field_remind_me": "Remind me",
    "opt_remind_none": "Don’t remind me",
    "opt_remind_attime": "At the time",
    "opt_remind_10": "10 minutes before",
    "opt_remind_30": "30 minutes before",
    "opt_remind_60": "1 hour before",
    "opt_remind_1440": "1 day before",
    "event_reminder_title": "Reminder: {title}",
    "event_reminder_body_meeting": "Meeting starting soon",
    "event_reminder_body_deadline": "Deadline coming up",
    "event_reminder_body_generic": "Coming up soon",
    "field_important_alarm": "Important (alarm)",
    "btn_snooze": "Snooze 5 min",
    "btn_dismiss": "Dismiss",
    "alarm_snoozed": "Alarm snoozed for 5 minutes",
    "Dashboard": "Dashboard",
    "My Day": "My Day",
    "Kanban Board": "Kanban Board",
    "Projects": "Projects",
    "Goals": "Goals",
    "Habits": "Habits",
    "Notes": "Notes",
    "Progress": "Progress",
    "Archive": "Archive",
    "Pomodoro Timer": "Pomodoro Timer",
    "Categories": "Categories",
    "done": "done",
    "All Projects": "All Projects",
    "All Owners": "All Owners",
    "All": "All",
    "Username": "Username",
    "To Do": "To Do",
    "In Progress": "In Progress",
    "Done": "Done",
    "High": "High",
    "Medium": "Medium",
    "Low": "Low",
    "Priority": "Priority",
    "Delete": "Delete",
    "New Event": "New Event",
    "Completed": "Completed",
    "Do First": "Do First",
    "Schedule": "Schedule",
    "Delegate": "Delegate",
    "Eliminate": "Eliminate",
    "Tasks Completed": "Tasks Completed",
    "Description": "Description",
    "Category": "Category",
    "No Project": "No Project",
    "Owner": "Owner",
    "Unassigned": "Unassigned",
    "Urgent & Important": "Urgent & Important",
    "No recurrence": "No recurrence",
    "Due Date": "Due Date",
    "Status": "Status",
    "Est. Hours": "Est. Hours",
    "Logged Hours": "Logged Hours",
    "Note": "Note",
    "Create Task": "Create Task",
    "Not configured": "Not configured",
    "Edit": "Edit",
    "Up to date": "Up to date",
    "Required for Google Sheets sync": "Required for Google Sheets sync",
    "English": "English",
    "Clear": "Clear",
    "Hours Logged": "Hours Logged",
    "Habit Check-ins": "Habit Check-ins",
    "Start Challenge": "Start Challenge",
    "Preview will appear here...": "Preview will appear here...",
    "Welcome to TaskFlow Pro!": "Welcome to TaskFlow Pro!",
    "Overdue": "Overdue",
    "Please sign in again": "Please sign in again",
    "Session changed": "Session changed",
    "API not configured": "API not configured",
    "Account changed": "Account changed",
    "Cannot reach the account database": "Cannot reach the account database",
    "Request failed (": "Request failed (",
    "Not signed in to the account database": "Not signed in to the account database",
    "Browser storage is full or unavailable. Export a backup and free space before saving.": "Browser storage is full or unavailable. Export a backup and free space before saving.",
    "Sync conflict: local changes retained. Export a backup before resolving with the other device.": "Sync conflict: local changes retained. Export a backup before resolving with the other device.",
    "Wait for synchronization to finish": "Wait for synchronization to finish",
    "No queued changes": "No queued changes",
    "Both versions have been downloaded as a backup. Type LOCAL to keep this device?s queued changes, or SERVER to replace those sections with the server copy. Cancel leaves everything unchanged.": "Both versions have been downloaded as a backup. Type LOCAL to keep this device?s queued changes, or SERVER to replace those sections with the server copy. Cancel leaves everything unchanged.",
    "Offline": "Offline",
    " change(s) waiting to sync": " change(s) waiting to sync",
    " change(s) queued": " change(s) queued",
    " — will sync when back online": " — will sync when back online",
    "Syncing...": "Syncing...",
    "Account Database (API) URL:": "Account Database (API) URL:",
    "Enter a valid HTTP or HTTPS API URL": "Enter a valid HTTP or HTTPS API URL",
    "Account database URL updated — log out and back in to switch accounts to it": "Account database URL updated — log out and back in to switch accounts to it",
    "Set an Account Database URL first": "Set an Account Database URL first",
    "Testing...": "Testing...",
    "Account database reachable": "Account database reachable",
    "Configured — reachable": "Configured — reachable",
    "Account database not ready": "Account database not ready",
    "Configured — not ready": "Configured — not ready",
    "Cannot reach account database": "Cannot reach account database",
    "Configured — unreachable": "Configured — unreachable",
    "Username must be 3-32 characters: letters, numbers, and underscores only": "Username must be 3-32 characters: letters, numbers, and underscores only",
    "Password must be at least 6 characters": "Password must be at least 6 characters",
    "No account database configured. Set an Account Database URL in Settings first.": "No account database configured. Set an Account Database URL in Settings first.",
    "Can't reach the account database. Check the Account Database URL in Settings, or make sure the API is running.": "Can't reach the account database. Check the Account Database URL in Settings, or make sure the API is running.",
    "Sign in failed.": "Sign in failed.",
    "continue offline": "continue offline",
    " with your last synced data.": " with your last synced data.",
    "Untitled Task": "Untitled Task",
    "Untitled Project": "Untitled Project",
    "Untitled Goal": "Untitled Goal",
    "Untitled Habit": "Untitled Habit",
    "Untitled Note": "Untitled Note",
    "Backup must be a JSON object": "Backup must be a JSON object",
    "No supported backup sections": "No supported backup sections",
    " must be an array with at most ": " must be an array with at most ",
    " records": " records",
    "Invalid ": "Invalid ",
    " record": " record",
    "Invalid or duplicate ": "Invalid or duplicate ",
    " ID": " ID",
    "Undo": "Undo",
    "No comments yet": "No comments yet",
    "Next copy after completion: ": "Next copy after completion: ",
    "Commented on \"": "Commented on \"",
    "Title required (maximum 200 characters)": "Title required (maximum 200 characters)",
    "Complete dependencies first": "Complete dependencies first",
    "Updated: \"": "Updated: \"",
    "Created: \"": "Created: \"",
    "Deleted: \"": "Deleted: \"",
    "Reopened: \"": "Reopened: \"",
    "Completed: \"": "Completed: \"",
    "Archived: \"": "Archived: \"",
    "Restored: \"": "Restored: \"",
    "Task updated": "Task updated",
    "Task created": "Task created",
    "Delete Task?": "Delete Task?",
    "\" will be deleted.": "\" will be deleted.",
    "Task deleted": "Task deleted",
    "Task restored": "Task restored",
    "Blocked by ": "Blocked by ",
    " dependencies": " dependencies",
    "Task completed! &#127881;": "Task completed! &#127881;",
    "Task archived": "Task archived",
    "Restored": "Restored",
    "Archive cleared": "Archive cleared",
    "Clear Archive?": "Clear Archive?",
    "All archived tasks will be permanently deleted.": "All archived tasks will be permanently deleted.",
    "Archive is empty": "Archive is empty",
    "Archived tasks appear here": "Archived tasks appear here",
    "Archived ": "Archived ",
    "Restore": "Restore",
    "Deleted ": "Deleted ",
    " tasks": " tasks",
    " deleted": " deleted",
    "Delete ": "Delete ",
    " tasks?": " tasks?",
    "Cannot be undone.": "Cannot be undone.",
    "Delete All": "Delete All",
    " archived": " archived",
    " updated": " updated",
    "Total": "Total",
    "Sun": "Sun",
    "Mon": "Mon",
    "Tue": "Tue",
    "Wed": "Wed",
    "Thu": "Thu",
    "Fri": "Fri",
    "Sat": "Sat",
    "Less ": "Less ",
    " More": " More",
    "No deadlines": "No deadlines",
    "No goals set": "No goals set",
    "No habits tracked": "No habits tracked",
    "No activity": "No activity",
    "No tasks found": "No tasks found",
    "Press Q for quick add": "Press Q for quick add",
    "blocked": "blocked",
    "Timer": "Timer",
    "Empty": "Empty",
    "Moved \"": "Moved \"",
    "\" to ": "\" to ",
    "Moved": "Moved",
    "Edit Event": "Edit Event",
    "Please enter a title": "Please enter a title",
    "Please select a date": "Please select a date",
    "Event updated": "Event updated",
    "Event created": "Event created",
    "Event deleted": "Event deleted",
    "January": "January",
    "February": "February",
    "March": "March",
    "April": "April",
    "May": "May",
    "June": "June",
    "July": "July",
    "August": "August",
    "September": "September",
    "October": "October",
    "November": "November",
    "December": "December",
    "Other": "Other",
    "Completion": "Completion",
    "Streak": "Streak",
    "day": "day",
    "Metrics": "Metrics",
    "Avg Completion": "Avg Completion",
    "No data": "No data",
    "Burndown (7 days)": "Burndown (7 days)",
    "Add due dates to see timeline": "Add due dates to see timeline",
    "Morning": "Morning",
    "Afternoon": "Afternoon",
    "Evening": "Evening",
    "No tasks": "No tasks",
    "Today's Tasks": "Today's Tasks",
    "Remaining": "Remaining",
    "&#9728; Morning": "&#9728; Morning",
    "&#9788; Afternoon": "&#9788; Afternoon",
    "&#9790; Evening": "&#9790; Evening",
    "No tasks available": "No tasks available",
    "Added to My Day": "Added to My Day",
    "Today &bull; ": "Today &bull; ",
    "Scheduled": "Scheduled",
    "Planned Hours": "Planned Hours",
    "Free Hours": "Free Hours",
    "Unscheduled": "Unscheduled",
    "Everything fits today &#127881;": "Everything fits today &#127881;",
    "No Projects": "No Projects",
    "Create your first project": "Create your first project",
    "Create Project": "Create Project",
    "Project name required": "Project name required",
    "Project saved": "Project saved",
    "Delete this project?": "Delete this project?",
    "Project deleted": "Project deleted",
    "Not Urgent & Important": "Not Urgent & Important",
    "Urgent & Not Important": "Urgent & Not Important",
    "Not Urgent & Not Important": "Not Urgent & Not Important",
    "No urgent & important tasks": "No urgent & important tasks",
    "No tasks to schedule": "No tasks to schedule",
    "No tasks to delegate": "No tasks to delegate",
    "Nothing to eliminate": "Nothing to eliminate",
    "Moved to ": "Moved to ",
    "No Goals": "No Goals",
    "Set your first goal": "Set your first goal",
    "Create Goal": "Create Goal",
    "No habits yet": "No habits yet",
    "No projects yet": "No projects yet",
    "No categories yet": "No categories yet",
    "Goal title required": "Goal title required",
    "Goal saved": "Goal saved",
    "Delete this goal?": "Delete this goal?",
    "Goal deleted": "Goal deleted",
    "No Habits": "No Habits",
    "Start tracking a habit": "Start tracking a habit",
    "Create Habit": "Create Habit",
    "Habit name required": "Habit name required",
    "Habit saved": "Habit saved",
    "Delete this habit?": "Delete this habit?",
    "Habit deleted": "Habit deleted",
    "All Notes": "All Notes",
    "Unfiled": "Unfiled",
    "No Notes": "No Notes",
    "Create your first note": "Create your first note",
    "Create Note": "Create Note",
    "Note saved": "Note saved",
    "Delete this note?": "Delete this note?",
    "Note deleted": "Note deleted",
    "Unknown": "Unknown",
    "Total Logged": "Total Logged",
    "hours across ": "hours across ",
    "Hours by Category": "Hours by Category",
    "Hours by Project": "Hours by Project",
    "Hours by Day (Recent)": "Hours by Day (Recent)",
    "Sleep": "Sleep",
    "Work": "Work",
    "Study": "Study",
    "Exercise": "Exercise",
    "Social": "Social",
    "Leisure": "Leisure",
    "Optimal": "Optimal",
    "Good": "Good",
    "Caution": "Caution",
    "Too Low": "Too Low",
    "Too High": "Too High",
    "None Logged": "None Logged",
    "Not Scored": "Not Scored",
    "Within the 7–9h adult range recommended by sleep-health guidelines.": "Within the 7–9h adult range recommended by sleep-health guidelines.",
    "Slightly under the recommended 7–9h — occasional, not chronic, is the goal.": "Slightly under the recommended 7–9h — occasional, not chronic, is the goal.",
    "Slightly over 9h — fine occasionally; consistently needing this much can also signal poor sleep quality.": "Slightly over 9h — fine occasionally; consistently needing this much can also signal poor sleep quality.",
    "Well under the recommended range; chronic short sleep is linked to impaired cognition, mood and long-term health risk.": "Well under the recommended range; chronic short sleep is linked to impaired cognition, mood and long-term health risk.",
    "Well over the typical range; if this is a consistent pattern it may be worth discussing with a doctor.": "Well over the typical range; if this is a consistent pattern it may be worth discussing with a doctor.",
    "Meets/exceeds the ~30 min/day average implied by WHO’s 150–300 min/week guideline.": "Meets/exceeds the ~30 min/day average implied by WHO’s 150–300 min/week guideline.",
    "Below the general 150 min/week guideline, but still more than none — worth building on.": "Below the general 150 min/week guideline, but still more than none — worth building on.",
    "Well below recommended activity levels for cardiovascular and mental-health benefits.": "Well below recommended activity levels for cardiovascular and mental-health benefits.",
    "No activity logged. Even short daily movement has measurable health benefits.": "No activity logged. Even short daily movement has measurable health benefits.",
    "Discretionary time in the range associated with peak subjective well-being (highest around ~2h).": "Discretionary time in the range associated with peak subjective well-being (highest around ~2h).",
    "Very little discretionary time is associated with feeling time-starved and lower well-being.": "Very little discretionary time is associated with feeling time-starved and lower well-being.",
    "Large amounts of unstructured time show diminishing (sometimes slightly negative) well-being returns unless spent purposefully.": "Large amounts of unstructured time show diminishing (sometimes slightly negative) well-being returns unless spent purposefully.",
    "Meaningful social contact is one of the strongest predictors of long-term well-being.": "Meaningful social contact is one of the strongest predictors of long-term well-being.",
    "Some connection logged, but more consistent social time is consistently linked to better outcomes.": "Some connection logged, but more consistent social time is consistently linked to better outcomes.",
    "No social time logged. Isolation is an established risk factor for both mental and physical health.": "No social time logged. Isolation is an established risk factor for both mental and physical health.",
    "No study time logged today — not scored, since not everyone studies daily.": "No study time logged today — not scored, since not everyone studies daily.",
    "Within the range where focused cognitive work stays sustainable (deliberate-practice research puts the ceiling near 4h/day even for experts).": "Within the range where focused cognitive work stays sustainable (deliberate-practice research puts the ceiling near 4h/day even for experts).",
    "Above the range associated with sustained peak performance — make sure real breaks are built in.": "Above the range associated with sustained peak performance — make sure real breaks are built in.",
    "Sustained high cognitive load without recovery is linked to diminishing returns and burnout risk.": "Sustained high cognitive load without recovery is linked to diminishing returns and burnout risk.",
    "No work hours logged in the past 7 days.": "No work hours logged in the past 7 days.",
    "At or under the standard 40h/week.": "At or under the standard 40h/week.",
    "Above standard full-time hours; sustained overwork in this range carries rising health risk.": "Above standard full-time hours; sustained overwork in this range carries rising health risk.",
    "Above 55h/week — a WHO/ILO joint study linked this level to a 35% higher stroke risk and 17% higher risk of fatal ischemic heart disease versus 35–40h/week.": "Above 55h/week — a WHO/ILO joint study linked this level to a 35% higher stroke risk and 17% higher risk of fatal ischemic heart disease versus 35–40h/week.",
    "— logged ": "— logged ",
    "h, that’s more than 24h in a day, adjust your entries": "h, that’s more than 24h in a day, adjust your entries",
    "h logged, ": "h logged, ",
    "h unaccounted for (commute, meals, chores, etc.)": "h unaccounted for (commute, meals, chores, etc.)",
    "Work (weekly)": "Work (weekly)",
    "Not enough data": "Not enough data",
    "Excellent balance": "Excellent balance",
    "Good balance": "Good balance",
    "Needs attention": "Needs attention",
    "Poor balance": "Poor balance",
    "Composite of sleep, exercise, leisure, social and weekly work-hour scores against the sources below. Study time is shown for reflection but not included, since there’s no universal healthy amount.": "Composite of sleep, exercise, leisure, social and weekly work-hour scores against the sources below. Study time is shown for reflection but not included, since there’s no universal healthy amount.",
    "h over last ": "h over last ",
    " logged day(s)": " logged day(s)",
    "These are population-level research findings used as reflection benchmarks, not individualized medical advice. Needs vary by age, health status and personal circumstances.": "These are population-level research findings used as reflection benchmarks, not individualized medical advice. Needs vary by age, health status and personal circumstances.",
    "Day Completion Streak": "Day Completion Streak",
    " day": " day",
    "-day window": "-day window",
    "Challenge started": "Challenge started",
    "Challenge started &mdash; beat your record!": "Challenge started &mdash; beat your record!",
    "No activity logged yet &mdash; complete tasks, check off habits, or log a Life Balance day to see your trend.": "No activity logged yet &mdash; complete tasks, check off habits, or log a Life Balance day to see your trend.",
    "No habits tracked yet": "No habits tracked yet",
    "No challenges yet &mdash; start one below or create your own.": "No challenges yet &mdash; start one below or create your own.",
    "&#127942; Completed": "&#127942; Completed",
    "Ended": "Ended",
    "Active": "Active",
    "Remove": "Remove",
    "Your best 7-day run: ": "Your best 7-day run: ",
    "h logged": "h logged",
    "Your longest-ever streak: ": "Your longest-ever streak: ",
    "Your longest-ever habit streak: ": "Your longest-ever habit streak: ",
    "Challenge complete: ": "Challenge complete: ",
    "Activity Score Today": "Activity Score Today",
    "Current Streak": "Current Streak",
    "Best Streak Ever": "Best Streak Ever",
    "Challenges": "Challenges",
    "-- Select Task --": "-- Select Task --",
    "Work Session": "Work Session",
    "Break Time": "Break Time",
    "Work session complete! Take a break.": "Work session complete! Take a break.",
    "Break over! Start working.": "Break over! Start working.",
    "No task selected": "No task selected",
    "Time logged to ": "Time logged to ",
    "Reminder: ": "Reminder: ",
    "Task \"": "Task \"",
    "\" is due!": "\" is due!",
    "Push notifications disabled on this browser": "Push notifications disabled on this browser",
    "Could not disable push: ": "Could not disable push: ",
    "Add categories to tasks to filter here": "Add categories to tasks to filter here",
    "No results": "No results",
    "Created \"": "Created \"",
    "Template name:": "Template name:",
    "Select tasks first": "Select tasks first",
    "Template saved": "Template saved",
    "Use": "Use",
    "No templates": "No templates",
    "Template applied": "Template applied",
    "Template deleted": "Template deleted",
    "Filter name:": "Filter name:",
    "Filter saved": "Filter saved",
    "Apply": "Apply",
    "No saved filters": "No saved filters",
    "Filter applied": "Filter applied",
    "Filter deleted": "Filter deleted",
    "Excel library not loaded": "Excel library not loaded",
    "No users found": "No users found",
    "Info": "Info",
    "No tasks for this user": "No tasks for this user",
    "Excel exported with ": "Excel exported with ",
    " user sheet(s)": " user sheet(s)",
    "Tasks": "Tasks",
    "Invalid JSON: ": "Invalid JSON: ",
    "Backup imported": "Backup imported",
    "Import was not saved. Free browser storage and try again.": "Import was not saved. Free browser storage and try again.",
    "Google Apps Script URL:": "Google Apps Script URL:",
    "Set Apps Script URL first": "Set Apps Script URL first",
    "Set Sync Token first": "Set Sync Token first",
    "Sync token from Apps Script Properties:": "Sync token from Apps Script Properties:",
    "Configured": "Configured",
    "Configured for this account": "Configured for this account",
    "Configured — not signed in": "Configured — not signed in",
    "Configured — signed in": "Configured — signed in",
    "Last synced ": "Last synced ",
    "Ready, not synced yet": "Ready, not synced yet",
    "Delete ALL synced data for this account? This cannot be undone!": "Delete ALL synced data for this account? This cannot be undone!",
    "Deletion queued; waiting for synchronization": "Deletion queued; waiting for synchronization",
    "Account data cleared": "Account data cleared",
    "Could not clear account data: ": "Could not clear account data: ",
    "Your all-in-one task management workspace. Let's take a quick tour.": "Your all-in-one task management workspace. Let's take a quick tour.",
    "Quick Add Tasks": "Quick Add Tasks",
    "Press Q anywhere to quickly create a task. Use !high, @category, #tag, ~project syntax.": "Press Q anywhere to quickly create a task. Use !high, @category, #tag, ~project syntax.",
    "Your overview with stats, charts, activity heatmap, goals, and habits.": "Your overview with stats, charts, activity heatmap, goals, and habits.",
    "Plan your day with time-blocked tasks and daily notes.": "Plan your day with time-blocked tasks and daily notes.",
    "Drag tasks between columns to update status.": "Drag tasks between columns to update status.",
    "Projects & Goals": "Projects & Goals",
    "Organize tasks into projects and track weekly/monthly goals.": "Organize tasks into projects and track weekly/monthly goals.",
    "Boost focus with work/break cycles. Click the timer icon on any task.": "Boost focus with work/break cycles. Click the timer icon on any task.",
    "All Set!": "All Set!",
    "You're ready to be productive. Press Escape to dismiss any overlay.": "You're ready to be productive. Press Escape to dismiss any overlay.",
    "Step ": "Step ",
    " of ": " of ",
    "Sync failed: ": "Sync failed: ",
    "Sync failed": "Sync failed",
    "Testing connection...": "Testing connection...",
    "Sync connection ready": "Sync connection ready",
    "Sync test failed: ": "Sync test failed: ",
    "Sync test failed": "Sync test failed",
    "Syncing to Google Sheets...": "Syncing to Google Sheets...",
    "Syncing all users to Google Sheets...": "Syncing all users to Google Sheets...",
    "Local tasks changed since last sync. Pulling will replace them. Continue?": "Local tasks changed since last sync. Pulling will replace them. Continue?",
    "Pulled ": "Pulled ",
    "App installed successfully!": "App installed successfully!",
    "Open in browser to install": "Open in browser to install",
    "Installing...": "Installing...",
    "Resolve sync conflicts": "Resolve sync conflicts",
    "TaskFlow Pro": "TaskFlow Pro",
    "TaskFlow Pro — Team Task Monitor": "TaskFlow Pro — Team Task Monitor",
    "overdue_count": "Overdue tasks: {n}",
    "selected_count": "Selected tasks: {n}",
    "streak_days": "Consecutive days: {n}",
    "hours_value": "{n}h",
    "calendar_tasks": "{n} tasks",
    "remaining_tasks": "{n} remaining",
    "auto_challenge_streak": "Reach a {n}-day streak",
    "auto_challenge_period": "{target} {unit} in {days} days",
    "Disable push": "Disable push",
    "active": "active",
    "Password": "Password",
    "Search tasks": "Search tasks",
    "Search notes": "Search notes",
    "Daily notes": "Daily notes",
    "Filter dashboard by date": "Filter dashboard by date",
    "Filter dashboard by project": "Filter dashboard by project",
    "Filter dashboard by owner": "Filter dashboard by owner",
    "Filter tasks by status": "Filter tasks by status",
    "Filter tasks by priority": "Filter tasks by priority",
    "Filter tasks by category": "Filter tasks by category",
    "Filter tasks by project": "Filter tasks by project",
    "Filter tasks by owner": "Filter tasks by owner",
    "Sort tasks": "Sort tasks",
    "Pomodoro work duration in minutes": "Pomodoro work duration in minutes",
    "Pomodoro break duration in minutes": "Pomodoro break duration in minutes",
    "Import task backup file": "Import task backup file",
    "Quick add task": "Quick add task",
    "Choose a task to focus on": "Choose a task to focus on",
    "Close": "Close",
    "Excel": "Excel",
    "offline_login_before": "Can't reach the account database — ",
    "unchanged": "unchanged",
    "ID": "ID",
    "Title": "Title",
    "Due": "Due",
    "Tags": "Tags",
    "Created": "Created",
    "Updated": "Updated",
    "api_forbidden": "Access denied",
    "api_not_found": "Item not found",
    "api_conflict": "Data conflict. Refresh and try again.",
    "api_invalid_operation": "This operation could not be completed",
    "api_internal_error": "Server error. Please try again later.",
    "api_unauthorized": "Invalid credentials or expired session",
    "api_failed": "Request failed ({status})",
    "Edit Project": "Edit Project",
    "Edit Goal": "Edit Goal",
    "Edit Habit": "Edit Habit",
    "Edit Note": "Edit Note",
    "Title is required and must be 200 characters or fewer.": "Title is required and must be 200 characters or fewer.",
    "Username is already taken.": "Username is already taken.",
    "Username already exists": "Username already exists",
    "Invalid username.": "Invalid username.",
    "Password must be at least 6 characters.": "Password must be at least 6 characters.",
    "Invalid priority.": "Invalid priority.",
    "lb_sources_html": "<p><strong>Sleep (7–9h):</strong> Hirshkowitz et al., \"National Sleep Foundation’s Sleep Time Duration Recommendations,\" <em>Sleep Health</em>, 2015; consistent with CDC adult sleep guidance.</p><p><strong>Exercise (≥150 min/week):</strong> World Health Organization, \"WHO Guidelines on Physical Activity and Sedentary Behaviour,\" 2020.</p><p><strong>Leisure/discretionary time (~2h peak, plateau by ~5h):</strong> Sharif, Mogilner & Hershfield, \"Having Too Little or Too Much Time Is Linked to Lower Subjective Well-Being,\" <em>Journal of Personality and Social Psychology</em>, 2021.</p><p><strong>Social connection:</strong> Waldinger & Schulz, findings from the Harvard Study of Adult Development (the longest-running longitudinal study on well-being), summarized in <em>The Good Life</em>, 2023.</p><p><strong>Study/deep work (≈4h sustainable ceiling):</strong> Ericsson, Krampe & Tesch-Römer, \"The Role of Deliberate Practice in the Acquisition of Expert Performance,\" <em>Psychological Review</em>, 1993.</p><p><strong>Weekly work hours (≤40h optimal, >55h high risk):</strong> Pega et al., joint WHO/ILO study, \"Global, Regional, and National Burdens of Ischemic Heart Disease and Stroke Attributable to Exposure to Long Working Hours,\" <em>Environment International</em>, 2021.</p>"
  },
  "ar": {
    "backup_section_limit": "يجب أن يكون قسم {section} قائمة لا يتجاوز عدد سجلاتها {limit}",
    "backup_invalid_record": "يوجد سجل غير صالح في قسم {section}",
    "backup_invalid_id": "يوجد معرّف غير صالح أو مكرر في قسم {section}",
    "backup_invalid_json": "الملف ليس بصيغة JSON صالحة. اختر ملف نسخة احتياطية من تاسك فلو.",
    "backup_read_failed": "تعذّرت قراءة ملف النسخة الاحتياطية. يرجى المحاولة مجددًا.",
    "dashboard": "لوحة التحكم",
    "my_day": "يومي",
    "all_tasks": "كل المهام",
    "kanban": "لوحة كانبان",
    "calendar": "التقويم",
    "timetable": "الجدول الزمني",
    "matrix": "مصفوفة أيزنهاور",
    "projects": "المشاريع",
    "goals": "الأهداف",
    "habits": "العادات",
    "notes": "الملاحظات",
    "analytics": "التحليلات والرؤى",
    "time_reports": "تقارير الوقت",
    "life_balance": "توازن الحياة",
    "progress": "التقدم",
    "archive": "الأرشيف",
    "pomodoro": "مؤقت بومودورو",
    "templates": "القوالب",
    "settings": "الإعدادات",
    "new_task": "مهمة جديدة",
    "nav_main": "الرئيسية",
    "nav_plan": "التخطيط",
    "nav_analytics": "التحليلات",
    "nav_categories": "الفئات",
    "nav_quick": "أدوات سريعة",
    "weekly_overview": "نظرة عامة على الأسبوع",
    "priority_dist": "توزيع الأولويات",
    "upcoming": "المواعيد القادمة",
    "goal_progress": "تقدم الأهداف",
    "habit_streaks": "المواظبة على العادات",
    "recent_activity": "النشاط الأخير",
    "daily_notes": "ملاحظات اليوم",
    "heatmap_title": "خريطة الإنتاجية الحرارية",
    "heatmap_subtitle": "آخر 16 أسبوعًا",
    "done_label": "منجز",
    "greet_morning": "صباح الخير",
    "greet_afternoon": "طاب يومك",
    "greet_evening": "مساء الخير",
    "filter_all_dates": "كل التواريخ",
    "filter_today": "اليوم",
    "filter_this_week": "هذا الأسبوع",
    "filter_this_month": "هذا الشهر",
    "filter_all_projects": "كل المشاريع",
    "filter_all_owners": "كل المكلفين",
    "filter_all": "الكل",
    "login_tagline": "نظام متابعة مهام الفريق",
    "ph_username": "اسم المستخدم",
    "ph_password": "كلمة المرور (6 أحرف على الأقل)",
    "sign_in": "تسجيل الدخول",
    "create_account": "إنشاء حساب",
    "new_here": "مستخدم جديد؟",
    "have_account": "لديك حساب بالفعل؟",
    "switch_to_create": "إنشاء حساب",
    "switch_to_signin": "تسجيل الدخول",
    "login_footer": "تاسك فلو برو — إصدار الفريق",
    "please_wait": "يرجى الانتظار...",
    "member": "عضو",
    "admin": "مسؤول",
    "logged_in_as": "سجلت الدخول باسم",
    "logout": "تسجيل الخروج",
    "title_sync_status": "حالة المزامنة",
    "title_toggle_theme": "تبديل المظهر",
    "title_overdue_tasks": "المهام المتأخرة",
    "title_language": "اللغة / الاتجاه",
    "title_install_app": "تثبيت التطبيق",
    "ph_search_tasks": "ابحث في المهام...",
    "ph_daily_notes": "اكتب ملاحظاتك لهذا اليوم...",
    "filter_all_status": "كل الحالات",
    "status_todo": "قيد الانتظار",
    "status_inprogress": "قيد التنفيذ",
    "status_done": "منجزة",
    "filter_all_priorities": "كل الأولويات",
    "priority_high": "عالية",
    "priority_medium": "متوسطة",
    "priority_low": "منخفضة",
    "filter_all_categories": "كل الفئات",
    "sort_newest": "الأحدث",
    "sort_oldest": "الأقدم",
    "sort_due_soon": "الأقرب استحقاقًا",
    "sort_priority": "الأولوية",
    "sort_smart_score": "درجة الأولوية الذكية",
    "sort_az": "ترتيب أبجدي",
    "title_saved_filters": "عوامل التصفية المحفوظة",
    "bulk_mark_done": "تحديد كمُنجزة",
    "bulk_mark_todo": "إعادة إلى قيد الانتظار",
    "action_archive": "أرشفة",
    "action_delete": "حذف",
    "action_cancel": "إلغاء",
    "kanban_subtitle": "اسحب المهام وأفلتها بين الأعمدة لتحديث حالتها",
    "title_prev_month": "الشهر السابق",
    "title_next_month": "الشهر التالي",
    "today_label": "اليوم",
    "new_event": "حدث جديد",
    "timetable_subtitle": "تتم جدولة المهام تلقائيًا في الأوقات الفارغة من يومك",
    "title_prev_day": "اليوم السابق",
    "title_next_day": "اليوم التالي",
    "label_from": "من",
    "label_to": "إلى",
    "tt_not_scheduled": "مهام غير مجدولة اليوم",
    "tt_add_block": "إضافة فترة زمنية",
    "modal_new_time_block": "فترة زمنية جديدة",
    "modal_edit_time_block": "تعديل الفترة الزمنية",
    "tt_block_title": "ما الذي ستعمل عليه؟",
    "tt_block_saved": "تم حفظ الفترة الزمنية",
    "tt_block_deleted": "تم حذف الفترة الزمنية",
    "tt_time_error": "اختر وقت انتهاء بعد وقت البدء",
    "tt_manual_block": "فترة زمنية ثابتة",
    "tt_progress": "الفترات المكتملة",
    "tt_mark_done": "تحديد الفترة كمكتملة",
    "tt_mark_undone": "إعادة الفترة إلى غير مكتملة",
    "eisenhower_subtitle": "رتب أولويات المهام حسب الإلحاح والأهمية",
    "eh_do_first": "نفّذ أولًا",
    "eh_schedule": "جدولها لاحقًا",
    "eh_delegate": "فوّضها",
    "eh_eliminate": "استبعدها",
    "new_project": "+ مشروع جديد",
    "new_goal": "+ هدف جديد",
    "new_habit": "+ عادة جديدة",
    "new_note": "+ ملاحظة جديدة",
    "goal_weekly": "أسبوعي",
    "goal_monthly": "شهري",
    "ph_search_notes": "ابحث في الملاحظات...",
    "gantt_timeline": "مخطط جانت الزمني",
    "lb_subtitle": "سجل كيف تقضي يومك فعليًا",
    "lb_log_hours": "سجل ساعات اليوم",
    "lb_category_breakdown": "تفصيل الفئات",
    "lb_weekly_check": "فحص ساعات العمل الأسبوعية",
    "lb_show_sources": "إظهار المنهجية والمصادر",
    "lb_hide_sources": "إخفاء المنهجية والمصادر",
    "progress_subtitle": "يحتسب تلقائيًا من نشاطك",
    "new_challenge": "+ تحدٍ جديد",
    "progress_activity_chart": "مؤشر النشاط",
    "progress_tasks_chart": "المهام المنجزة",
    "progress_habit_consistency": "انتظام العادات",
    "your_challenges": "تحدياتك",
    "beat_your_record": "تفوق على رقمك القياسي",
    "beat_record_subtitle": "تحديات مقترحة بناءً على رقمك القياسي.",
    "clear_archive": "إفراغ الأرشيف",
    "modal_new_task": "مهمة جديدة",
    "modal_edit_task": "تعديل المهمة",
    "btn_save_changes": "حفظ التغييرات",
    "field_title": "العنوان *",
    "ph_task_title": "ما الذي يجب إنجازه؟",
    "field_description": "الوصف",
    "ph_add_details": "أضف التفاصيل...",
    "field_priority": "الأولوية",
    "field_category": "الفئة",
    "ph_category_example": "مثال: العمل",
    "field_project": "المشروع",
    "option_no_project": "بدون مشروع",
    "field_owner": "المسؤول",
    "option_unassigned": "غير مسند",
    "field_quadrant": "الربع",
    "option_auto": "تلقائي",
    "option_urgent_important": "عاجل ومهم",
    "option_important": "مهم",
    "option_urgent": "عاجل",
    "option_neither": "غير عاجل وغير مهم",
    "field_recurring": "التكرار",
    "option_none": "بدون",
    "option_daily": "يوميًا",
    "option_weekly": "أسبوعيًا",
    "option_monthly": "شهريًا",
    "no_recurrence": "بدون تكرار",
    "field_due_date": "تاريخ الاستحقاق",
    "field_due_time": "وقت الاستحقاق",
    "field_status": "الحالة",
    "field_progress": "نسبة الإنجاز",
    "field_est_hours": "الساعات المقدرة",
    "field_logged_hours": "الساعات المسجلة",
    "field_link": "الرابط",
    "field_note": "ملاحظة",
    "ph_notes_dots": "ملاحظات...",
    "field_tags": "الوسوم (مفصولة بفواصل)",
    "ph_tags_example": "عاجل، واجهة",
    "field_reminder": "التذكير",
    "field_milestone": "مرحلة رئيسية",
    "field_dependencies": "المهام السابقة المطلوبة",
    "field_subtasks": "المهام الفرعية",
    "ph_add_subtask": "أضف مهمة فرعية...",
    "field_comments": "التعليقات",
    "ph_add_comment": "أضف تعليقًا...",
    "btn_post": "نشر",
    "btn_save_template": "قالب",
    "title_save_template": "حفظ كقالب",
    "btn_cancel": "إلغاء",
    "btn_create_task": "إنشاء المهمة",
    "btn_update_task": "تحديث المهمة",
    "confirm_delete_title": "حذف؟",
    "confirm_delete_msg": "لا يمكن التراجع عن هذا الإجراء.",
    "btn_delete": "حذف",
    "setting_api_url": "رابط قاعدة بيانات الحساب",
    "setting_not_configured": "لم يتم الإعداد",
    "btn_test": "اختبار",
    "btn_edit": "تعديل",
    "setting_sync_status": "حالة المزامنة",
    "setting_up_to_date": "تمت المزامنة",
    "btn_sync_now": "مزامنة الآن",
    "setting_apps_script_url": "رابط برمجة تطبيقات جوجل",
    "setting_sync_token": "رمز المزامنة",
    "setting_sync_token_desc": "مطلوب للمزامنة مع جداول بيانات جوجل",
    "setting_gsheets_sync": "مزامنة جداول بيانات جوجل",
    "setting_not_synced": "لم تتم المزامنة بعد",
    "btn_pull": "جلب البيانات",
    "btn_push": "إرسال البيانات",
    "setting_sync_all": "مزامنة الكل مع جداول بيانات جوجل",
    "setting_sync_all_desc": "يتطلب رمز المسؤول",
    "btn_sync_all": "مزامنة الكل",
    "setting_pomo_work": "مدة العمل بالدقائق",
    "setting_pomo_break": "مدة الراحة بالدقائق",
    "setting_default_prefix": "الافتراضي",
    "setting_language": "اللغة / الاتجاه",
    "current_lang_label": "العربية",
    "btn_toggle": "تبديل",
    "setting_export": "تصدير المهام",
    "setting_export_desc": "ملف CSV أو JSON أو إكسل",
    "setting_import": "استيراد المهام",
    "setting_import_desc": "ارفع نسخة احتياطية",
    "btn_import": "استيراد",
    "setting_notifications": "تفعيل الإشعارات",
    "setting_notifications_desc": "تذكيرات حتى عند إغلاق التطبيق",
    "btn_enable": "تفعيل",
    "setting_clear_data": "مسح كل البيانات",
    "setting_clear_data_desc": "حذف نهائي",
    "btn_clear": "مسح",
    "notif_enabled": "تم تفعيل الإشعارات — ستصلك التذكيرات حتى عند إغلاق التطبيق",
    "notif_blocked": "تم حظر الإشعارات — فعّلها من إعدادات المتصفح أو الهاتف",
    "modal_templates_title": "قوالب المهام",
    "no_templates": "لا توجد قوالب بعد.",
    "modal_saved_filters": "عوامل التصفية المحفوظة",
    "btn_save_current_filter": "حفظ عامل التصفية الحالي",
    "modal_new_project": "مشروع جديد",
    "field_name": "الاسم",
    "ph_project_name": "اسم المشروع",
    "ph_description_dots": "الوصف...",
    "field_color": "اللون",
    "btn_save": "حفظ",
    "modal_new_goal": "هدف جديد",
    "field_goal": "الهدف",
    "ph_goal_example": "مثال: إنجاز 10 مهام",
    "field_type": "النوع",
    "field_target": "الهدف الرقمي",
    "field_unit": "الوحدة",
    "ph_unit_example": "مهام، ساعات، إلخ",
    "field_current_progress": "التقدم الحالي",
    "modal_new_habit": "عادة جديدة",
    "field_habit_name": "اسم العادة",
    "ph_habit_example": "مثال: القراءة 30 دقيقة",
    "modal_new_challenge": "تحدٍ جديد",
    "field_title_optional": "العنوان (اختياري)",
    "ph_auto_generated": "يُنشأ تلقائيًا إذا ترك فارغًا",
    "field_track": "تتبع",
    "opt_tasks_completed": "المهام المنجزة",
    "opt_hours_logged": "الساعات المسجلة",
    "opt_habit_checkins": "مرات ممارسة العادات",
    "opt_daily_streak": "أيام الإنجاز المتتالية",
    "field_over_days": "عدد أيام التحدي",
    "btn_start_challenge": "ابدأ التحدي",
    "modal_new_event": "حدث جديد",
    "ph_event_title": "اجتماع مع الفريق...",
    "field_date": "التاريخ",
    "field_time": "الوقت",
    "field_end_time": "وقت الانتهاء",
    "opt_meeting": "اجتماع",
    "opt_event": "حدث",
    "opt_reminder": "تذكير",
    "opt_deadline": "موعد نهائي",
    "field_description_optional": "الوصف (اختياري)",
    "modal_new_note": "ملاحظة جديدة",
    "ph_note_title": "عنوان الملاحظة",
    "field_folder": "المجلد",
    "ph_folder_general": "عام",
    "field_pin_note": "تثبيت الملاحظة",
    "field_content_md": "المحتوى (تنسيق ماركداون)",
    "ph_write_note": "اكتب ملاحظتك...",
    "field_preview": "معاينة",
    "preview_placeholder": "ستظهر المعاينة هنا...",
    "modal_import_preview": "معاينة الاستيراد",
    "import_no_file": "لم يتم اختيار ملف",
    "import_note": "يستبدل الاستيراد البيانات المطابقة بعد التحقق.",
    "ph_quick_add": "إضافة مهمة بسرعة… (اضغط على مفتاح الإدخال للإنشاء)",
    "quick_add_hint": "مفتاح الإدخال للإنشاء، ومفتاح الهروب للإغلاق",
    "pomo_work": "عمل",
    "pomo_break": "راحة",
    "pomo_select_task": "اختر مهمة للتركيز عليها",
    "btn_start": "ابدأ",
    "btn_reset": "إعادة تعيين",
    "btn_save_time": "حفظ الوقت",
    "onboard_welcome": "مرحبًا بك في تاسك فلو برو!",
    "onboard_desc": "منصتك الاحترافية الشاملة لإدارة المهام.",
    "btn_skip": "تخطي",
    "btn_next": "التالي",
    "review": "المراجعة الأسبوعية",
    "review_subtitle": "الأهداف والعادات وتوازن الحياة في مكان واحد، مع اقتراح لما يستحق تركيزك القادم.",
    "review_goals_title": "الأهداف لهذه الفترة",
    "review_habits_title": "انتظام العادات",
    "review_velocity_title": "المهام المنجزة: هذا الأسبوع مقابل الأسبوع الماضي",
    "review_lifebalance_title": "توازن الحياة هذا الأسبوع",
    "field_auto_track": "التتبع التلقائي من",
    "opt_link_none": "بدون (يدوي)",
    "opt_link_project": "مشروع",
    "opt_link_category": "فئة",
    "opt_link_habit": "عادة",
    "field_which": "اختر العنصر",
    "goal_auto_hint": "يُحتسب التقدم تلقائيًا من المهام المنجزة أو تسجيلات العادات خلال الأسبوع أو الشهر الحالي — لا حاجة لتحديثه يدويًا.",
    "goal_on_track": "على المسار الصحيح",
    "goal_behind": "متأخر عن الوتيرة",
    "goal_auto_badge": "تلقائي",
    "review_no_goals": "لا توجد أهداف بعد — أضف هدفًا لتتبعه هنا.",
    "review_no_habits": "لا توجد عادات متتبَّعة بعد.",
    "review_this_week": "هذا الأسبوع",
    "review_last_week": "الأسبوع الماضي",
    "review_no_lb": "سجّل يومًا في توازن الحياة لترى متوسطك الأسبوعي هنا.",
    "review_lb_avg": "متوسط النقاط لآخر 7 أيام",
    "focus_great": "كل شيء يسير جيدًا هذا الأسبوع — واصل هكذا.",
    "focus_goal": "هدفك \"{name}\" متأخر عن الوتيرة — امنحه بعض الاهتمام هذا الأسبوع.",
    "focus_habit": "عادتك \"{name}\" تراجعت — حاول تسجيلها اليوم.",
    "focus_lb": "مؤشر توازن حياتك منخفض هذا الأسبوع — يستحق الانتباه.",
    "todays_focus_title": "تركيز اليوم",
    "todays_focus_all_clear": "لا شيء عاجل اليوم — أحسنت.",
    "focus_tag_overdue": "متأخرة",
    "focus_tag_due_today": "تستحق اليوم",
    "focus_tag_goal": "هدف",
    "focus_tag_habit": "عادة",
    "focus_do_task_for_goal": "\"{task}\" — تدفع هدف \"{goal}\" للأمام",
    "focus_checkin_habit": "سجّل \"{habit}\" — يُبقي هدف \"{goal}\" على المسار",
    "focus_update_goal": "حدّث \"{goal}\" — إنه متأخر عن الوتيرة",
    "achievements_title": "الإنجازات",
    "achievements_subtitle": "إنجازات مكتسبة من نشاطك الفعلي — لا شراء ولا تزييف.",
    "badge_first_task": "الخطوة الأولى",
    "badge_first_task_hint": "أنجز مهمتك الأولى",
    "badge_ten_tasks": "إنجاز متواصل",
    "badge_ten_tasks_hint": "أنجز 10 مهام",
    "badge_fifty_tasks": "خمسون مهمة",
    "badge_fifty_tasks_hint": "أنجز 50 مهمة",
    "badge_hundred_tasks": "نادي المئة",
    "badge_hundred_tasks_hint": "أنجز 100 مهمة",
    "badge_streak_3": "في تقدم",
    "badge_streak_3_hint": "سلسلة إنجاز 3 أيام",
    "badge_streak_7": "عزيمة لا تتوقف",
    "badge_streak_7_hint": "سلسلة إنجاز 7 أيام",
    "badge_streak_14": "إنجاز بلا انقطاع",
    "badge_streak_14_hint": "أفضل سلسلة 14 يومًا على الإطلاق",
    "badge_goal_getter": "محقق الأهداف",
    "badge_goal_getter_hint": "حقق 100% في هدف",
    "badge_habit_builder": "بنّاء العادات",
    "badge_habit_builder_hint": "سلسلة 7 أيام في عادة",
    "badge_challenger": "المتحدي",
    "badge_challenger_hint": "اربح تحديًا",
    "badge_balanced_life": "حياة متوازنة",
    "badge_balanced_life_hint": "حقق 85+ في توازن الحياة",
    "new_badge_toast": "إنجاز جديد: {name}! 🏆",
    "notif_digest_title": "تذكيرات اليوم",
    "notif_digest_overdue": "{n} متأخرة",
    "notif_digest_due": "{n} تستحق اليوم",
    "notif_digest_goals": "{n} هدف متأخر عن الوتيرة",
    "field_remind_me": "ذكّرني",
    "opt_remind_none": "بدون تذكير",
    "opt_remind_attime": "في نفس الوقت",
    "opt_remind_10": "قبل 10 دقائق",
    "opt_remind_30": "قبل 30 دقيقة",
    "opt_remind_60": "قبل ساعة",
    "opt_remind_1440": "قبل يوم",
    "event_reminder_title": "تذكير: {title}",
    "event_reminder_body_meeting": "الاجتماع يبدأ قريبًا",
    "event_reminder_body_deadline": "الموعد النهائي يقترب",
    "event_reminder_body_generic": "موعد قريب",
    "field_important_alarm": "تنبيه مهم",
    "btn_snooze": "تأجيل لمدة 5 دقائق",
    "btn_dismiss": "إغلاق",
    "alarm_snoozed": "تم تأجيل التنبيه لمدة 5 دقائق",
    "Dashboard": "لوحة التحكم",
    "My Day": "يومي",
    "Kanban Board": "لوحة كانبان",
    "Projects": "المشاريع",
    "Goals": "الأهداف",
    "Habits": "العادات",
    "Notes": "الملاحظات",
    "Progress": "نسبة الإنجاز",
    "Archive": "أرشفة",
    "Pomodoro Timer": "مؤقت بومودورو",
    "Categories": "الفئات",
    "done": "منجز",
    "All Projects": "كل المشاريع",
    "All Owners": "كل المكلفين",
    "All": "الكل",
    "Username": "اسم المستخدم",
    "To Do": "قيد الانتظار",
    "In Progress": "قيد التنفيذ",
    "Done": "منجزة",
    "High": "عالية",
    "Medium": "متوسطة",
    "Low": "منخفضة",
    "Priority": "الأولوية",
    "Delete": "حذف",
    "New Event": "حدث جديد",
    "Completed": "الفترات المكتملة",
    "Do First": "نفّذ أولًا",
    "Schedule": "جدولها لاحقًا",
    "Delegate": "فوّضها",
    "Eliminate": "استبعدها",
    "Tasks Completed": "المهام المنجزة",
    "Description": "الوصف",
    "Category": "الفئة",
    "No Project": "بدون مشروع",
    "Owner": "المسؤول",
    "Unassigned": "غير مسند",
    "Urgent & Important": "عاجل ومهم",
    "No recurrence": "بدون تكرار",
    "Due Date": "تاريخ الاستحقاق",
    "Status": "الحالة",
    "Est. Hours": "الساعات المقدرة",
    "Logged Hours": "الساعات المسجلة",
    "Note": "ملاحظة",
    "Create Task": "إنشاء المهمة",
    "Not configured": "لم يتم الإعداد",
    "Edit": "تعديل",
    "Up to date": "تمت المزامنة",
    "Required for Google Sheets sync": "مطلوب للمزامنة مع جداول بيانات جوجل",
    "English": "العربية",
    "Clear": "مسح",
    "Hours Logged": "الساعات المسجلة",
    "Habit Check-ins": "مرات ممارسة العادات",
    "Start Challenge": "ابدأ التحدي",
    "Preview will appear here...": "ستظهر المعاينة هنا...",
    "Welcome to TaskFlow Pro!": "مرحبًا بك في تاسك فلو برو!",
    "Overdue": "متأخرة",
    "Please sign in again": "يرجى تسجيل الدخول مجددًا",
    "Session changed": "تغيّرت جلسة تسجيل الدخول",
    "API not configured": "لم يتم إعداد الاتصال بقاعدة بيانات الحساب",
    "Account changed": "تم تغيير الحساب",
    "Cannot reach the account database": "تعذّر الاتصال بقاعدة بيانات الحساب",
    "Request failed (": "تعذّر إتمام الطلب (",
    "Not signed in to the account database": "لم يتم تسجيل الدخول إلى قاعدة بيانات الحساب",
    "Browser storage is full or unavailable. Export a backup and free space before saving.": "مساحة تخزين المتصفح ممتلئة أو غير متاحة. صدّر نسخة احتياطية ووفّر مساحة قبل الحفظ.",
    "Sync conflict: local changes retained. Export a backup before resolving with the other device.": "تعارض في المزامنة: تم الاحتفاظ بالتغييرات المحلية. صدّر نسخة احتياطية قبل حل التعارض مع الجهاز الآخر.",
    "Wait for synchronization to finish": "انتظر حتى تكتمل المزامنة",
    "No queued changes": "لا توجد تغييرات تنتظر المزامنة",
    "Both versions have been downloaded as a backup. Type LOCAL to keep this device?s queued changes, or SERVER to replace those sections with the server copy. Cancel leaves everything unchanged.": "تم تنزيل النسختين للاحتفاظ بنسخة احتياطية. اكتب LOCAL للاحتفاظ بتغييرات هذا الجهاز، أو SERVER لاستبدال الأقسام المعنية بنسخة الخادم. اختر إلغاء لترك البيانات كما هي.",
    "Offline": "غير متصل",
    " change(s) waiting to sync": " من التغييرات تنتظر المزامنة",
    " change(s) queued": " من التغييرات في قائمة الانتظار",
    " — will sync when back online": " — ستتم المزامنة عند عودة الاتصال",
    "Syncing...": "جارٍ المزامنة…",
    "Account Database (API) URL:": "رابط واجهة برمجة تطبيقات قاعدة بيانات الحساب:",
    "Enter a valid HTTP or HTTPS API URL": "أدخل رابطًا صالحًا لواجهة برمجة التطبيقات يبدأ بـ HTTP أو HTTPS",
    "Account database URL updated — log out and back in to switch accounts to it": "تم تحديث رابط قاعدة بيانات الحساب — سجّل الخروج ثم الدخول للاتصال بقاعدة البيانات الجديدة",
    "Set an Account Database URL first": "حدّد رابط قاعدة بيانات الحساب أولًا",
    "Testing...": "جارٍ الاختبار…",
    "Account database reachable": "تم الاتصال بقاعدة بيانات الحساب بنجاح",
    "Configured — reachable": "تم الإعداد — الاتصال متاح",
    "Account database not ready": "قاعدة بيانات الحساب غير جاهزة",
    "Configured — not ready": "تم الإعداد — الخدمة غير جاهزة",
    "Cannot reach account database": "تعذّر الاتصال بقاعدة بيانات الحساب",
    "Configured — unreachable": "تم الإعداد — تعذّر الاتصال",
    "Username must be 3-32 characters: letters, numbers, and underscores only": "يجب أن يتكوّن اسم المستخدم من 3 إلى 32 محرفًا: حروف إنجليزية أو أرقام أو شرطة سفلية فقط",
    "Password must be at least 6 characters": "يجب ألا تقل كلمة المرور عن 6 محارف",
    "No account database configured. Set an Account Database URL in Settings first.": "لم يتم إعداد قاعدة بيانات الحساب. حدّد رابطها في الإعدادات أولًا.",
    "Can't reach the account database. Check the Account Database URL in Settings, or make sure the API is running.": "تعذّر الاتصال بقاعدة بيانات الحساب. راجع رابطها في الإعدادات وتأكد من تشغيل الخدمة.",
    "Sign in failed.": "تعذّر تسجيل الدخول.",
    "continue offline": "المتابعة دون اتصال",
    " with your last synced data.": " باستخدام آخر بيانات تمت مزامنتها.",
    "Untitled Task": "مهمة بلا عنوان",
    "Untitled Project": "مشروع بلا اسم",
    "Untitled Goal": "هدف بلا عنوان",
    "Untitled Habit": "عادة بلا اسم",
    "Untitled Note": "ملاحظة بلا عنوان",
    "Backup must be a JSON object": "يجب أن تكون النسخة الاحتياطية كائنًا بتنسيق JSON",
    "No supported backup sections": "لا تتضمن النسخة الاحتياطية أقسامًا مدعومة",
    " must be an array with at most ": " يجب أن يكون قائمة لا يتجاوز عدد سجلاتها ",
    " records": " سجلًا",
    "Invalid ": "غير صالح: ",
    " record": " — سجل",
    "Invalid or duplicate ": "غير صالح أو مكرر: ",
    " ID": " — معرّف",
    "Undo": "تراجع",
    "No comments yet": "لا توجد تعليقات بعد",
    "Next copy after completion: ": "موعد النسخة التالية بعد الإنجاز: ",
    "Commented on \"": "أُضيف تعليق على «",
    "Title required (maximum 200 characters)": "أدخل عنوانًا لا يتجاوز 200 محرف",
    "Complete dependencies first": "أنجز المهام التي تعتمد عليها هذه المهمة أولًا",
    "Updated: \"": "تم التحديث: «",
    "Created: \"": "تم الإنشاء: «",
    "Deleted: \"": "تم الحذف: «",
    "Reopened: \"": "أُعيد فتح: «",
    "Completed: \"": "تم الإنجاز: «",
    "Archived: \"": "تمت الأرشفة: «",
    "Restored: \"": "تمت الاستعادة: «",
    "Task updated": "تم تحديث المهمة",
    "Task created": "تم إنشاء المهمة",
    "Delete Task?": "هل تريد حذف المهمة؟",
    "\" will be deleted.": "» سيتم حذفها.",
    "Task deleted": "تم حذف المهمة",
    "Task restored": "تمت استعادة المهمة",
    "Blocked by ": "يتوقف إنجازها على ",
    " dependencies": " من المهام السابقة",
    "Task completed! &#127881;": "تم إنجاز المهمة! 🎉",
    "Task archived": "تمت أرشفة المهمة",
    "Restored": "تمت الاستعادة",
    "Archive cleared": "تم إفراغ الأرشيف",
    "Clear Archive?": "هل تريد إفراغ الأرشيف؟",
    "All archived tasks will be permanently deleted.": "سيتم حذف جميع المهام المؤرشفة نهائيًا.",
    "Archive is empty": "الأرشيف فارغ",
    "Archived tasks appear here": "تظهر المهام المؤرشفة هنا",
    "Archived ": "تمت الأرشفة ",
    "Restore": "استعادة",
    "Deleted ": "تم حذف ",
    " tasks": " من المهام",
    " deleted": " — تم الحذف",
    "Delete ": "هل تريد حذف ",
    " tasks?": " من المهام؟",
    "Cannot be undone.": "لا يمكن التراجع عن هذا الإجراء.",
    "Delete All": "حذف الكل",
    " archived": " — تمت الأرشفة",
    " updated": " — تم التحديث",
    "Total": "الإجمالي",
    "Sun": "الأحد",
    "Mon": "الاثنين",
    "Tue": "الثلاثاء",
    "Wed": "الأربعاء",
    "Thu": "الخميس",
    "Fri": "الجمعة",
    "Sat": "السبت",
    "Less ": "أقل ",
    " More": " أكثر",
    "No deadlines": "لا توجد مواعيد استحقاق",
    "No goals set": "لم تُحدّد أهداف بعد",
    "No habits tracked": "لم تُضَف عادات للمتابعة",
    "No activity": "لا يوجد نشاط بعد",
    "No tasks found": "لا توجد مهام مطابقة",
    "Press Q for quick add": "اضغط على مفتاح Q لإضافة مهمة بسرعة",
    "blocked": "بانتظار مهام أخرى",
    "Timer": "المؤقت",
    "Empty": "لا توجد مهام",
    "Moved \"": "تم نقل «",
    "\" to ": "» إلى ",
    "Moved": "تم النقل",
    "Edit Event": "تعديل الحدث",
    "Please enter a title": "يرجى إدخال عنوان",
    "Please select a date": "يرجى اختيار تاريخ",
    "Event updated": "تم تحديث الحدث",
    "Event created": "تم إنشاء الحدث",
    "Event deleted": "تم حذف الحدث",
    "January": "يناير",
    "February": "فبراير",
    "March": "مارس",
    "April": "أبريل",
    "May": "مايو",
    "June": "يونيو",
    "July": "يوليو",
    "August": "أغسطس",
    "September": "سبتمبر",
    "October": "أكتوبر",
    "November": "نوفمبر",
    "December": "ديسمبر",
    "Other": "أخرى",
    "Completion": "نسبة الإنجاز",
    "Streak": "أيام الإنجاز المتتالية",
    "day": "يوم",
    "Metrics": "المؤشرات",
    "Avg Completion": "متوسط مدة الإنجاز",
    "No data": "لا توجد بيانات",
    "Burndown (7 days)": "المهام المتبقية خلال 7 أيام",
    "Add due dates to see timeline": "أضف مواعيد استحقاق لعرض المخطط الزمني",
    "Morning": "الصباح",
    "Afternoon": "بعد الظهر",
    "Evening": "المساء",
    "No tasks": "لا توجد مهام",
    "Today's Tasks": "مهام اليوم",
    "Remaining": "متبقية",
    "&#9728; Morning": "&#9728; الصباح",
    "&#9788; Afternoon": "&#9788; بعد الظهر",
    "&#9790; Evening": "&#9790; المساء",
    "No tasks available": "لا توجد مهام متاحة",
    "Added to My Day": "تمت الإضافة إلى يومي",
    "Today &bull; ": "اليوم &bull; ",
    "Scheduled": "المجدول",
    "Planned Hours": "الساعات المخططة",
    "Free Hours": "الساعات المتاحة",
    "Unscheduled": "غير المجدول",
    "Everything fits today &#127881;": "يتّسع جدول اليوم لجميع المهام &#127881;",
    "No Projects": "لا توجد مشاريع",
    "Create your first project": "أنشئ مشروعك الأول",
    "Create Project": "إنشاء مشروع",
    "Project name required": "يرجى إدخال اسم المشروع",
    "Project saved": "تم حفظ المشروع",
    "Delete this project?": "هل تريد حذف هذا المشروع؟",
    "Project deleted": "تم حذف المشروع",
    "Not Urgent & Important": "مهم وغير عاجل",
    "Urgent & Not Important": "عاجل وغير مهم",
    "Not Urgent & Not Important": "غير عاجل وغير مهم",
    "No urgent & important tasks": "لا توجد مهام عاجلة ومهمة",
    "No tasks to schedule": "لا توجد مهام لجدولتها",
    "No tasks to delegate": "لا توجد مهام لتفويضها",
    "Nothing to eliminate": "لا توجد مهام لاستبعادها",
    "Moved to ": "تم النقل إلى ",
    "No Goals": "لا توجد أهداف",
    "Set your first goal": "حدّد هدفك الأول",
    "Create Goal": "إنشاء هدف",
    "No habits yet": "لا توجد عادات بعد",
    "No projects yet": "لا توجد مشاريع بعد",
    "No categories yet": "لا توجد فئات بعد",
    "Goal title required": "يرجى إدخال عنوان الهدف",
    "Goal saved": "تم حفظ الهدف",
    "Delete this goal?": "هل تريد حذف هذا الهدف؟",
    "Goal deleted": "تم حذف الهدف",
    "No Habits": "لا توجد عادات",
    "Start tracking a habit": "ابدأ بمتابعة عادة",
    "Create Habit": "إنشاء عادة",
    "Habit name required": "يرجى إدخال اسم العادة",
    "Habit saved": "تم حفظ العادة",
    "Delete this habit?": "هل تريد حذف هذه العادة؟",
    "Habit deleted": "تم حذف العادة",
    "All Notes": "جميع الملاحظات",
    "Unfiled": "بلا مجلد",
    "No Notes": "لا توجد ملاحظات",
    "Create your first note": "أنشئ ملاحظتك الأولى",
    "Create Note": "إنشاء ملاحظة",
    "Note saved": "تم حفظ الملاحظة",
    "Delete this note?": "هل تريد حذف هذه الملاحظة؟",
    "Note deleted": "تم حذف الملاحظة",
    "Unknown": "غير معروف",
    "Total Logged": "إجمالي الساعات المسجلة",
    "hours across ": "عدد الساعات موزعًا على المهام: ",
    "Hours by Category": "الساعات حسب الفئة",
    "Hours by Project": "الساعات حسب المشروع",
    "Hours by Day (Recent)": "الساعات حسب اليوم — مؤخرًا",
    "Sleep": "النوم",
    "Work": "العمل",
    "Study": "الدراسة",
    "Exercise": "النشاط البدني",
    "Social": "التواصل الاجتماعي",
    "Leisure": "وقت الفراغ",
    "Optimal": "مثالي",
    "Good": "جيد",
    "Caution": "يحتاج إلى انتباه",
    "Too Low": "أقل من الموصى به",
    "Too High": "أعلى من الموصى به",
    "None Logged": "لم يُسجّل وقت",
    "Not Scored": "غير مشمول بالتقييم",
    "Within the 7–9h adult range recommended by sleep-health guidelines.": "ضمن نطاق النوم الموصى به للبالغين، من 7 إلى 9 ساعات.",
    "Slightly under the recommended 7–9h — occasional, not chronic, is the goal.": "أقل قليلًا من المدة الموصى بها، من 7 إلى 9 ساعات. يُفضّل ألا يصبح نقص النوم عادة مستمرة.",
    "Slightly over 9h — fine occasionally; consistently needing this much can also signal poor sleep quality.": "أكثر قليلًا من 9 ساعات. قد يحدث ذلك أحيانًا، لكن الحاجة المستمرة إلى هذه المدة قد تشير إلى ضعف جودة النوم.",
    "Well under the recommended range; chronic short sleep is linked to impaired cognition, mood and long-term health risk.": "أقل بكثير من المدة الموصى بها. يرتبط نقص النوم المزمن بضعف القدرات الذهنية واضطراب المزاج ومخاطر صحية على المدى الطويل.",
    "Well over the typical range; if this is a consistent pattern it may be worth discussing with a doctor.": "أعلى بكثير من المدة المعتادة. إذا استمر هذا النمط، فقد يكون من المناسب مناقشته مع طبيب.",
    "Meets/exceeds the ~30 min/day average implied by WHO’s 150–300 min/week guideline.": "يبلغ أو يتجاوز متوسط نحو 30 دقيقة يوميًا، استنادًا إلى توصية منظمة الصحة العالمية بممارسة النشاط لمدة 150 إلى 300 دقيقة أسبوعيًا.",
    "Below the general 150 min/week guideline, but still more than none — worth building on.": "أقل من التوصية العامة البالغة 150 دقيقة أسبوعيًا، لكنه أفضل من عدم النشاط. حاول زيادته تدريجيًا.",
    "Well below recommended activity levels for cardiovascular and mental-health benefits.": "أقل بكثير من مستويات النشاط الموصى بها لصحة القلب والأوعية الدموية والصحة النفسية.",
    "No activity logged. Even short daily movement has measurable health benefits.": "لم يُسجّل نشاط بدني. حتى الحركة اليومية لفترات قصيرة لها فوائد صحية قابلة للقياس.",
    "Discretionary time in the range associated with peak subjective well-being (highest around ~2h).": "وقت الفراغ ضمن النطاق المرتبط بأعلى مستويات الشعور بالرضا، وتبلغ ذروته نحو ساعتين.",
    "Very little discretionary time is associated with feeling time-starved and lower well-being.": "يرتبط وقت الفراغ القليل جدًا بالشعور بضيق الوقت وانخفاض الرضا عن الحياة.",
    "Large amounts of unstructured time show diminishing (sometimes slightly negative) well-being returns unless spent purposefully.": "تقل فوائد وقت الفراغ الطويل غير المنظّم، وقد تؤثر سلبًا بدرجة بسيطة في الرضا عن الحياة، ما لم يُستثمر في أنشطة ذات معنى.",
    "Meaningful social contact is one of the strongest predictors of long-term well-being.": "التواصل الاجتماعي الهادف من أقوى العوامل المرتبطة بالرضا عن الحياة على المدى الطويل.",
    "Some connection logged, but more consistent social time is consistently linked to better outcomes.": "تم تسجيل بعض الوقت للتواصل، لكن الانتظام في التواصل الاجتماعي يرتبط بنتائج أفضل.",
    "No social time logged. Isolation is an established risk factor for both mental and physical health.": "لم يُسجّل وقت للتواصل الاجتماعي. العزلة من عوامل الخطر المعروفة للصحة النفسية والجسدية.",
    "No study time logged today — not scored, since not everyone studies daily.": "لم يُسجّل وقت للدراسة اليوم. لا يُحتسب في التقييم لأن الدراسة اليومية لا تنطبق على الجميع.",
    "Within the range where focused cognitive work stays sustainable (deliberate-practice research puts the ceiling near 4h/day even for experts).": "ضمن نطاق العمل الذهني المركّز الذي يمكن الاستمرار فيه. تشير أبحاث التدريب المتعمّد إلى حد يقارب 4 ساعات يوميًا، حتى لدى الخبراء.",
    "Above the range associated with sustained peak performance — make sure real breaks are built in.": "أعلى من النطاق المرتبط باستمرار الأداء المرتفع. احرص على أخذ فترات راحة فعلية.",
    "Sustained high cognitive load without recovery is linked to diminishing returns and burnout risk.": "يرتبط الجهد الذهني المرتفع المستمر دون راحة بتراجع الفائدة وزيادة خطر الإنهاك.",
    "No work hours logged in the past 7 days.": "لم تُسجّل ساعات عمل خلال الأيام السبعة الماضية.",
    "At or under the standard 40h/week.": "ضمن المعدل المعتاد البالغ 40 ساعة أسبوعيًا أو أقل.",
    "Above standard full-time hours; sustained overwork in this range carries rising health risk.": "أعلى من ساعات العمل المعتادة للدوام الكامل. استمرار العمل الزائد ضمن هذا النطاق يرتبط بزيادة المخاطر الصحية.",
    "Above 55h/week — a WHO/ILO joint study linked this level to a 35% higher stroke risk and 17% higher risk of fatal ischemic heart disease versus 35–40h/week.": "أكثر من 55 ساعة أسبوعيًا. ربطت دراسة مشتركة لمنظمتي الصحة العالمية والعمل الدولية هذا المستوى بزيادة خطر السكتة الدماغية بنسبة 35٪ والوفاة بسبب مرض القلب الإقفاري بنسبة 17٪، مقارنة بالعمل من 35 إلى 40 ساعة أسبوعيًا.",
    "— logged ": "— تم تسجيل ",
    "h, that’s more than 24h in a day, adjust your entries": " ساعة، وهو أكثر من 24 ساعة في اليوم. يرجى تعديل القيم",
    "h logged, ": " ساعة مسجلة، و",
    "h unaccounted for (commute, meals, chores, etc.)": " ساعة غير مسجلة (التنقل والوجبات والأعمال المنزلية وغيرها)",
    "Work (weekly)": "العمل خلال الأسبوع",
    "Not enough data": "لا توجد بيانات كافية",
    "Excellent balance": "توازن ممتاز",
    "Good balance": "توازن جيد",
    "Needs attention": "يحتاج إلى اهتمام",
    "Poor balance": "توازن ضعيف",
    "Composite of sleep, exercise, leisure, social and weekly work-hour scores against the sources below. Study time is shown for reflection but not included, since there’s no universal healthy amount.": "مؤشر يجمع تقييم النوم والنشاط البدني ووقت الفراغ والتواصل الاجتماعي وساعات العمل الأسبوعية بالاستناد إلى المصادر أدناه. يُعرض وقت الدراسة للمراجعة دون احتسابه في المؤشر، إذ لا توجد مدة صحية موحّدة تناسب الجميع.",
    "h over last ": " ساعة خلال آخر ",
    " logged day(s)": " من الأيام المسجلة",
    "These are population-level research findings used as reflection benchmarks, not individualized medical advice. Needs vary by age, health status and personal circumstances.": "هذه نتائج أبحاث على مستوى السكان تُستخدم مرجعًا للمراجعة الشخصية، وليست نصائح طبية فردية. تختلف الاحتياجات بحسب العمر والحالة الصحية والظروف الشخصية.",
    "Day Completion Streak": "أيام الإنجاز المتتالية",
    " day": " يوم",
    "-day window": " يومًا — مدة التحدي",
    "Challenge started": "بدأ التحدي",
    "Challenge started &mdash; beat your record!": "بدأ التحدي — حطّم رقمك القياسي!",
    "No activity logged yet &mdash; complete tasks, check off habits, or log a Life Balance day to see your trend.": "لا يوجد نشاط مسجل بعد — أنجز مهام، أو سجّل ممارسة عاداتك، أو أضف يومًا في توازن الحياة لعرض تطور نشاطك.",
    "No habits tracked yet": "لم تُضَف عادات للمتابعة بعد",
    "No challenges yet &mdash; start one below or create your own.": "لا توجد تحديات بعد — ابدأ أحد التحديات أدناه أو أنشئ تحديًا خاصًا بك.",
    "&#127942; Completed": "&#127942; مكتمل",
    "Ended": "انتهى",
    "Active": "جارٍ",
    "Remove": "إزالة",
    "Your best 7-day run: ": "أفضل إنجاز لك خلال 7 أيام: ",
    "h logged": " ساعة مسجلة",
    "Your longest-ever streak: ": "أطول سلسلة إنجاز لك: ",
    "Your longest-ever habit streak: ": "أطول سلسلة مواظبة على عادة: ",
    "Challenge complete: ": "اكتمل التحدي: ",
    "Activity Score Today": "مؤشر النشاط اليوم",
    "Current Streak": "أيام الإنجاز المتتالية الحالية",
    "Best Streak Ever": "أطول سلسلة إنجاز",
    "Challenges": "التحديات",
    "-- Select Task --": "— اختر مهمة —",
    "Work Session": "جلسة عمل",
    "Break Time": "فترة راحة",
    "Work session complete! Take a break.": "اكتملت جلسة العمل! حان وقت الراحة.",
    "Break over! Start working.": "انتهت الاستراحة! ابدأ جلسة العمل.",
    "No task selected": "لم تُحدّد مهمة",
    "Time logged to ": "تم تسجيل الوقت للمهمة: ",
    "Reminder: ": "تذكير: ",
    "Task \"": "المهمة «",
    "\" is due!": "» حان موعدها!",
    "Push notifications disabled on this browser": "تم تعطيل الإشعارات الفورية في هذا المتصفح",
    "Could not disable push: ": "تعذّر تعطيل الإشعارات الفورية: ",
    "Add categories to tasks to filter here": "أضف فئات إلى المهام لتصفيتها من هنا",
    "No results": "لا توجد نتائج",
    "Created \"": "تم إنشاء «",
    "Template name:": "اسم القالب:",
    "Select tasks first": "حدّد المهام أولًا",
    "Template saved": "تم حفظ القالب",
    "Use": "استخدام",
    "No templates": "لا توجد قوالب",
    "Template applied": "تم تطبيق القالب",
    "Template deleted": "تم حذف القالب",
    "Filter name:": "اسم عامل التصفية:",
    "Filter saved": "تم حفظ عامل التصفية",
    "Apply": "تطبيق",
    "No saved filters": "لا توجد عوامل تصفية محفوظة",
    "Filter applied": "تم تطبيق عامل التصفية",
    "Filter deleted": "تم حذف عامل التصفية",
    "Excel library not loaded": "لم يتم تحميل مكتبة إكسل",
    "No users found": "لم يتم العثور على مستخدمين",
    "Info": "معلومات",
    "No tasks for this user": "لا توجد مهام لهذا المستخدم",
    "Excel exported with ": "تم تصدير ملف إكسل بعدد أوراق للمستخدمين: ",
    " user sheet(s)": "",
    "Tasks": "المهام",
    "Invalid JSON: ": "ملف JSON غير صالح: ",
    "Backup imported": "تم استيراد النسخة الاحتياطية",
    "Import was not saved. Free browser storage and try again.": "لم يُحفَظ الاستيراد. وفّر مساحة في تخزين المتصفح ثم حاول مجددًا.",
    "Google Apps Script URL:": "رابط برمجة تطبيقات جوجل:",
    "Set Apps Script URL first": "حدّد رابط برمجة تطبيقات جوجل أولًا",
    "Set Sync Token first": "أدخل رمز المزامنة أولًا",
    "Sync token from Apps Script Properties:": "رمز المزامنة من خصائص برمجة التطبيقات:",
    "Configured": "تم الإعداد",
    "Configured for this account": "تم الإعداد لهذا الحساب",
    "Configured — not signed in": "تم الإعداد — لم يتم تسجيل الدخول",
    "Configured — signed in": "تم الإعداد — تم تسجيل الدخول",
    "Last synced ": "آخر مزامنة: ",
    "Ready, not synced yet": "جاهز، لم تتم المزامنة بعد",
    "Delete ALL synced data for this account? This cannot be undone!": "هل تريد حذف جميع البيانات المتزامنة لهذا الحساب؟ لا يمكن التراجع عن هذا الإجراء!",
    "Deletion queued; waiting for synchronization": "تم وضع الحذف في قائمة الانتظار حتى تتم المزامنة",
    "Account data cleared": "تم مسح بيانات الحساب",
    "Could not clear account data: ": "تعذّر مسح بيانات الحساب: ",
    "Your all-in-one task management workspace. Let's take a quick tour.": "مساحة عمل متكاملة لإدارة مهامك. لنبدأ بجولة سريعة.",
    "Quick Add Tasks": "إضافة المهام بسرعة",
    "Press Q anywhere to quickly create a task. Use !high, @category, #tag, ~project syntax.": "اضغط على مفتاح Q لإضافة مهمة بسرعة. استخدم !high للأولوية العالية، و@ متبوعة بالفئة، و# متبوعة بالوسم، و~ متبوعة بالمشروع.",
    "Your overview with stats, charts, activity heatmap, goals, and habits.": "نظرة شاملة على الإحصاءات والرسوم البيانية وخريطة النشاط والأهداف والعادات.",
    "Plan your day with time-blocked tasks and daily notes.": "خطّط ليومك بتوزيع المهام على فترات زمنية وتدوين ملاحظاتك اليومية.",
    "Drag tasks between columns to update status.": "اسحب المهام بين الأعمدة لتحديث حالتها.",
    "Projects & Goals": "المشاريع والأهداف",
    "Organize tasks into projects and track weekly/monthly goals.": "نظّم المهام ضمن مشاريع وتابع أهدافك الأسبوعية والشهرية.",
    "Boost focus with work/break cycles. Click the timer icon on any task.": "عزّز تركيزك بالتناوب بين العمل والراحة. اضغط على أيقونة المؤقت في أي مهمة.",
    "All Set!": "كل شيء جاهز!",
    "You're ready to be productive. Press Escape to dismiss any overlay.": "أنت جاهز للبدء. اضغط على مفتاح الهروب لإغلاق النافذة المفتوحة.",
    "Step ": "الخطوة ",
    " of ": " من ",
    "Sync failed: ": "تعذّرت المزامنة: ",
    "Sync failed": "تعذّرت المزامنة",
    "Testing connection...": "جارٍ اختبار الاتصال…",
    "Sync connection ready": "اتصال المزامنة جاهز",
    "Sync test failed: ": "تعذّر اختبار المزامنة: ",
    "Sync test failed": "تعذّر اختبار المزامنة",
    "Syncing to Google Sheets...": "جارٍ المزامنة مع جداول بيانات جوجل…",
    "Syncing all users to Google Sheets...": "جارٍ مزامنة جميع المستخدمين مع جداول بيانات جوجل…",
    "Local tasks changed since last sync. Pulling will replace them. Continue?": "تغيّرت المهام المحلية منذ آخر مزامنة. سيؤدي جلب البيانات إلى استبدالها. هل تريد المتابعة؟",
    "Pulled ": "تم جلب ",
    "App installed successfully!": "تم تثبيت التطبيق بنجاح!",
    "Open in browser to install": "افتح التطبيق في المتصفح لتثبيته",
    "Installing...": "جارٍ التثبيت…",
    "Resolve sync conflicts": "حل تعارضات المزامنة",
    "TaskFlow Pro": "تاسك فلو برو",
    "TaskFlow Pro — Team Task Monitor": "تاسك فلو برو — متابعة مهام الفريق",
    "overdue_count": "عدد المهام المتأخرة: {n}",
    "selected_count": "عدد المهام المحددة: {n}",
    "streak_days": "أيام متتالية: {n}",
    "hours_value": "{n} ساعة",
    "calendar_tasks": "عدد المهام: {n}",
    "remaining_tasks": "المهام المتبقية: {n}",
    "auto_challenge_streak": "حقّق إنجازًا يوميًا لعدد {n} من الأيام المتتالية",
    "auto_challenge_period": "{unit}: {target} خلال {days} يومًا",
    "Disable push": "تعطيل الإشعارات الفورية",
    "active": "جارية",
    "Password": "كلمة المرور",
    "Search tasks": "البحث في المهام",
    "Search notes": "البحث في الملاحظات",
    "Daily notes": "الملاحظات اليومية",
    "Filter dashboard by date": "تصفية لوحة التحكم حسب التاريخ",
    "Filter dashboard by project": "تصفية لوحة التحكم حسب المشروع",
    "Filter dashboard by owner": "تصفية لوحة التحكم حسب المسؤول",
    "Filter tasks by status": "تصفية المهام حسب الحالة",
    "Filter tasks by priority": "تصفية المهام حسب الأولوية",
    "Filter tasks by category": "تصفية المهام حسب الفئة",
    "Filter tasks by project": "تصفية المهام حسب المشروع",
    "Filter tasks by owner": "تصفية المهام حسب المسؤول",
    "Sort tasks": "ترتيب المهام",
    "Pomodoro work duration in minutes": "مدة جلسة العمل بالدقائق",
    "Pomodoro break duration in minutes": "مدة الاستراحة بالدقائق",
    "Import task backup file": "استيراد ملف النسخة الاحتياطية للمهام",
    "Quick add task": "إضافة مهمة بسرعة",
    "Choose a task to focus on": "اختر مهمة للتركيز عليها",
    "Close": "إغلاق",
    "Excel": "إكسل",
    "offline_login_before": "تعذّر الاتصال بقاعدة بيانات الحساب — ",
    "unchanged": "دون تغيير",
    "ID": "المعرّف",
    "Title": "العنوان",
    "Due": "تاريخ الاستحقاق",
    "Tags": "الوسوم",
    "Created": "تاريخ الإنشاء",
    "Updated": "آخر تحديث",
    "api_forbidden": "ليس لديك إذن لتنفيذ هذا الإجراء",
    "api_not_found": "لم يتم العثور على العنصر المطلوب",
    "api_conflict": "تعارض في البيانات. حدّث البيانات ثم حاول مجددًا.",
    "api_invalid_operation": "تعذّر تنفيذ هذا الإجراء",
    "api_internal_error": "حدث خطأ في الخادم. حاول مجددًا لاحقًا.",
    "api_unauthorized": "بيانات تسجيل الدخول غير صحيحة أو انتهت الجلسة",
    "api_failed": "تعذّر إتمام الطلب. رمز الاستجابة: {status}",
    "Edit Project": "تعديل المشروع",
    "Edit Goal": "تعديل الهدف",
    "Edit Habit": "تعديل العادة",
    "Edit Note": "تعديل الملاحظة",
    "Title is required and must be 200 characters or fewer.": "العنوان مطلوب ويجب ألا يتجاوز 200 محرف.",
    "Username is already taken.": "اسم المستخدم مستخدم بالفعل.",
    "Username already exists": "اسم المستخدم موجود بالفعل",
    "Invalid username.": "اسم المستخدم غير صالح.",
    "Password must be at least 6 characters.": "يجب ألا تقل كلمة المرور عن 6 محارف.",
    "Invalid priority.": "الأولوية غير صالحة.",
    "lb_sources_html": "<p><strong>النوم (7 إلى 9 ساعات):</strong> هيرشكوفيتز وزملاؤه، «توصيات المؤسسة الوطنية للنوم بشأن مدة النوم»، مجلة صحة النوم، 2015؛ وهي متسقة مع إرشادات مراكز مكافحة الأمراض والوقاية منها لنوم البالغين.</p><p><strong>النشاط البدني (150 دقيقة أسبوعيًا على الأقل):</strong> منظمة الصحة العالمية، «إرشادات النشاط البدني والسلوك الخامل»، 2020.</p><p><strong>وقت الفراغ (ذروة الفائدة عند نحو ساعتين، واستقرارها عند نحو 5 ساعات):</strong> شريف وموجيلنر وهيرشفيلد، «يرتبط نقص وقت الفراغ أو زيادته المفرطة بانخفاض الشعور بالرضا عن الحياة»، مجلة علم الشخصية وعلم النفس الاجتماعي، 2021.</p><p><strong>التواصل الاجتماعي:</strong> والدينغر وشولتز، نتائج دراسة هارفارد لنمو البالغين، وهي أطول دراسة طولية مستمرة عن الرضا عن الحياة، كما عُرضت في كتاب «الحياة الجيدة»، 2023.</p><p><strong>الدراسة والعمل المركّز (حد قابل للاستمرار يقارب 4 ساعات):</strong> إريكسون وكرامبه وتيش رومر، «دور التدريب المتعمّد في اكتساب الأداء الخبير»، مجلة المراجعة النفسية، 1993.</p><p><strong>ساعات العمل الأسبوعية (40 ساعة أو أقل للتقييم الأمثل، وأكثر من 55 ساعة لمستوى الخطر المرتفع):</strong> بيغا وزملاؤه، دراسة مشتركة لمنظمتي الصحة العالمية والعمل الدولية، «الأعباء العالمية والإقليمية والوطنية لمرض القلب الإقفاري والسكتة الدماغية المرتبطة بالتعرض لساعات العمل الطويلة»، مجلة البيئة الدولية، 2021.</p>"
  }
};
let lang = localStorage.getItem('taskflow_lang') === 'ar' ? 'ar' : 'en';
function tr(key, values = {}) {
  const template = i18n[lang]?.[key] ?? i18n.en[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
function localizedApiError(message, status) {
  const key = ({forbidden:'api_forbidden',not_found:'api_not_found',conflict:'api_conflict',invalid_operation:'api_invalid_operation',internal_error:'api_internal_error'})[message];
  if(key) return tr(key);
  if(status===401) return tr('api_unauthorized');
  if(Object.hasOwn(i18n[lang],message)) return tr(message);
  return lang==='ar' ? tr('api_failed',{status}) : message;
}
function appLocale() { return lang === 'ar' ? 'ar-EG' : 'en-US'; }
function priorityLabel(value) { return tr('priority_' + value); }
function statusLabel(value) { return tr(({todo:'status_todo','in-progress':'status_inprogress',done:'status_done'})[value] || value); }
function weekdayLabel(date, width = 'short') { return new Intl.DateTimeFormat(appLocale(), {weekday:width}).format(date); }
function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = tr(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = tr(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = tr(el.dataset.i18nHtml); });
  document.querySelectorAll('option[data-i18n-opt]').forEach(el => { el.textContent = tr(el.dataset.i18nOpt); });
  const lbl = document.getElementById('currentLangLabel');
  if (lbl) lbl.textContent = tr('current_lang_label');
  const roleEl = document.getElementById('userRole');
  if (roleEl && currentUser) roleEl.textContent = isAdmin() ? tr('admin') : tr('member');
  document.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', tr(el.dataset.i18nAria)));
  document.getElementById('loginSubmitBtn').textContent=tr(authMode==='login'?'sign_in':'create_account');
  document.getElementById('loginSwitchText').textContent=tr(authMode==='login'?'new_here':'have_account');
  document.getElementById('loginSwitchLink').textContent=tr(authMode==='login'?'switch_to_create':'switch_to_signin');
  setGreeting();
  refreshEditorLabels();
  initAccessibility();
}
function refreshEditorLabels() {
  const labels={projectModalTitle:editingProjectId?'Edit Project':'modal_new_project',goalModalTitle:editingGoalId?'Edit Goal':'modal_new_goal',habitModalTitle:editingHabitId?'Edit Habit':'modal_new_habit',eventModalTitle:editingEventId?'Edit Event':'modal_new_event',ttBlockModalTitle:editingTimetableBlockId?'modal_edit_time_block':'modal_new_time_block'};
  for(const [id,key] of Object.entries(labels)) document.getElementById(id).textContent=tr(key);
  const noteTitle=document.querySelector('#noteEditorModal [data-i18n="modal_new_note"],#noteEditorModal [data-i18n="Edit Note"]');
  if(noteTitle) {noteTitle.dataset.i18n=editingNoteId?'Edit Note':'modal_new_note';noteTitle.textContent=tr(noteTitle.dataset.i18n);}
}
function toggleLang() {
  lang = lang === 'en' ? 'ar' : 'en';
  localStorage.setItem('taskflow_lang', lang);
  updateWorkerLanguage();
  applyLang();
  if(currentUser) refreshAll();
  refreshSettingsStatus();
  updateSyncStatusUI();
  if(document.getElementById('focusOverlay').classList.contains('active')) openPomodoro();
  if(document.getElementById('onboardOverlay').classList.contains('active')) showOnboardStep(onboardIdx);
  if(document.getElementById('templatesModal').classList.contains('active')) openTemplatesModal();
  if(document.getElementById('filtersModal').classList.contains('active')) renderSavedFilters();
  if(document.getElementById('taskModal').classList.contains('active')) {
    const task=loadTasks().find(t=>t.id===editingId);
    document.getElementById('modalTitle').textContent=task?tr('modal_edit_task')+' #'+(task.numId||''):tr('modal_new_task');
    document.getElementById('saveTaskBtn').textContent=tr(task?'btn_save_changes':'btn_create_task');
    const owner=document.getElementById('taskAssigneeInput');const value=owner.value;owner.innerHTML=userOptionHtml();owner.value=value;
    updateRecurringPreview();
  }
  const sources=document.getElementById('lbSources');
  delete sources.dataset.filled;
  if(sources.style.display!=='none') { sources.style.display='none'; toggleLbSources(); }
  if(document.getElementById('noteEditorModal').classList.contains('active')) updateNotePreview();
  initAccessibility();
}

/* ═══════ USER AUTH ═══════ */
let currentUser = null;
function userKey(base) { return base + '_' + (currentUser || 'anon'); }
function isAdmin() { return currentUser === ADMIN_EMAIL; }
const USERNAME_PATTERN = /^\w{3,32}$/;
function toggleAuthMode(){
  authMode = authMode==='login' ? 'register' : 'login';
  document.getElementById('loginSubmitBtn').textContent = authMode==='login' ? tr('sign_in') : tr('create_account');
  document.getElementById('loginSwitchText').textContent = authMode==='login' ? tr('new_here') : tr('have_account');
  document.getElementById('loginSwitchLink').textContent = authMode==='login' ? tr('switch_to_create') : tr('switch_to_signin');
  document.getElementById('loginError').textContent='';
}
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.innerHTML='';
  if (!USERNAME_PATTERN.test(username)) { errEl.textContent = tr("Username must be 3-32 characters: letters, numbers, and underscores only"); return; }
  if (!password || password.length<6) { errEl.textContent = tr("Password must be at least 6 characters"); return; }
  if (!apiConfigured()) { errEl.textContent = tr("No account database configured. Set an Account Database URL in Settings first."); return; }
  const btn=document.getElementById('loginSubmitBtn');
  btn.disabled=true; btn.textContent=tr('please_wait');
  try{
    const result = authMode==='register' ? await apiRegister(username,password) : await apiLogin(username,password);
    saveAuthSession(username, result);
    finishLogin(username);
  }catch(err){
    if(err.isNetworkError){
      const cached=getAuthSession(username);
      if(cached){ errEl.innerHTML=tr('offline_login_before')+'<a href="#" onclick="continueOffline(\''+username+("');return false;\" style=\"color:var(--primary);font-weight:600\">"+tr("continue offline")+"</a>"+tr(" with your last synced data.")+""); }
      else { errEl.textContent=tr("Can't reach the account database. Check the Account Database URL in Settings, or make sure the API is running."); }
    } else {
      errEl.textContent = err.message ? tr(err.message) : tr('Sign in failed.');
    }
  } finally {
    btn.disabled=false; btn.textContent = authMode==='login' ? tr('sign_in') : tr('create_account');
  }
}
function continueOffline(username){ if(getAuthSession(username)) finishLogin(username, true); }
function finishLogin(username, offline){
  currentUser = username;
  localStorage.setItem('taskflow_current_user', username);
  const users = JSON.parse(localStorage.getItem('taskflow_users') || '[]');
  if (!users.includes(username)) { users.push(username); localStorage.setItem('taskflow_users', JSON.stringify(users)); }
  hydrationInFlight=!offline;
  enterApp();
  if(!offline){
    hydrateFromServer().then(refreshAll).catch(()=>{});
  }
}
function doLogout() {
  const session=getAuthSession(currentUser);
  if(session)detachPushSubscription(session.accessToken);
  if(session) apiRaw('/api/auth/logout','POST',{refreshToken:session.refreshToken},false).catch(()=>{});
  clearAuthSession(currentUser);
  closeSettings();
  resetPomoTimer();
  dismissAlarm();
  localStorage.removeItem('taskflow_current_user');
  if(reminderInterval){clearInterval(reminderInterval);reminderInterval=null;}
  focusTaskId=null;
  closeSearch();
  document.querySelectorAll('.modal-overlay,.quick-add-overlay,.focus-overlay').forEach(el=>el.classList.remove('active'));
  currentUser = null;
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}
function enterApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appContainer').style.display = 'flex';
  const name = currentUser.replaceAll(/[._]/g,' ').replaceAll(/\b\w/g,c=>c.toUpperCase());
  document.getElementById('userName').textContent = name;
  document.getElementById('greetUser').textContent = name;
  document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('userRole').textContent = isAdmin() ? tr('admin') : tr('member');
  document.getElementById('settingsEmail').textContent = currentUser;
  document.getElementById('adminSyncSetting').style.display = isAdmin() ? 'flex' : 'none';
  refreshSettingsStatus();
  loadPomodoroSettings();
  ensureNumIds();
  initTheme(); applyLang(); setGreeting(); refreshAll();
  checkOnboarding(); processRecurring(); startReminderCheck();
  if(apiConfigured()&&getAuthSession(currentUser)) startSyncHeartbeat();
  else updateSyncStatusUI();
  if('Notification' in globalThis && Notification.permission==='granted') subscribeToPush();
}
function checkAutoLogin() {
  const saved = localStorage.getItem('taskflow_current_user');
  if (!saved || !getAuthSession(saved)) return;
  currentUser = saved;
  hydrationInFlight=true;
  enterApp();
  if(apiConfigured()&&getAuthSession(saved)){
    hydrateFromServer().then(refreshAll).catch(()=>{});
  }
}

/* ═══════ DATA LAYER ═══════ */
function loadTasks() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_tasks'))) || []; } catch { return []; } }
function reminderUtc(value){const date=new Date(value);return value&&!Number.isNaN(date.getTime())?date.toISOString():null;}
function saveTasks(tasks) { tasks=tasks.map(t=>({...t,reminderUtc:reminderUtc(t.reminder)})); persistData(userKey('taskflow_tasks'), JSON.stringify(tasks)); }
function loadActivity() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_activity'))) || []; } catch { return []; } }
function saveActivity(list) { persistData(userKey('taskflow_activity'), JSON.stringify(list.slice(0, 80))); }
function activityLabel(text) {
  // Translate only recognized system-generated prose; preserve the task title verbatim.
  const prefixes=['Commented on "','Updated: "','Created: "','Deleted: "','Reopened: "','Completed: "','Archived: "','Restored: "','Created "'];
  for(const key of prefixes) {
    for(const sourceLang of ['en','ar']) {
      const prefix=i18n[sourceLang][key] || key;
      if(text.startsWith(prefix)) return tr(key)+text.slice(prefix.length);
    }
  }
  const moved=text.match(/^Moved "([\s\S]*)" to (todo|in-progress|done)$/);
  if(moved) return tr('Moved "')+moved[1]+tr('" to ')+statusLabel(moved[2]);
  const deleted=text.match(/^Deleted (\d+) tasks$/);
  if(deleted) return tr('Deleted ')+deleted[1]+tr(' tasks');
  return text;
}
function addActivity(text, type='info') { const l = loadActivity(); l.unshift({text,type,time:Date.now()}); saveActivity(l); }
function loadArchive() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_archive'))) || []; } catch { return []; } }
function saveArchive(list) { persistData(userKey('taskflow_archive'), JSON.stringify(list)); }
function loadTemplates() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_templates'))) || []; } catch { return []; } }
function saveTemplates(t) { persistData(userKey('taskflow_templates'), JSON.stringify(t)); }
function loadFilters() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_filters'))) || []; } catch { return []; } }
function saveFilters(f) { persistData(userKey('taskflow_filters'), JSON.stringify(f)); }
function loadProjects() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_projects'))) || []; } catch { return []; } }
function saveProjects(p) { persistData(userKey('taskflow_projects'), JSON.stringify(p)); }
function loadGoals() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_goals'))) || []; } catch { return []; } }
function saveGoals(g) { persistData(userKey('taskflow_goals'), JSON.stringify(g)); }
function loadHabits() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_habits'))) || []; } catch { return []; } }
function saveHabits(h) { persistData(userKey('taskflow_habits'), JSON.stringify(h)); }
function loadNotes() { try { return JSON.parse(localStorage.getItem(userKey('taskflow_notes'))) || []; } catch { return []; } }
function saveNotes(n) { persistData(userKey('taskflow_notes'), JSON.stringify(n)); }
function loadUsers() { return currentUser ? [currentUser] : []; }
function getUserLabel(email) {
  const clean=asText(email, 120);
  return clean ? clean.split('@')[0].replaceAll(/[._]/g,' ').replaceAll(/\b\w/g,c=>c.toUpperCase()) : tr("Unassigned");
}
function genId() { return globalThis.crypto.randomUUID(); }
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
    title: asText(t.title, 200) || tr("Untitled Task"),
    description: asText(t.description, 2000),
    status,
    priority: asChoice(t.priority, ['low','medium','high'], 'medium'),
    important: Boolean(t.important),
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
    reminderDismissed: Boolean(t.reminderDismissed),
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
function normalizeProject(p) { return {id:asText(p.id,80)||genId(),name:asText(p.name,100)||tr("Untitled Project"),color:/^#[0-9a-f]{6}$/i.test(p.color||'')?p.color:'#4f46e5',description:asText(p.description,300),createdAt:Number(p.createdAt)||Date.now()}; }
function normalizeGoal(g) { return {id:asText(g.id,80)||genId(),title:asText(g.title,150)||tr("Untitled Goal"),type:asChoice(g.type,['weekly','monthly'],'weekly'),target:Math.max(1,Number.parseInt(g.target)||1),current:Math.max(0,Number.parseInt(g.current)||0),unit:asText(g.unit,30)||'tasks',linkType:asChoice(g.linkType,['','project','category','habit'],''),linkId:asText(g.linkId,80),createdAt:Number(g.createdAt)||Date.now()}; }
/* Goals can either be tracked by hand (linkType '') or auto-tracked from real activity (project/category/habit),
   the same way Challenges already are — closing the gap where Goals used to silently drift from what you actually did. */
function goalPeriodStart(type, from){
  const base=from||todayStr();
  if(type==='monthly') return base.slice(0,8)+'01';
  const dow=new Date(base+'T00:00:00Z').getUTCDay();
  return addDaysToDateStr(base,-dow);
}
function computeGoalProgress(g, tasks, habits){
  tasks=tasks||loadTasks(); habits=habits||loadHabits();
  if(!g.linkType) return {current:g.current||0, target:g.target, pct:Math.min(100,Math.round((g.current||0)/g.target*100)), auto:false};
  const periodStart=goalPeriodStart(g.type);
  let current=0;
  if(g.linkType==='project'||g.linkType==='category'){
    const field=g.linkType==='project'?'project':'category';
    current=tasks.filter(t=>t.status==='done'&&t[field]===g.linkId&&t.completedAt&&dateOfMs(t.completedAt)>=periodStart).length;
  } else if(g.linkType==='habit'){
    const h=habits.find(x=>x.id===g.linkId);
    if(h?.completions) current=Object.keys(h.completions).filter(ds=>h.completions[ds]&&ds>=periodStart&&ds<=todayStr()).length;
  }
  return {current, target:g.target, pct:Math.min(100,Math.round(current/g.target*100)), auto:true};
}
function normalizeHabit(h) { return {id:asText(h.id,80)||genId(),name:asText(h.name,100)||tr("Untitled Habit"),completions:(h.completions&&typeof h.completions==='object')?h.completions:{},createdAt:Number(h.createdAt)||Date.now()}; }
function normalizeNote(n) { return {id:asText(n.id,80)||genId(),title:asText(n.title,150)||tr("Untitled Note"),content:String(n.content??'').slice(0,20000),folder:asText(n.folder,50),pinned:Boolean(n.pinned),createdAt:Number(n.createdAt)||Date.now(),updatedAt:Number(n.updatedAt)||Date.now()}; }
function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(tr("Backup must be a JSON object"));
  const limits={tasks:2000,projects:500,goals:500,habits:500,notes:1000};
  if(!Object.keys(limits).some(k=>k in data)) throw new Error(tr("No supported backup sections"));
  for(const [key,limit] of Object.entries(limits)){
    if(!(key in data)) continue;
    const section=tr(key==='tasks'?'all_tasks':key);
    if(!Array.isArray(data[key])||data[key].length>limit) throw new Error(tr('backup_section_limit',{section,limit}));
    const ids=new Set();
    for(const item of data[key]){
      if(!item||typeof item!=='object'||Array.isArray(item)) throw new Error(tr('backup_invalid_record',{section}));
      if(item.id && (!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)||ids.has(item.id))) throw new Error(tr('backup_invalid_id',{section}));
      if(item.id) ids.add(item.id);
    }
  }
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
let focusElapsedSeconds=0,focusLoggedSeconds=0;
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
  const renderMap = {dashboard:renderDashboard,tasks:renderTasks,kanban:renderKanban,calendar:renderCalendar,timetable:renderTimetable,analytics:renderAnalytics,archive:renderArchive,myday:renderMyDay,projects:renderProjects,eisenhower:renderEisenhower,goals:renderGoals,habits:renderHabits,notes:renderNotes,reports:renderReports,lifebalance:renderLifeBalance,progress:renderProgress,review:renderReview};
  if (renderMap[name]) renderMap[name]();
  applyLang();
}
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function setGreeting() {
  const h = new Date().getHours();
  let key = 'greet_evening'; if (h < 12) { key = 'greet_morning'; } else if (h < 17) { key = 'greet_afternoon'; }
  const el = document.getElementById('greeting');
  if (el) el.textContent = tr(key) + (lang === 'ar' ? '،' : ',');
}

/* ═══════ TOAST ═══════ */
function toast(msg, type='success', undoFn=null) {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  let icon = '&#8505;'; if (type==='success') { icon = '&#10003;'; } else if (type==='error') { icon = '&#10007;'; }
  el.textContent=(type==='error'?'⚠ ':type==='success'?'✓ ':'ℹ ')+tr(msg);
  if(undoFn){const button=document.createElement('button');button.className='undo-btn';button.textContent=tr("Undo");button.addEventListener('click',()=>{undoFn();el.remove();});el.appendChild(button);}
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
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML.replaceAll('\"','&quot;').replaceAll("'",'&#39;'); }
function inlineArg(value){return escHtml(JSON.stringify(value));}
function safeLink(value){return /^https?:\/\//i.test(value||'')?value:'#';}
function fmtDate(d) {
  if(!d) { return ''; }
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(d)?d+'T00:00:00':d).toLocaleDateString(appLocale(),{month:'short',day:'numeric'});
}
function fmtRelative(ts) {
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  const unit = minutes < 60 ? 'minute' : minutes < 1440 ? 'hour' : 'day';
  const value = unit === 'minute' ? minutes : unit === 'hour' ? Math.floor(minutes / 60) : Math.floor(minutes / 1440);
  return new Intl.RelativeTimeFormat(appLocale(), {numeric:'auto'}).format(-value, unit);
}
function isOverdue(t) {
  if(t.status==='done'||!t.due) { return false; }
  return new Date(t.due+'T'+(t.due_time||'23:59:59'))<new Date();
}
function localDateStr(date) { return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'); }
function todayStr() { return localDateStr(new Date()); }
function addDaysToDateStr(dateStr, delta) {
  const d = new Date(dateStr+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+delta);
  return d.toISOString().slice(0,10);
}
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
  const users=[...new Set([currentUser, ...loadUsers(), ...loadTasks().map(t=>t.assignee)].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  return ("<option value=\"\">"+tr("Unassigned")+"</option>") + users.map(email=>'<option value="'+escHtml(email)+'"'+(email===selected?' selected':'')+'>'+escHtml(getUserLabel(email))+'</option>').join('');
}
function populateAssigneeFilter(){
  const users=[...new Set([currentUser, ...loadUsers(), ...loadTasks().map(t=>t.assignee)].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  ['filterAssignee','dashAssigneeFilter'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    const current=el.value||'all';
    el.innerHTML=("<option value=\"all\">"+tr("All Owners")+"</option><option value=\"\">"+tr("Unassigned")+"</option>")+users.map(email=>'<option value="'+escHtml(email)+'">'+escHtml(getUserLabel(email))+'</option>').join('');
    el.value=[...el.options].some(o=>o.value===current)?current:'all';
  });
}

/* ═══════ MODAL ═══════ */
function openModal(id) {
  editingId = id || null;
  tempSubtasks = [];
  const projs = loadProjects();
  document.getElementById('taskProjectInput').innerHTML = ("<option value=\"\">"+tr("No Project")+"</option>") + projs.map(p=>'<option value="'+p.id+'">'+escHtml(p.name)+'</option>').join('');
  document.getElementById('taskAssigneeInput').innerHTML = userOptionHtml();
  const allTasks = loadTasks().filter(x=>x.id!==id);
  document.getElementById('taskDepsInput').innerHTML = allTasks.map(x=>'<option value="'+x.id+'">'+escHtml(x.title)+'</option>').join('');
  if (id) {
    const t = loadTasks().find(x=>x.id===id);
    if (!t) return;
    document.getElementById('modalTitle').textContent = tr('modal_edit_task') + ' #' + (t.numId || '');
    document.getElementById('saveTaskBtn').textContent = tr('btn_save_changes');
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
    document.getElementById('taskImportantInput').checked = !!t.important;
    document.getElementById('taskMilestoneInput').checked = !!t.milestone;
    const deps = t.dependencies||[];
    const depSel = document.getElementById('taskDepsInput');
    Array.from(depSel.options).forEach(o => { o.selected = deps.includes(o.value); });
    tempSubtasks = (t.subtasks||[]).map(s=>({...s}));
    document.getElementById('commentsSection').style.display = 'block';
    renderComments(t.comments||[]);
  } else {
    document.getElementById('modalTitle').textContent = tr('modal_new_task');
    document.getElementById('saveTaskBtn').textContent = tr('btn_create_task');
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
    document.getElementById('taskImportantInput').checked = false;
    document.getElementById('taskMilestoneInput').checked = false;
    Array.from(document.getElementById('taskDepsInput').options).forEach(o => { o.selected = false; });
    document.getElementById('commentsSection').style.display = 'none';
  }
  updateRecurringPreview();
  renderSubtaskInputs(); updateCatSugg();
  document.getElementById('taskModal').classList.add('active');
  initAccessibility();
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
  ).join('') || ("<p style=\"color:var(--text3);font-size:.78rem\">"+tr("No comments yet")+"</p>");
}
function updateRecurringPreview(){
  const el=document.getElementById('recurringPreview');
  if(!el) return;
  const mode=document.getElementById('taskRecurInput').value;
  const due=document.getElementById('taskDueInput').value;
  if(!mode){el.textContent=tr("No recurrence");return;}
  const base=advanceRecurrence(due?new Date(due+'T12:00:00'):new Date(),mode);
  el.textContent=tr("Next copy after completion: ")+localDateStr(base);
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
  addActivity(tr("Commented on \"")+t.title+'"','info');
}

/* ═══════ SAVE TASK ═══════ */
function saveTask() {
  const title = document.getElementById('taskTitleInput').value.trim();
  if (!title || title.length>200) { toast(tr("Title required (maximum 200 characters)"),'error'); return; }
  const tasks = loadTasks();
  const tags = document.getElementById('taskTagsInput').value.split(/[,،]/).map(t=>t.trim()).filter(Boolean).slice(0,10);
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
    progress:Math.min(100,Math.max(0,Number.parseInt(document.getElementById('taskProgressInput').value)||0)),
    note:document.getElementById('taskNoteInput').value.trim(),
    estimated_hours:Math.max(0,Number.parseFloat(document.getElementById('taskEstHoursInput').value)||0),
    logged_hours:Math.max(0,Number.parseFloat(document.getElementById('taskLogHoursInput').value)||0),
    link:document.getElementById('taskLinkInput').value.trim(),
    tags, subtasks:tempSubtasks.slice(0,20),
    recurring:document.getElementById('taskRecurInput').value,
    reminder:document.getElementById('taskReminderInput').value,
    reminderDismissed:false,
    important:document.getElementById('taskImportantInput').checked,
    milestone:document.getElementById('taskMilestoneInput').checked,
    dependencies:selDeps,
  };
  if(data.status==='done'&&hasUnmetDependencies(data,tasks)){toast(tr("Complete dependencies first"),'error');return;}
  if (editingId) {
    const idx = tasks.findIndex(t=>t.id===editingId);
    if (idx>-1) {
      const old = tasks[idx], prev = old.status;
      data.reminderDismissed=old.reminder===data.reminder ? !!old.reminderDismissed : false;
      Object.assign(old, data, {updatedAt:Date.now()});
      if(data.status!=='done') old.completedAt=null;
      old.smartScore = calcSmartScore(old);
      if (data.status==='done'&&prev!=='done') { old.completedAt=Date.now(); old.progress=100; }
      addActivity(tr("Updated: \"")+title+'"','info'); toast(tr("Task updated"));
      saveTasks(tasks); sheetPost({action:'UPDATE',...taskToSheetRow(old)});
    }
  } else {
    const nw = {id:genId(),numId:getNextNumId(),...data,createdAt:Date.now(),updatedAt:Date.now(),comments:[]};
    nw.smartScore = calcSmartScore(nw);
    if (data.status==='done') { nw.completedAt=Date.now(); nw.progress=100; }
    tasks.push(nw);
    addActivity(tr("Created: \"")+title+'"','success'); toast(tr("Task created"));
    if (data.status==='done') launchConfetti();
    saveTasks(tasks); sheetPost({action:'ADD',...taskToSheetRow(nw)});
  }
  closeModal(); refreshAll();
}

/* ═══════ DELETE / TOGGLE / ARCHIVE ═══════ */
function requestDelete(id) {
  const t = loadTasks().find(x=>x.id===id);
  if (!t) return;
  document.getElementById('confirmTitle').textContent = tr("Delete Task?");
  document.getElementById('confirmMsg').textContent = '"'+t.title+tr("\" will be deleted.");
  document.getElementById('confirmBtn').textContent = tr("Delete");
  pendingConfirm = () => {
    const tasks = loadTasks(), removed = tasks.find(x=>x.id===id);
    saveTasks(tasks.filter(x=>x.id!==id));
    sheetPost({action:'DELETE',id});
    addActivity(tr("Deleted: \"")+t.title+'"','error'); refreshAll();
    toast(tr("Task deleted"),'info',() => { const ts=loadTasks(); ts.push(removed); saveTasks(ts); sheetPost({action:'ADD',...taskToSheetRow(removed)}); refreshAll(); toast(tr("Task restored")); });
  };
  document.getElementById('confirmModal').classList.add('active');
}
function closeConfirm() { document.getElementById('confirmModal').classList.remove('active'); pendingConfirm=null; }
function confirmAction() {
  if(pendingConfirm) { pendingConfirm(); }
  closeConfirm();
}
function hasUnmetDependencies(task,tasks){return (task.dependencies||[]).some(id=>tasks.some(t=>t.id===id&&t.status!=='done'));}
function toggleDone(id) {
  const tasks = loadTasks(), t = tasks.find(x=>x.id===id);
  if(!t) return;
  if(t.dependencies&&t.dependencies.length>0&&t.status!=='done'){
    const unmet=t.dependencies.filter(did=>{ const dep=tasks.find(x=>x.id===did); return dep&&dep.status!=='done'; });
    if(unmet.length>0){toast(tr("Blocked by ")+unmet.length+tr(" dependencies"),'error');return;}
  }
  if(t.status==='done'){t.status='todo';t.completedAt=null;t.progress=0;addActivity(tr("Reopened: \"")+t.title+'"','info');}
  else{t.status='done';t.completedAt=Date.now();t.progress=100;addActivity(tr("Completed: \"")+t.title+'"','success');launchConfetti();toast(tr("Task completed! &#127881;"));}
  t.updatedAt=Date.now(); saveTasks(tasks); sheetPost({action:'UPDATE',...taskToSheetRow(t)}); refreshAll();
}
function toggleSubtask(taskId, idx) {
  const tasks=loadTasks(), t=tasks.find(x=>x.id===taskId);
  if(!t?.subtasks?.[idx]) return;
  t.subtasks[idx].done=!t.subtasks[idx].done; t.updatedAt=Date.now();
  saveTasks(tasks); sheetPost({action:'UPDATE',...taskToSheetRow(t)}); refreshAll();
}
function archiveTask(id) {
  const tasks=loadTasks(), t=tasks.find(x=>x.id===id);
  if(!t) return;
  saveTasks(tasks.filter(x=>x.id!==id));
  const arch=loadArchive(); arch.push({...t,archivedAt:Date.now()}); saveArchive(arch);
  addActivity(tr("Archived: \"")+t.title+'"','info');
  toast(tr("Task archived"),'info',()=>{ const ts=loadTasks();ts.push(t);saveTasks(ts); saveArchive(loadArchive().filter(x=>x.id!==id)); refreshAll();toast(tr("Restored")); });
  refreshAll();
}
function restoreFromArchive(id) {
  const arch=loadArchive(), t=arch.find(x=>x.id===id);
  if(!t) return;
  saveArchive(arch.filter(x=>x.id!==id)); delete t.archivedAt;
  const tasks=loadTasks(); tasks.push(t); saveTasks(tasks);
  addActivity(tr("Restored: \"")+t.title+'"','success'); toast(tr("Task restored")); refreshAll();
}
function clearArchive() {
  pendingConfirm=()=>{saveArchive([]);toast(tr("Archive cleared"));renderArchive();};
  document.getElementById('confirmTitle').textContent=tr("Clear Archive?");
  document.getElementById('confirmMsg').textContent=tr("All archived tasks will be permanently deleted.");
  document.getElementById('confirmBtn').textContent=tr("Clear");
  document.getElementById('confirmModal').classList.add('active');
}
function renderArchive() {
  const arch=loadArchive(), c=document.getElementById('archiveContainer');
  if(!arch.length){c.innerHTML=("<div class=\"empty-state\"><h3>"+tr("Archive is empty")+"</h3><p>"+tr("Archived tasks appear here")+"</p></div>");return;}
  c.innerHTML='<div class="task-list">'+arch.map(t=>'<div class="task-card completed-card"><div class="task-body"><div class="task-title-text"><span style="color:var(--text3);font-size:.72rem;font-weight:700;margin-right:4px">#'+(t.numId||'')+'</span>'+escHtml(t.title)+'</div><div class="task-meta"><span class="tag tag-'+t.priority+'">'+priorityLabel(t.priority)+("</span><span>"+tr("Archived ")+"")+fmtRelative(t.archivedAt)+'</span></div></div><div style="display:flex;gap:4px"><button class="btn btn-sm btn-outline" onclick="restoreFromArchive(\''+t.id+("')\">"+tr("Restore")+"</button></div></div>")).join('')+'</div>';
}

/* ═══════ BULK ACTIONS ═══════ */
function toggleSelect(id) { selectedIds.has(id)?selectedIds.delete(id):selectedIds.add(id); updateBulkBar(); renderTasks(); }
function clearSelection() { selectedIds.clear(); updateBulkBar(); renderTasks(); }
function updateBulkBar() {
  const b=document.getElementById('bulkBar');
  if(selectedIds.size>0){b.style.display='flex';document.getElementById('selectedCount').textContent=tr('selected_count',{n:selectedIds.size});}
  else b.style.display='none';
}
function bulkAction(act) {
  let tasks=loadTasks();
  if(act==='delete'){
    pendingConfirm=()=>{
      tasks=tasks.filter(t=>!selectedIds.has(t.id)); saveTasks(tasks);
      addActivity(tr("Deleted ")+selectedIds.size+tr(" tasks"),'error'); toast(selectedIds.size+tr(" deleted"));
      clearSelection(); refreshAll();
    };
    document.getElementById('confirmTitle').textContent=tr("Delete ")+selectedIds.size+tr(" tasks?");
    document.getElementById('confirmMsg').textContent=tr("Cannot be undone.");
    document.getElementById('confirmBtn').textContent=tr("Delete All");
    document.getElementById('confirmModal').classList.add('active'); return;
  }
  if(act==='archive'){
    const arch=loadArchive();
    tasks.forEach(t=>{if(selectedIds.has(t.id))arch.push({...t,archivedAt:Date.now()});});
    tasks=tasks.filter(t=>!selectedIds.has(t.id));
    saveTasks(tasks);saveArchive(arch);toast(selectedIds.size+tr(" archived"));clearSelection();refreshAll();return;
  }
  tasks.forEach(t=>{
    if(selectedIds.has(t.id)){
      if(act==='done'&&hasUnmetDependencies(t,tasks))return;
      if(act!=='done'){t.completedAt=null;t.progress=0;}
      t.status=act;t.updatedAt=Date.now();
      if(act==='done') { t.completedAt=Date.now();t.progress=100; }
      sheetPost({action:'UPDATE',...taskToSheetRow(t)});
    }
  });
  saveTasks(tasks);toast(selectedIds.size+tr(" updated"));clearSelection();refreshAll();
}

/* ═══════ RENDER DASHBOARD ═══════ */
function renderDashboard() {
  const allTasks=loadTasks();
  const tasks=filterDashboardTasks(allTasks), total=tasks.length, done=tasks.filter(t=>t.status==='done').length;
  const inProg=tasks.filter(t=>t.status==='in-progress').length, overdue=tasks.filter(isOverdue).length;
  const pct=total?Math.round(done/total*100):0;
  document.getElementById('statsGrid').innerHTML =
    ("<div class=\"stat-card\"><div class=\"stat-icon blue\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/></svg></div><div class=\"stat-info\"><h3>"+tr("Total")+"</h3><div class=\"num\">")+total+'</div></div></div>'+
    ("<div class=\"stat-card\"><div class=\"stat-icon green\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><polyline points=\"20 6 9 17 4 12\"/></svg></div><div class=\"stat-info\"><h3>"+tr("Done")+"</h3><div class=\"num\">")+done+'</div><div class="trend">'+pct+'%</div></div></div>'+
    ("<div class=\"stat-card\"><div class=\"stat-icon amber\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/></svg></div><div class=\"stat-info\"><h3>"+tr("In Progress")+"</h3><div class=\"num\">")+inProg+'</div></div></div>'+
    ("<div class=\"stat-card\"><div class=\"stat-icon red\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z\"/></svg></div><div class=\"stat-info\"><h3>"+tr("Overdue")+"</h3><div class=\"num\">")+overdue+'</div></div></div>';
  renderWeeklyChart(tasks); renderPriorityRing(tasks,done,total); renderHeatmap(tasks); renderUpcoming(tasks); renderActivityList(); renderDashGoals(); renderDashHabits(); renderTodaysFocus();
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
  const c=document.getElementById('weeklyChart'), days=[tr("Sun"),tr("Mon"),tr("Tue"),tr("Wed"),tr("Thu"),tr("Fri"),tr("Sat")], counts=new Array(7).fill(0), now=new Date();
  tasks.forEach(t=>{if(t.completedAt){const d=new Date(t.completedAt);if((now-d)/864e5<7)counts[d.getDay()]++;}});
  const max=Math.max(...counts,1), todayIdx=now.getDay(), ordered=[];
  for(let i=6;i>=0;i--){const idx=(todayIdx-i+7)%7;ordered.push({day:days[idx],count:counts[idx],today:i===0});}
  c.innerHTML=ordered.map(d=>'<div class="chart-bar-wrap"><div class="chart-bar" style="height:'+Math.max(d.count/max*160,6)+'px;background:'+(d.today?'var(--primary)':'var(--primary-light)')+';opacity:'+(d.today?1:.6)+'"><span class="tooltip">'+d.count+'</span></div><span class="label" style="'+(d.today?'font-weight:700;color:var(--primary)':'')+'">'+d.day+'</span></div>').join('');
}
function renderPriorityRing(tasks,done,total) {
  const cv=document.getElementById('ringCanvas'),ctx=cv.getContext('2d');
  cv.width=260;cv.height=260;ctx.clearRect(0,0,260,260);
  const data=[{c:tasks.filter(t=>t.priority==='high').length,clr:'#ef4444',l:tr("High")},{c:tasks.filter(t=>t.priority==='medium').length,clr:'#f59e0b',l:tr("Medium")},{c:tasks.filter(t=>t.priority==='low').length,clr:'#10b981',l:tr("Low")}];
  const sum=data.reduce((a,d)=>a+d.c,0)||1;
  let start=-Math.PI/2;
  data.forEach(d=>{const a=(d.c/sum)*Math.PI*2;ctx.beginPath();ctx.arc(130,130,100,start,start+a);ctx.lineWidth=24;ctx.strokeStyle=d.clr;ctx.lineCap='round';ctx.stroke();start+=a+.04;});
  document.getElementById('ringPct').textContent=(total?Math.round(done/total*100):0)+'%';
  document.getElementById('ringLegend').innerHTML=data.map(d=>'<span><span class="dot-legend" style="background:'+d.clr+'"></span>'+d.l+': '+d.c+'</span>').join('');
}
function renderHeatmap(tasks) {
  const w=document.getElementById('heatmapWrap'), completedDates={};
  tasks.forEach(t=>{if(t.completedAt){const d=dateOfMs(t.completedAt);completedDates[d]=(completedDates[d]||0)+1;}});
  let html='<div class="heatmap-grid">';
  const today=new Date();
  for(let week=15;week>=0;week--){html+='<div class="heatmap-col">';for(let day=0;day<7;day++){const d=new Date(today);d.setDate(d.getDate()-week*7-(6-day));const ds=localDateStr(d);const cnt=completedDates[ds]||0;html+='<div class="heatmap-cell" data-count="'+Math.min(cnt,5)+'" title="'+fmtDate(ds)+': '+tr('calendar_tasks',{n:cnt})+'"></div>';}html+='</div>';}
  html+=("</div><div class=\"heatmap-legend\">"+tr("Less ")+"<div class=\"heatmap-cell\" data-count=\"0\"></div><div class=\"heatmap-cell\" data-count=\"1\"></div><div class=\"heatmap-cell\" data-count=\"2\"></div><div class=\"heatmap-cell\" data-count=\"3\"></div><div class=\"heatmap-cell\" data-count=\"4\"></div><div class=\"heatmap-cell\" data-count=\"5\"></div>"+tr(" More")+"</div>");
  w.innerHTML=html;
}
function renderUpcoming(tasks) {
  const c=document.getElementById('upcomingDeadlines');
  const up=tasks.filter(t=>t.due&&t.status!=='done').sort((a,b)=>a.due.localeCompare(b.due)).slice(0,5);
  if(!up.length){c.innerHTML=("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:16px\">"+tr("No deadlines")+"</p>");return;}
  c.innerHTML=up.map(t=>{const od=isOverdue(t);return'<div class="activity-item" onclick="openModal(\''+t.id+'\')"><div class="activity-dot" style="background:'+(od?'var(--danger)':'var(--success)')+'"></div><span class="activity-text">'+escHtml(t.title)+'</span><span class="activity-time" style="'+(od?'color:var(--danger)':'')+'">'+fmtDate(t.due)+'</span></div>';}).join('');
}
function renderDashGoals() {
  const goals=loadGoals().slice(0,3), c=document.getElementById('dashGoals');
  if(!goals.length){c.innerHTML=("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:12px\">"+tr("No goals set")+"</p>");return;}
  const tasks=loadTasks(), habits=loadHabits();
  c.innerHTML=goals.map(g=>{const pct=computeGoalProgress(g,tasks,habits).pct; return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px"><span>'+escHtml(g.title)+'</span><span style="font-weight:700">'+pct+'%</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+pct+'%;background:var(--primary)"></div></div></div>';}).join('');
}
function renderDashHabits() {
  const habits=loadHabits().slice(0,4), c=document.getElementById('dashHabits'), today=todayStr();
  if(!habits.length){c.innerHTML=("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:12px\">"+tr("No habits tracked")+"</p>");return;}
  c.innerHTML=habits.map(h=>{const done=h.completions?.[today];const streak=calcHabitStreak(h); return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0"><div style="width:24px;height:24px;border-radius:50%;background:'+(done?'var(--success)':'var(--surface3)')+';display:flex;align-items:center;justify-content:center;font-size:.7rem;color:#fff">'+(done?'&#10003;':'')+'</div><span style="flex:1;font-size:.82rem">'+escHtml(h.name)+'</span><span style="font-size:.72rem;color:var(--text3)">'+tr('streak_days',{n:streak})+'</span></div>';}).join('');
}
function renderActivityList() {
  const list=loadActivity().slice(0,10), c=document.getElementById('activityList');
  if(!list.length){c.innerHTML=("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:16px\">"+tr("No activity")+"</p>");return;}
  c.innerHTML=list.map(a=>'<div class="activity-item"><div class="activity-dot" style="background:'+typeColor(a.type)+'"></div><span class="activity-text">'+escHtml(activityLabel(a.text))+'</span><span class="activity-time">'+fmtRelative(a.time)+'</span></div>').join('');
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
  if(!tasks.length){c.innerHTML=("<div class=\"empty-state\"><h3>"+tr("No tasks found")+"</h3><p>"+tr("Press Q for quick add")+"</p><button class=\"btn btn-sm btn-primary\" onclick=\"openModal()\">"+tr("Create Task")+"</button></div>");return;}
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
    (t.recurring?' <span style="color:var(--accent);font-size:.7rem">&#8635; '+tr('option_'+t.recurring)+'</span>':'')+
    (blocked?(" <span class=\"tag tag-blocked\">"+tr("blocked")+"</span>"):'')+
    '</div><div class="task-meta">'+
    '<span class="tag tag-'+t.priority+'">'+priorityLabel(t.priority)+'</span>'+
    (t.category?'<span class="tag tag-category">'+escHtml(t.category)+'</span>':'')+
    (pName?'<span class="tag tag-project" style="border-left:3px solid '+pColor+'">'+escHtml(pName)+'</span>':'')+
    '<span class="tag tag-owner">'+escHtml(getUserLabel(t.assignee))+'</span>'+
    taskDueHtml(t,od)+
    (stT?'<span>'+stD+'/'+stT+'</span>':'')+
    taskTagsHtml(t)+
    '<span class="tag tag-score">'+score+'</span>'+
    (t.link?'<a href="'+escHtml(safeLink(t.link))+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--accent)">&#128279;</a>':'')+
    '</div>'+subtaskBarHtml(stD,stT)+'</div>'+
    '<div class="task-actions">'+
    '<button class="btn-icon" onclick="event.stopPropagation();startTimerForTask(\''+t.id+("')\" title=\""+tr("Timer")+"\" style=\"color:var(--text3)\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" style=\"width:14px;height:14px\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/></svg></button>")+
    '<button class="btn-icon" onclick="event.stopPropagation();archiveTask(\''+t.id+("')\" title=\""+tr("Archive")+"\" style=\"color:var(--text3)\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" style=\"width:14px;height:14px\"><polyline points=\"21 8 21 21 3 21 3 8\"/><rect x=\"1\" y=\"3\" width=\"22\" height=\"5\"/></svg></button>")+
    '<button class="btn-icon" onclick="event.stopPropagation();openModal(\''+t.id+("')\" title=\""+tr("Edit")+"\" style=\"color:var(--text3)\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" style=\"width:14px;height:14px\"><path d=\"M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7\"/><path d=\"M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg></button>")+
    '<button class="btn-icon" onclick="event.stopPropagation();requestDelete(\''+t.id+("')\" title=\""+tr("Delete")+"\" style=\"color:var(--danger)\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" style=\"width:14px;height:14px\"><polyline points=\"3 6 5 6 21 6\"/><path d=\"M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2\"/></svg></button>")+
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
  return '<div class="kanban-card" draggable="true" ondragstart="kanbanDragStart(event,\''+t.id+'\')" ondblclick="openModal(\''+t.id+'\')"><div class="kc-title">'+(t.milestone?'&#9733; ':'')+escHtml(t.title)+'</div><div class="kc-meta"><span><span class="kc-priority" style="background:'+priorityColor(t.priority)+'"></span> '+priorityLabel(t.priority)+'</span>'+dueHtml+'</div></div>';
}
function renderKanban() {
  const tasks=loadTasks();
  const cols=[{key:'todo',label:tr("To Do"),clr:'var(--text3)'},{key:'in-progress',label:tr("In Progress"),clr:'var(--warning)'},{key:'done',label:tr("Done"),clr:'var(--success)'}];
  document.getElementById('kanbanBoard').innerHTML=cols.map(col=>{
    const ct=tasks.filter(t=>t.status===col.key);
    const cardsHtml=ct.length?ct.map(renderKanbanCard).join(''):("<p style=\"color:var(--text3);font-size:.75rem;text-align:center;padding:16px\">"+tr("Empty")+"</p>");
    return '<div class="kanban-col" ondrop="kanbanDrop(event,\''+col.key+'\')" ondragover="event.preventDefault();this.style.background=\'var(--surface3)\'" ondragleave="this.style.background=\'\'"><div class="kanban-col-header"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+col.clr+';margin-right:6px"></span>'+col.label+'</span><span class="col-count">'+ct.length+'</span></div><div class="kanban-cards">'+cardsHtml+'</div></div>';
  }).join('');
}
function kanbanDragStart(e,id){dragTaskId=id;e.dataTransfer.effectAllowed='move';}
function kanbanDrop(e,status){
  e.preventDefault();e.currentTarget.classList.remove('drag-over');
  if(!dragTaskId) return;
  const tasks=loadTasks(), t=tasks.find(x=>x.id===dragTaskId);
  if(t&&status==='done'&&hasUnmetDependencies(t,tasks)){toast(tr("Complete dependencies first"),'error');dragTaskId=null;return;}
  if(t&&t.status!==status){if(status!=='done'){t.completedAt=null;t.progress=0;}t.status=status;t.updatedAt=Date.now();if(status==='done'){t.completedAt=Date.now();t.progress=100;launchConfetti();}
    saveTasks(tasks);sheetPost({action:'UPDATE',...taskToSheetRow(t)});addActivity(tr("Moved \"")+t.title+tr("\" to ")+statusLabel(status),'info');toast(tr("Moved"));refreshAll();}
  dragTaskId=null;
}

/* ═══════ CALENDAR & EVENTS ═══════ */
function initCal(){const n=new Date();calYear=n.getFullYear();calMonth=n.getMonth();}
function calNav(d){calMonth+=d;if(calMonth<0){calMonth=11;calYear--;}if(calMonth>11){calMonth=0;calYear++;}renderCalendar();}
function calToday(){initCal();renderCalendar();}
function loadEvents(){try{return JSON.parse(localStorage.getItem(userKey('taskflow_events')))||[];}catch{return [];}}
function saveEvents(ev){ev=ev.map(e=>({...e,reminderUtc:e.remindBefore==null?null:reminderUtc(new Date(new Date(e.date+'T'+(e.time||'00:00')).getTime()-e.remindBefore*60000))}));persistData(userKey('taskflow_events'),JSON.stringify(ev));}
function openEventModal(dateStr){
  editingEventId=null;selectedEventColor='#818cf8';
  document.getElementById('eventModalTitle').textContent=tr("New Event");
  document.getElementById('eventTitleInput').value='';
  document.getElementById('eventDateInput').value=dateStr||todayStr();
  document.getElementById('eventTimeInput').value='09:00';
  document.getElementById('eventEndTimeInput').value='10:00';
  document.getElementById('eventTypeInput').value='meeting';
  document.getElementById('eventRemindInput').value='none';
  document.getElementById('eventImportantInput').checked=false;
  document.getElementById('eventDescInput').value='';
  document.getElementById('eventDeleteBtn').style.display='none';
  document.querySelectorAll('.ev-color-opt').forEach(b=>{b.classList.toggle('active',b.dataset.color==='#818cf8');});
  document.getElementById('eventModal').classList.add('active');
  document.getElementById('eventTitleInput').focus();
}
function editEvent(id){
  const ev=loadEvents().find(e=>e.id===id);if(!ev)return;
  editingEventId=id;selectedEventColor=ev.color||'#818cf8';
  document.getElementById('eventModalTitle').textContent=tr("Edit Event");
  document.getElementById('eventTitleInput').value=ev.title;
  document.getElementById('eventDateInput').value=ev.date;
  document.getElementById('eventTimeInput').value=ev.time||'';
  document.getElementById('eventEndTimeInput').value=ev.endTime||'';
  document.getElementById('eventTypeInput').value=ev.type||'meeting';
  document.getElementById('eventRemindInput').value=ev.remindBefore!=null?String(ev.remindBefore):'none';
  document.getElementById('eventImportantInput').checked=!!ev.important;
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
  if(!title){toast(tr("Please enter a title"));return;}
  if(!date){toast(tr("Please select a date"));return;}
  const events=loadEvents();
  const remindVal=document.getElementById('eventRemindInput').value;
  const remindBefore=remindVal==='none'?null:Number.parseInt(remindVal);
  const important=document.getElementById('eventImportantInput').checked;
  const data={title,date,time:document.getElementById('eventTimeInput').value,endTime:document.getElementById('eventEndTimeInput').value,type:document.getElementById('eventTypeInput').value,color:selectedEventColor,description:document.getElementById('eventDescInput').value.trim(),remindBefore,reminderFired:false,important};
  if(editingEventId){const idx=events.findIndex(e=>e.id===editingEventId);if(idx>=0){events[idx]={...events[idx],...data};}}else{events.push({id:genId(),...data,createdAt:Date.now()});}
  const wasEditing=!!editingEventId;saveEvents(events);closeEventModal();renderCalendar();toast(wasEditing?tr('Event updated'):tr('Event created'));
}
function deleteEvent(){
  if(!editingEventId)return;
  const events=loadEvents().filter(e=>e.id!==editingEventId);
  saveEvents(events);closeEventModal();renderCalendar();toast(tr("Event deleted"));
}
function renderCalendar(){
  if(calYear===undefined||calMonth===undefined) initCal();
  const months=[tr("January"),tr("February"),tr("March"),tr("April"),tr("May"),tr("June"),tr("July"),tr("August"),tr("September"),tr("October"),tr("November"),tr("December")];
  document.getElementById('calTitle').textContent=months[calMonth]+' '+calYear;
  const tasks=loadTasks(),events=loadEvents(), first=new Date(calYear,calMonth,1), last=new Date(calYear,calMonth+1,0);
  const startDay=first.getDay(), totalDays=last.getDate(), today=todayStr();
  let html='';
  [tr("Sun"),tr("Mon"),tr("Tue"),tr("Wed"),tr("Thu"),tr("Fri"),tr("Sat")].forEach(d=>{html+='<div class="cal-day-name">'+d+'</div>';});
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
  const catMap={};tasks.forEach(t=>{const c=t.category||tr("Other");catMap[c]=(catMap[c]||0)+1;});
  const catE=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
  document.getElementById('analyticsGrid').innerHTML=
    ("<div class=\"card\"><div class=\"card-title\">"+tr("Completion")+"</div><div style=\"text-align:center;padding:12px\"><div style=\"font-size:2.5rem;font-weight:900;color:var(--primary)\">")+pct+'%</div><p style="color:var(--text3);font-size:.82rem;margin:6px 0 12px">'+done+'/'+total+'</p><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+pct+'%;background:var(--success)"></div></div></div></div>'+
    ("<div class=\"card\"><div class=\"card-title\">"+tr("Streak")+"</div><div class=\"streak-display\"><div class=\"streak-num\">")+streak+("</div><div class=\"streak-label\">"+tr("day")+"")+(lang==='ar'?'':(streak===1?'':'s')+' in a row')+'</div></div></div>'+
    ("<div class=\"card\"><div class=\"card-title\">"+tr("Metrics")+"</div><div class=\"metric-row\"><span class=\"metric-label\">"+tr("Overdue")+"</span><span class=\"metric-value\" style=\"color:var(--danger)\">")+overdue+("</span></div><div class=\"metric-row\"><span class=\"metric-label\">"+tr("Avg Completion")+"</span><span class=\"metric-value\">")+(avgH?tr('hours_value',{n:avgH}):'—')+("</span></div><div class=\"metric-row\"><span class=\"metric-label\">"+tr("Est. Hours")+"</span><span class=\"metric-value\">")+estH+("</span></div><div class=\"metric-row\"><span class=\"metric-label\">"+tr("Logged Hours")+"</span><span class=\"metric-value\">")+logH+'</span></div></div>'+
    ("<div class=\"card\"><div class=\"card-title\">"+tr("Categories")+"</div>")+(catE.length?catE.map(([c,n])=>{const p=Math.round(n/total*100);return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px"><span>'+escHtml(c)+'</span><span style="font-weight:600">'+n+'</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+p+'%;background:var(--primary)"></div></div></div>';}).join(''):("<p style=\"color:var(--text3);font-size:.82rem;text-align:center\">"+tr("No data")+"</p>"))+'</div>'+
    ("<div class=\"card\"><div class=\"card-title\">"+tr("Burndown (7 days)")+"</div><div class=\"chart-area\" id=\"burndownChart\" style=\"height:160px\"></div></div>");
  renderBurndown(tasks); renderGantt(tasks);
}
function calcStreak(tasks){
  const comp=tasks.filter(t=>t.completedAt).map(t=>dateOfMs(t.completedAt));
  const uniq=new Set(comp);
  if(!uniq.size) return 0;
  let streak=0, checkDs=todayStr();
  if(!uniq.has(checkDs)) checkDs=addDaysToDateStr(checkDs,-1);
  for(let i=0;i<365;i++){ if(uniq.has(checkDs)){ streak++; checkDs=addDaysToDateStr(checkDs,-1); } else break; }
  return streak;
}
function renderBurndown(tasks){
  const c=document.getElementById('burndownChart');if(!c) return;
  const today=new Date(), bars=[];
  for(let i=6;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);const ds=localDateStr(d);const remaining=tasks.filter(t=>t.status!=='done'||(t.completedAt&&dateOfMs(t.completedAt)>ds)).length;bars.push({day:[tr("Sun"),tr("Mon"),tr("Tue"),tr("Wed"),tr("Thu"),tr("Fri"),tr("Sat")][d.getDay()],val:remaining,today:i===0});}
  const max=Math.max(...bars.map(b=>b.val),1);
  c.innerHTML=bars.map(b=>'<div class="chart-bar-wrap"><div class="chart-bar" style="height:'+Math.max(b.val/max*140,4)+'px;background:'+(b.today?'var(--accent)':'var(--accent2)')+';opacity:'+(b.today?1:.6)+'"><span class="tooltip">'+tr('remaining_tasks',{n:b.val})+'</span></div><span class="label">'+b.day+'</span></div>').join('');
}
function renderGantt(tasks){
  const c=document.getElementById('ganttContainer');
  const withDue=tasks.filter(t=>t.due&&t.createdAt).slice(0,15);
  if(!withDue.length){c.innerHTML=("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:16px\">"+tr("Add due dates to see timeline")+"</p>");return;}
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
      html+='<div class="task-card'+(dn?' completed-card':'')+'" ondblclick="openModal(\''+t.id+'\')"><div class="task-check'+(dn?' checked':'')+'" onclick="toggleDone(\''+t.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div><div class="task-body"><div class="task-title-text'+(dn?' done':'')+'"><span style="color:var(--text3);font-size:.72rem;font-weight:700;margin-right:4px">#'+(t.numId||'')+'</span>'+escHtml(t.title)+'</div><div class="task-meta"><span class="tag tag-'+t.priority+'">'+priorityLabel(t.priority)+'</span>'+taskDueHtml(t,isOverdue(t))+'</div></div><select onchange="setMyDaySlot(\''+t.id+'\',this.value)" style="font-size:.72rem;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:var(--bg)"><option value="morning"'+(t.myDaySlot!=='afternoon'&&t.myDaySlot!=='evening'?' selected':'')+(">"+tr("Morning")+"</option><option value=\"afternoon\"")+(t.myDaySlot==='afternoon'?' selected':'')+(">"+tr("Afternoon")+"</option><option value=\"evening\"")+(t.myDaySlot==='evening'?' selected':'')+(">"+tr("Evening")+"</option></select></div>");
    });
  } else {
    html+=("<p style=\"color:var(--text3);font-size:.8rem;padding:8px\">"+tr("No tasks")+"</p>");
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
    ("<div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Today's Tasks")+"</h3><div class=\"num\">")+totalToday+("</div></div></div><div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Completed")+"</h3><div class=\"num\">")+doneToday+("</div></div></div><div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Remaining")+"</h3><div class=\"num\">")+(totalToday-doneToday)+'</div></div></div>';
  document.getElementById('myDayBlocks').innerHTML=
    '<div class="my-day-grid">'+myDaySlotHtml(tr("&#9728; Morning"),morning)+myDaySlotHtml(tr("&#9788; Afternoon"),afternoon)+myDaySlotHtml(tr("&#9790; Evening"),evening)+'</div>';
  const noteEl=document.getElementById('dailyNoteInput');
  if(noteEl&&!noteEl.matches(':focus')) noteEl.value=dailyNote;
}
function setMyDaySlot(id,slot){const tasks=loadTasks(),t=tasks.find(x=>x.id===id);if(t){t.myDaySlot=slot;saveTasks(tasks);renderMyDay();}}
function saveDailyNote(){const el=document.getElementById('dailyNoteInput');if(el){const k=userKey('dailyNote_'+todayStr());persistData(k,el.value);}}
function addToMyDay(){const tasks=loadTasks().filter(t=>t.status!=='done'&&t.due!==todayStr()&&t.myDay!==todayStr());if(!tasks.length){toast(tr("No tasks available"));return;}
  const id=tasks[0].id;const ts=loadTasks(),t=ts.find(x=>x.id===id);if(t){t.myDay=todayStr();saveTasks(ts);renderMyDay();toast(tr("Added to My Day"));}}

/* ═══════ TIMETABLE (dynamic daily auto-scheduler) ═══════ */
let timetableDate = todayStr();
let editingTimetableBlockId=null;
function loadTimetableBlocks(){try{const blocks=JSON.parse(localStorage.getItem(userKey('taskflow_timetable_blocks')))||[];return Array.isArray(blocks)?blocks.map(b=>({...b,priority:asChoice(b.priority,['low','medium','high'],'medium'),reminder:asText(b.reminder,40),important:Boolean(b.important),reminderDismissed:Boolean(b.reminderDismissed),completedAt:Number(b.completedAt)||null})):[];}catch{return [];}}
function saveTimetableBlocks(blocks){blocks=blocks.map(b=>({...b,reminderUtc:reminderUtc(b.reminder)}));persistData(userKey('taskflow_timetable_blocks'),JSON.stringify(blocks));}
function timeToMinutes(time){
  const match=/^(\d{2}):(\d{2})$/.exec(time||'');
  if(!match) return null;
  const hours=Number(match[1]),minutes=Number(match[2]);
  return hours<24&&minutes<60?hours*60+minutes:null;
}
function minutesToTime(minutes){const n=Math.max(0,Math.min(1439,Math.round(minutes)));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function openTimetableBlockModal(id){
  const block=id&&loadTimetableBlocks().find(b=>b.id===id); editingTimetableBlockId=block?block.id:null;
  document.getElementById('ttBlockModalTitle').textContent=tr(block?'modal_edit_time_block':'modal_new_time_block');
  document.getElementById('ttBlockTitleInput').value=block?block.title:'';
  document.getElementById('ttBlockDateInput').value=block?block.date:timetableDate;
  document.getElementById('ttBlockStartInput').value=block?minutesToTime(block.start):'09:00';
  document.getElementById('ttBlockEndInput').value=block?minutesToTime(block.end):'10:00';
  document.getElementById('ttBlockPriorityInput').value=block?block.priority:'medium';
  document.getElementById('ttBlockReminderInput').value=block?block.reminder||'':'';
  document.getElementById('ttBlockImportantInput').checked=block?!!block.important:false;
  document.getElementById('ttBlockDeleteBtn').style.display=block?'inline-flex':'none';
  document.getElementById('timetableBlockModal').classList.add('active');document.getElementById('ttBlockTitleInput').focus();
}
function closeTimetableBlockModal(){document.getElementById('timetableBlockModal').classList.remove('active');editingTimetableBlockId=null;}
function saveTimetableBlock(){
  const title=document.getElementById('ttBlockTitleInput').value.trim(),date=document.getElementById('ttBlockDateInput').value;
  const start=timeToMinutes(document.getElementById('ttBlockStartInput').value),end=timeToMinutes(document.getElementById('ttBlockEndInput').value);
  if(!title){toast(tr("Please enter a title"));return;} if(!date){toast(tr("Please select a date"));return;} if(start===null||end===null||end<=start){toast(tr('tt_time_error'),'error');return;}
  const reminder=document.getElementById('ttBlockReminderInput').value,important=document.getElementById('ttBlockImportantInput').checked;
  const blocks=loadTimetableBlocks(),data={title,date,start,end,priority:document.getElementById('ttBlockPriorityInput').value,reminder,important,updatedAt:Date.now()};
  if(editingTimetableBlockId){const i=blocks.findIndex(b=>b.id===editingTimetableBlockId);if(i>=0){const old=blocks[i];blocks[i]={...old,...data,reminderDismissed:old.reminder===reminder?old.reminderDismissed:false};}}else blocks.push({id:genId(),...data,reminderDismissed:false,completedAt:null,createdAt:Date.now()});
  saveTimetableBlocks(blocks);closeTimetableBlockModal();renderTimetable();toast(tr('tt_block_saved'));
}
function toggleTimetableBlockDone(id){
  const blocks=loadTimetableBlocks(),block=blocks.find(b=>b.id===id);if(!block)return;
  block.completedAt=block.completedAt?null:Date.now();block.updatedAt=Date.now();
  saveTimetableBlocks(blocks);renderTimetable();
}
function deleteTimetableBlock(){
  if(!editingTimetableBlockId) return;
  saveTimetableBlocks(loadTimetableBlocks().filter(b=>b.id!==editingTimetableBlockId));
  closeTimetableBlockModal();renderTimetable();toast(tr('tt_block_deleted'));
}
function getWorkHours(){
  let wh=null;
  try{ wh=JSON.parse(localStorage.getItem(userKey('taskflow_workhours'))); }catch{ wh=null; }
  if(!wh||typeof wh.start!=='number'||typeof wh.end!=='number') wh={start:9,end:18};
  wh.start=Math.min(23,Math.max(0,Number.parseInt(wh.start)||0));
  wh.end=Math.min(24,Math.max(wh.start+1,Number.parseInt(wh.end)||wh.start+1));
  return wh;
}
function saveWorkHours(wh){ persistData(userKey('taskflow_workhours'), JSON.stringify(wh)); }
function updateWorkHours(){
  const s=Number.parseInt(document.getElementById('ttStartInput').value);
  const e=Number.parseInt(document.getElementById('ttEndInput').value);
  const wh=getWorkHours();
  if(!Number.isNaN(s)) wh.start=Math.min(23,Math.max(0,s));
  if(!Number.isNaN(e)) wh.end=Math.min(24,Math.max(wh.start+1,e));
  saveWorkHours(wh); renderTimetable();
}
function timetableNav(delta){
  timetableDate=addDaysToDateStr(timetableDate, delta); renderTimetable();
}
function timetableToday(){ timetableDate=todayStr(); renderTimetable(); }
function fmtHourLabel(hours) {
  const minutes = ((Math.round(hours * 60) % 1440) + 1440) % 1440;
  return new Intl.DateTimeFormat(appLocale(), {hour:'numeric', minute:'2-digit'}).format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}
function buildTimetableSchedule(date, wh){
  const tasks=loadTasks().filter(t=>t.status!=='done'&&(t.due===date||t.myDay===date));
  tasks.sort((a,b)=>{
    if(a.due_time&&b.due_time) return a.due_time.localeCompare(b.due_time);
    if(a.due_time) return -1;
    if(b.due_time) return 1;
    return (b.smartScore||0)-(a.smartScore||0);
  });
  const startMin=wh.start*60, endMin=wh.end*60;
  const manualBlocks=loadTimetableBlocks().filter(b=>b.date===date&&Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start).sort((a,b)=>a.start-b.start);
  const occupied=manualBlocks.map(b=>({start:Math.max(startMin,b.start),end:Math.min(endMin,b.end)})).filter(b=>b.end>b.start).sort((a,b)=>a.start-b.start);
  const free=[];let cursor=startMin,reservedMin=0;
  occupied.forEach(b=>{
    const uncoveredStart=Math.max(cursor,b.start);
    if(b.end>uncoveredStart) reservedMin+=b.end-uncoveredStart;
    cursor=Math.max(cursor,b.end);
  });
  cursor=startMin;
  occupied.forEach(b=>{
    if(b.start>cursor) free.push({start:cursor,end:b.start});
    cursor=Math.max(cursor,b.end);
  });
  if(cursor<endMin) free.push({start:cursor,end:endMin});
  const blocks=[], overflow=[];
  tasks.forEach(t=>{
    const dur=Math.max(15, Math.round((t.estimated_hours||1)*60));
    const slot=free.find(s=>s.end-s.start>=dur);
    if(!slot){ overflow.push(t); return; }
    blocks.push({task:t, start:slot.start, end:slot.start+dur});slot.start+=dur;
  });
  return {blocks, manualBlocks, reservedMin, overflow};
}
function renderTimetable(){
  const wh=getWorkHours();
  document.getElementById('ttStartInput').value=wh.start;
  document.getElementById('ttEndInput').value=wh.end;
  const isToday=timetableDate===todayStr();
  document.getElementById('ttDateLabel').innerHTML=(isToday?tr("Today &bull; "):'')+escHtml(new Date(timetableDate+'T00:00:00').toLocaleDateString(appLocale(),{weekday:'short',month:'short',day:'numeric'}));
  const {blocks, manualBlocks, reservedMin, overflow}=buildTimetableSchedule(timetableDate, wh);
  const completedBlocks=manualBlocks.filter(b=>b.completedAt).length,blockProgress=manualBlocks.length?Math.round(completedBlocks/manualBlocks.length*100):0;
  const totalMin=(wh.end-wh.start)*60;
  const usedMin=blocks.reduce((s,b)=>s+(b.end-b.start),0)+reservedMin;
  const freeMin=Math.max(0, totalMin-usedMin);
  document.getElementById('ttStats').innerHTML=
    ("<div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Scheduled")+"</h3><div class=\"num\">")+(blocks.length+manualBlocks.length)+'</div></div></div>'+
    ("<div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Planned Hours")+"</h3><div class=\"num\">")+(usedMin/60).toFixed(1)+'</div></div></div>'+
    ("<div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Free Hours")+"</h3><div class=\"num\">")+(freeMin/60).toFixed(1)+'</div></div></div>'+
    ("<div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Unscheduled")+"</h3><div class=\"num\">")+overflow.length+'</div></div></div>'+
    '<div class="stat-card tt-progress-stat" style="flex:1;min-width:140px"><div class="stat-info"><h3>'+escHtml(tr('tt_progress'))+'</h3><div class="num">'+completedBlocks+'/'+manualBlocks.length+' <span class="tt-progress-percent">'+blockProgress+'%</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+blockProgress+'%;background:var(--success)"></div></div></div></div>';
  const grid=document.getElementById('ttGrid');
  grid.style.height=totalMin+'px';
  let html='';
  for(let h=wh.start; h<wh.end; h++){
    html+='<div class="tt-hour-label" style="top:'+((h-wh.start)*60)+'px">'+fmtHourLabel(h)+'</div>';
  }
  manualBlocks.forEach(b=>{
    const top=b.start-wh.start*60, h=Math.max(20,b.end-b.start);
    const done=!!b.completedAt,priorityLabel=tr('priority_'+b.priority);
    html+='<div class="tt-block tt-manual-block'+(done?' tt-done':'')+'" style="top:'+top+'px;height:'+(h-2)+'px;background:'+priorityColor(b.priority)+'" onclick="openTimetableBlockModal(\''+b.id+'\')" title="'+escHtml(b.title)+'"><button class="tt-complete-toggle" aria-label="'+escHtml(tr(done?'tt_mark_undone':'tt_mark_done'))+'" title="'+escHtml(tr(done?'tt_mark_undone':'tt_mark_done'))+'" onclick="event.stopPropagation();toggleTimetableBlockDone(\''+b.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg></button><div class="tt-block-title">'+escHtml(b.title)+'</div><div class="tt-block-meta">'+fmtHourLabel(b.start/60)+' &ndash; '+fmtHourLabel(b.end/60)+' &bull; '+escHtml(tr('tt_manual_block'))+' &bull; '+escHtml(priorityLabel)+(b.reminder?' &bull; '+escHtml(tr('field_reminder')):'')+'</div></div>';
  });
  blocks.forEach(b=>{
    const t=b.task, top=b.start-wh.start*60, h=Math.max(20, b.end-b.start);
    const done=t.status==='done';
    html+='<div class="tt-block'+(done?' tt-done':'')+'" style="top:'+top+'px;height:'+(h-2)+'px;background:'+priorityColor(t.priority)+'" onclick="openModal(\''+t.id+'\')" title="'+escHtml(t.title)+'">'+
      '<div class="tt-block-title">'+escHtml(t.title)+'</div>'+
      '<div class="tt-block-meta">'+fmtHourLabel(b.start/60)+' &ndash; '+fmtHourLabel(b.end/60)+(t.project?' &bull; '+escHtml(getProjectName(t.project)):'')+'</div>'+
    '</div>';
  });
  if(isToday){
    const now=new Date(), nowMin=now.getHours()*60+now.getMinutes();
    if(nowMin>=wh.start*60&&nowMin<=wh.end*60){
      html+='<div class="tt-now-line" style="top:'+(nowMin-wh.start*60)+'px"></div>';
    }
  }
  grid.innerHTML=html;
  const ov=document.getElementById('ttOverflow');
  if(!overflow.length){
    ov.innerHTML=("<p style=\"color:var(--text3);font-size:.8rem\">"+tr("Everything fits today &#127881;")+"</p>");
  } else {
    ov.innerHTML=overflow.map(t=>
      '<div class="tt-overflow-card" onclick="openModal(\''+t.id+'\')"><div class="tt-ov-title">'+escHtml(t.title)+'</div><div class="tt-ov-meta">'+(t.estimated_hours||1)+' '+tr('hours_value',{n:''})+' &bull; '+priorityLabel(t.priority)+'</div></div>'
    ).join('');
  }
}

/* ═══════ PROJECTS ═══════ */
function renderProjects(){
  const projects=loadProjects(), tasks=loadTasks();
  const c=document.getElementById('projectGrid');
  if(!projects.length){c.innerHTML=("<div class=\"empty-state\"><h3>"+tr("No Projects")+"</h3><p>"+tr("Create your first project")+"</p><button class=\"btn btn-sm btn-primary\" onclick=\"openProjectModal()\">"+tr("Create Project")+"</button></div>");return;}
  c.innerHTML=projects.map(p=>{
    const pTasks=tasks.filter(t=>t.project===p.id);
    const done=pTasks.filter(t=>t.status==='done').length, total=pTasks.length;
    const pct=total?Math.round(done/total*100):0;
    return '<div class="project-card" onclick="filterByProject(\''+p.id+'\')"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div class="project-dot" style="background:'+escHtml(p.color||'var(--primary)')+'"></div><h3 style="font-size:1rem;font-weight:700">'+escHtml(p.name)+'</h3><div style="margin-left:auto;display:flex;gap:4px"><button class="btn-icon" onclick="event.stopPropagation();openProjectModal(\''+p.id+("')\" title=\""+tr("Edit")+"\" style=\"color:var(--text3)\">&#9998;</button><button class=\"btn-icon\" onclick=\"event.stopPropagation();deleteProject('")+p.id+("')\" title=\""+tr("Delete")+"\" style=\"color:var(--danger)\">&#128465;</button></div></div><p style=\"font-size:.8rem;color:var(--text3);margin-bottom:10px\">")+escHtml(p.description||'')+'</p><div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:6px"><span>'+done+'/'+total+(""+tr(" tasks")+"</span><span>")+pct+'%</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+pct+'%;background:'+escHtml(p.color||'var(--primary)')+'"></div></div></div>';
  }).join('');
}
function openProjectModal(id){
  const p=id?loadProjects().find(x=>x.id===id):null;
  editingProjectId=id||null;
  document.getElementById('projectNameInput').value=p?p.name:'';
  document.getElementById('projectColorInput').value=p?p.color:'#6366f1';
  document.getElementById('projectDescInput').value=p?p.description:'';
  document.getElementById('projectModal').classList.add('active');
  refreshEditorLabels();
}
function closeProjectModal(){document.getElementById('projectModal').classList.remove('active');editingProjectId=null;}
function saveProject(){
  const name=document.getElementById('projectNameInput').value.trim();
  if(!name){toast(tr("Project name required"));return;}
  const projects=loadProjects();
  if(editingProjectId){const p=projects.find(x=>x.id===editingProjectId);if(p){p.name=name;p.color=document.getElementById('projectColorInput').value;p.description=document.getElementById('projectDescInput').value.trim();}}
  else{projects.push({id:'p'+Date.now(),name:name,color:document.getElementById('projectColorInput').value,description:document.getElementById('projectDescInput').value.trim(),createdAt:Date.now()});}
  saveProjects(projects);closeProjectModal();renderProjects();populateProjectFilter();toast(tr("Project saved"));
}
function deleteProject(id){
  if(!confirm(tr("Delete this project?"))) { return; }
  const projects=loadProjects().filter(p=>p.id!==id);saveProjects(projects);
  const tasks=loadTasks();tasks.forEach(t=>{if(t.project===id){t.project='';}});saveTasks(tasks);renderProjects();toast(tr("Project deleted"));
}
function filterByProject(id){showPage('tasks');document.getElementById('filterProject').value=id;renderTasks();}
function populateProjectFilter(){
  const projects=loadProjects();
  ['filterProject','taskProjectInput','dashProjectFilter'].forEach(elId=>{
    const el=document.getElementById(elId);if(!el)return;
    const val=el.value;
    const opts=("<option value=\"all\">"+tr("All Projects")+"</option>")+projects.map(p=>'<option value="'+p.id+'">'+escHtml(p.name)+'</option>').join('');
    el.innerHTML=elId==='taskProjectInput'?'<option value="">'+tr('option_no_project')+'</option>'+projects.map(p=>'<option value="'+p.id+'">'+escHtml(p.name)+'</option>').join(''):opts;
    const fallbackValue=elId==='taskProjectInput'?'':'all';
    el.value=[...el.options].some(o=>o.value===val)?val:fallbackValue;
  });
  populateAssigneeFilter();
}

/* ═══════ EISENHOWER MATRIX ═══════ */
function renderEisenhower(){
  const tasks=loadTasks().filter(t=>t.status!=='done');
  const quadrants=[
    {key:'q1',label:tr("Urgent & Important"),clr:'#ef4444',desc:tr("Do First"),icon:'\u{1F525}',emptyIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',emptyMsg:tr("No urgent & important tasks")},
    {key:'q2',label:tr("Not Urgent & Important"),clr:'#3b82f6',desc:tr("Schedule"),icon:'\u{1F4C5}',emptyIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',emptyMsg:tr("No tasks to schedule")},
    {key:'q3',label:tr("Urgent & Not Important"),clr:'#f59e0b',desc:tr("Delegate"),icon:'\u{1F91D}',emptyIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',emptyMsg:tr("No tasks to delegate")},
    {key:'q4',label:tr("Not Urgent & Not Important"),clr:'#6b7280',desc:tr("Eliminate"),icon:'\u{1F5D1}',emptyIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',emptyMsg:tr("Nothing to eliminate")}
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
  if(t){t.eisenhower=quadrant;saveTasks(tasks);renderEisenhower();toast(tr("Moved to ")+tr(({q1:'eh_do_first',q2:'eh_schedule',q3:'eh_delegate',q4:'eh_eliminate'})[quadrant]));}
  dragTaskId=null;
}

/* ═══════ GOALS ═══════ */
function renderGoals(){
  let goals=loadGoals();
  const filter=goalFilter||'all';
  if(filter!=='all') goals=goals.filter(g=>g.type===filter);
  const c=document.getElementById('goalsList');
  if(!goals.length){c.innerHTML=("<div class=\"empty-state\"><h3>"+tr("No Goals")+"</h3><p>"+tr("Set your first goal")+"</p><button class=\"btn btn-sm btn-primary\" onclick=\"openGoalModal()\">"+tr("Create Goal")+"</button></div>");return;}
  const tasks=loadTasks(), habits=loadHabits();
  c.innerHTML=goals.map(g=>{
    const p=computeGoalProgress(g,tasks,habits), pct=p.pct;
    const autoBadge=p.auto?'<span class="tag" style="font-size:.6rem;background:var(--primary);color:#fff">'+tr('goal_auto_badge')+'</span>':'';
    return '<div class="goal-card"><div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><h3 style="font-size:.95rem;font-weight:700">'+escHtml(g.title)+'</h3><span class="tag" style="font-size:.65rem;background:var(--surface3)">'+tr('goal_'+g.type)+'</span>'+autoBadge+'</div><div style="display:flex;gap:4px"><button class="btn-icon" onclick="openGoalModal(\''+g.id+'\')" style="color:var(--text3)">&#9998;</button><button class="btn-icon" onclick="deleteGoal(\''+g.id+'\')" style="color:var(--danger)">&#128465;</button></div></div><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:4px"><span>'+escHtml(g.unit==='tasks'||!g.unit?tr('Tasks'):g.unit)+'</span><span style="font-weight:700">'+p.current+'/'+g.target+'</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+pct+'%;background:'+(pct>=100?'var(--success)':'var(--primary)')+'"></div></div><div style="text-align:center;font-size:1.2rem;font-weight:800;margin-top:6px;color:'+(pct>=100?'var(--success)':'var(--primary)')+'">'+pct+'%</div></div>';
  }).join('');
}
function goalLinkOptions(linkType, selected){
  if(linkType==='project') return loadProjects().map(p=>'<option value="'+p.id+'"'+(p.id===selected?' selected':'')+'>'+escHtml(p.name)+'</option>').join('');
  if(linkType==='category'){ const cats=[...new Set(loadTasks().map(t=>t.category).filter(Boolean))]; return cats.map(c=>'<option value="'+escHtml(c)+'"'+(c===selected?' selected':'')+'>'+escHtml(c)+'</option>').join(''); }
  if(linkType==='habit') return loadHabits().map(h=>'<option value="'+h.id+'"'+(h.id===selected?' selected':'')+'>'+escHtml(h.name)+'</option>').join('');
  return '';
}
function updateGoalLinkUI(selectedValue){
  const linkType=document.getElementById('goalLinkTypeInput').value;
  const valueGroup=document.getElementById('goalLinkValueGroup');
  const currentGroup=document.getElementById('goalCurrentGroup');
  const hint=document.getElementById('goalAutoHint');
  if(!linkType){
    valueGroup.style.display='none'; currentGroup.style.display='block'; hint.style.display='none';
    return;
  }
  valueGroup.style.display='block'; currentGroup.style.display='none'; hint.style.display='block';
  const options=goalLinkOptions(linkType, selectedValue);
  const emptyLabels={habit:tr("No habits yet"),project:tr("No projects yet"),category:tr("No categories yet")};
  const emptyLabel=emptyLabels[linkType]||emptyLabels.category;
  document.getElementById('goalLinkValueInput').innerHTML=options||'<option value="">'+emptyLabel+'</option>';
}
function openGoalModal(id){
  const g=id?loadGoals().find(x=>x.id===id):null;
  editingGoalId=id||null;
  document.getElementById('goalTitleInput').value=g?g.title:'';
  document.getElementById('goalTypeInput').value=g?g.type:'weekly';
  document.getElementById('goalTargetInput').value=g?g.target:5;
  document.getElementById('goalCurrentInput').value=g?g.current||0:0;
  document.getElementById('goalUnitInput').value=g?g.unit||'tasks':'tasks';
  document.getElementById('goalLinkTypeInput').value=g?g.linkType||'':'';
  updateGoalLinkUI(g?g.linkId:'');
  document.getElementById('goalModal').classList.add('active');
  refreshEditorLabels();
}
function closeGoalModal(){document.getElementById('goalModal').classList.remove('active');editingGoalId=null;}
function saveGoal(){
  const title=document.getElementById('goalTitleInput').value.trim();
  if(!title){toast(tr("Goal title required"));return;}
  const goals=loadGoals();
  const linkType=document.getElementById('goalLinkTypeInput').value;
  const data={title:title,type:document.getElementById('goalTypeInput').value,target:Number.parseInt(document.getElementById('goalTargetInput').value)||5,current:Number.parseInt(document.getElementById('goalCurrentInput').value)||0,unit:document.getElementById('goalUnitInput').value.trim()||'tasks',linkType:linkType,linkId:linkType?document.getElementById('goalLinkValueInput').value:''};
  if(editingGoalId){const g=goals.find(x=>x.id===editingGoalId);if(g)Object.assign(g,data);}
  else{goals.push({id:'g'+Date.now(),...data,createdAt:Date.now()});}
  saveGoals(goals);closeGoalModal();renderGoals();renderDashGoals();toast(tr("Goal saved"));
}
function deleteGoal(id){
  if(!confirm(tr("Delete this goal?"))) { return; }
  saveGoals(loadGoals().filter(g=>g.id!==id));renderGoals();renderDashGoals();toast(tr("Goal deleted"));
}
function filterGoals(type){goalFilter=type;['goalFilterWeekly','goalFilterMonthly','goalFilterAll'].forEach(id=>{const b=document.getElementById(id);if(b)b.classList.toggle('active',id==='goalFilter'+type.charAt(0).toUpperCase()+type.slice(1));});renderGoals();}

/* ═══════ HABITS ═══════ */
function renderHabits(){
  const habits=loadHabits();
  const c=document.getElementById('habitsList');
  if(!habits.length){c.innerHTML=("<div class=\"empty-state\"><h3>"+tr("No Habits")+"</h3><p>"+tr("Start tracking a habit")+"</p><button class=\"btn btn-sm btn-primary\" onclick=\"openHabitModal()\">"+tr("Create Habit")+"</button></div>");return;}
  c.innerHTML=habits.map(h=>{
    const streak=calcHabitStreak(h);
    const days=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const ds=localDateStr(d);days.push({ds:ds,done:h.completions?.[ds],label:weekdayLabel(d, 'narrow'),today:i===0});}
    return '<div class="habit-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="font-size:.95rem;font-weight:700">'+escHtml(h.name)+'</h3><div style="display:flex;gap:4px;align-items:center"><span style="font-size:.72rem;color:var(--text3)">'+tr('streak_days',{n:streak})+' &#128293;</span><button class="btn-icon" onclick="openHabitModal(\''+h.id+'\')" style="color:var(--text3)">&#9998;</button><button class="btn-icon" onclick="deleteHabit(\''+h.id+'\')" style="color:var(--danger)">&#128465;</button></div></div><div class="habit-week">'+days.map(d=>'<div class="habit-day'+(d.done?' done':'')+(d.today?' today':'')+'" onclick="toggleHabitDay(\''+h.id+'\',\''+d.ds+'\')"><div class="habit-dot"></div><span>'+d.label+'</span></div>').join('')+'</div></div>';
  }).join('');
}
function calcHabitStreak(h){
  if(!h.completions) return 0;
  let streak=0, ds=todayStr();
  if(!h.completions[ds]) ds=addDaysToDateStr(ds,-1);
  for(let i=0;i<365;i++){ if(h.completions[ds]){ streak++; ds=addDaysToDateStr(ds,-1); } else break; }
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
  refreshEditorLabels();
}
function closeHabitModal(){document.getElementById('habitModal').classList.remove('active');editingHabitId=null;}
function saveHabit(){
  const name=document.getElementById('habitNameInput').value.trim();
  if(!name){toast(tr("Habit name required"));return;}
  const habits=loadHabits();
  if(editingHabitId){const h=habits.find(x=>x.id===editingHabitId);if(h)h.name=name;}
  else{habits.push({id:'h'+Date.now(),name:name,completions:{},createdAt:Date.now()});}
  saveHabits(habits);closeHabitModal();renderHabits();renderDashHabits();toast(tr("Habit saved"));
}
function deleteHabit(id){
  if(!confirm(tr("Delete this habit?"))) { return; }
  saveHabits(loadHabits().filter(h=>h.id!==id));renderHabits();renderDashHabits();toast(tr("Habit deleted"));
}

/* ═══════ NOTES ═══════ */
function renderNotes(){
  let notes=loadNotes();
  const search=document.getElementById('noteSearch')?document.getElementById('noteSearch').value.trim().toLowerCase():'';
  if(noteFolder) notes=notes.filter(n=>(n.folder||'')===(noteFolder==='unfiled'?'':noteFolder));
  if(search) notes=notes.filter(n=>n.title.toLowerCase().includes(search)||(n.content||'').toLowerCase().includes(search));
  notes.sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt));
  const folders=new Set(loadNotes().map(n=>n.folder||'').filter(Boolean));
  document.getElementById('notesFolders').innerHTML='<div class="note-folder'+(noteFolder===''||!noteFolder?' active':'')+("\" onclick=\"setNoteFolder('')\">"+tr("All Notes")+"</div>")+
    '<div class="note-folder'+(noteFolder==='unfiled'?' active':'')+("\" onclick=\"setNoteFolder('unfiled')\">"+tr("Unfiled")+"</div>")+
    [...folders].map(f=>'<div class="note-folder'+(noteFolder===f?' active':'')+'" onclick="setNoteFolder('+inlineArg(f)+')">&#128193; '+escHtml(f)+'</div>').join('');
  const c=document.getElementById('notesGrid');
  if(!notes.length){c.innerHTML=("<div class=\"empty-state\"><h3>"+tr("No Notes")+"</h3><p>"+tr("Create your first note")+"</p><button class=\"btn btn-sm btn-primary\" onclick=\"openNoteEditor()\">"+tr("Create Note")+"</button></div>");return;}
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
  refreshEditorLabels();
  updateNotePreview();
}
function closeNoteEditor(){document.getElementById('noteEditorModal').classList.remove('active');editingNoteId=null;}
function updateNotePreview(){
  const md=document.getElementById('noteContentInput').value;
  document.getElementById('notePreview').innerHTML=renderMd(md)||("<p style=\"color:var(--text3)\">"+tr("Preview will appear here...")+"</p>");
}
function saveNote(){
  const title=document.getElementById('noteTitleInput').value.trim()||tr("Untitled Note");
  const notes=loadNotes();
  const data={title:title,content:document.getElementById('noteContentInput').value,folder:document.getElementById('noteFolderInput').value.trim(),pinned:document.getElementById('notePinInput').checked,updatedAt:Date.now()};
  if(editingNoteId){const n=notes.find(x=>x.id===editingNoteId);if(n)Object.assign(n,data);}
  else{notes.push({id:'n'+Date.now(),...data,createdAt:Date.now()});}
  saveNotes(notes);closeNoteEditor();renderNotes();toast(tr("Note saved"));
}
function deleteNote(){
  if(!editingNoteId||!confirm(tr("Delete this note?"))) return;
  saveNotes(loadNotes().filter(n=>n.id!==editingNoteId));closeNoteEditor();renderNotes();toast(tr("Note deleted"));
}

/* ═══════ TIME REPORTS ═══════ */
function renderReports(){
  const tasks=loadTasks();
  const logged=tasks.filter(t=>t.logged_hours>0);
  const totalH=logged.reduce((s,t)=>s+(t.logged_hours||0),0);
  const byCategory={},byProject={},byDay={};
  logged.forEach(t=>{
    const c=t.category||tr("Other");byCategory[c]=(byCategory[c]||0)+(t.logged_hours||0);
    if(t.project){const pn=getProjectName(t.project)||tr("Unknown");byProject[pn]=(byProject[pn]||0)+(t.logged_hours||0);}
    if(t.completedAt){const ds=dateOfMs(t.completedAt);byDay[ds]=(byDay[ds]||0)+(t.logged_hours||0);}
  });
  function barChart(data,maxH){
    const entries=Object.entries(data).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const max=Math.max(...entries.map(e=>e[1]),1);
    return entries.map(([k,v])=>'<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px"><span>'+escHtml(k)+'</span><span style="font-weight:600">'+tr('hours_value',{n:v.toFixed(1)})+'</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+Math.round(v/max*100)+'%;background:var(--primary)"></div></div></div>').join('');
  }
  document.getElementById('reportGrid').innerHTML=
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">'+
    ("<div class=\"card\"><div class=\"card-title\">"+tr("Total Logged")+"</div><div style=\"text-align:center;padding:16px\"><div style=\"font-size:2.5rem;font-weight:900;color:var(--primary)\">")+totalH.toFixed(1)+("</div><p style=\"color:var(--text3);font-size:.82rem\">"+tr("hours across ")+"")+logged.length+(""+tr(" tasks")+"</p></div></div>")+
    ("<div class=\"card\"><div class=\"card-title\">"+tr("Hours by Category")+"</div>")+(Object.keys(byCategory).length?barChart(byCategory):("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:12px\">"+tr("No data")+"</p>"))+'</div>'+
    ("<div class=\"card\"><div class=\"card-title\">"+tr("Hours by Project")+"</div>")+(Object.keys(byProject).length?barChart(byProject):("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:12px\">"+tr("No data")+"</p>"))+'</div>'+
    ("<div class=\"card\"><div class=\"card-title\">"+tr("Hours by Day (Recent)")+"</div>")+(Object.keys(byDay).length?barChart(byDay):("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:12px\">"+tr("No data")+"</p>"))+'</div>'+
    '</div>';
}

/* ═══════ LIFE BALANCE (evidence-based daily time-use scoring) ═══════ */
/* Verdict scoring is a heuristic composite for self-reflection, not a validated clinical index.
   Category thresholds are drawn from the specific public-health sources cited in LB_SOURCES/lbEvaluate* below. */
let lbDate = todayStr();
const LB_FIELDS = [
  {key:'sleep',label:'Sleep',icon:'&#127769;'},
  {key:'work',label:'Work',icon:'&#128188;'},
  {key:'study',label:'Study',icon:'&#128218;'},
  {key:'exercise',label:'Exercise',icon:'&#127939;'},
  {key:'social',label:'Social',icon:'&#128101;'},
  {key:'leisure',label:'Leisure',icon:'&#127918;'}
];
const LB_STATUS_SCORE = {optimal:100, good:80, caution:55, low:30, high:40, none:10, na:null};
const LB_STATUS_LABEL = {optimal:'Optimal', good:'Good', caution:'Caution', low:'Too Low', high:'Too High', none:'None Logged', na:'Not Scored'};
function lbClampHours(v){ return Math.max(0, Math.min(24, Number.parseFloat(v)||0)); }
function loadLbLog(date){
  try{ const v=JSON.parse(localStorage.getItem(userKey('taskflow_timelog_'+date))); return (v&&typeof v==='object')?v:{}; }catch{ return {}; }
}
function saveLbLog(date, log){ localStorage.setItem(userKey('taskflow_timelog_'+date), JSON.stringify(log)); syncKey(userKey('taskflow_timelog_'+date)); }
function lbNav(delta){
  lbDate=addDaysToDateStr(lbDate, delta); renderLifeBalance();
}
function lbToday(){ lbDate=todayStr(); renderLifeBalance(); }
function lbEvaluateSleep(h){
  if(h>=7&&h<=9) return {status:'optimal', note:tr("Within the 7–9h adult range recommended by sleep-health guidelines.")};
  if(h>=6&&h<7) return {status:'caution', note:tr("Slightly under the recommended 7–9h — occasional, not chronic, is the goal.")};
  if(h>9&&h<=10) return {status:'caution', note:tr("Slightly over 9h — fine occasionally; consistently needing this much can also signal poor sleep quality.")};
  if(h<6) return {status:'low', note:tr("Well under the recommended range; chronic short sleep is linked to impaired cognition, mood and long-term health risk.")};
  return {status:'high', note:tr("Well over the typical range; if this is a consistent pattern it may be worth discussing with a doctor.")};
}
function lbEvaluateExercise(h){
  const mins=h*60;
  if(mins>=30) return {status:'optimal', note:tr("Meets/exceeds the ~30 min/day average implied by WHO’s 150–300 min/week guideline.")};
  if(mins>=10) return {status:'caution', note:tr("Below the general 150 min/week guideline, but still more than none — worth building on.")};
  if(mins>0) return {status:'low', note:tr("Well below recommended activity levels for cardiovascular and mental-health benefits.")};
  return {status:'none', note:tr("No activity logged. Even short daily movement has measurable health benefits.")};
}
function lbEvaluateLeisure(h){
  if(h>=1&&h<=5) return {status:'optimal', note:tr("Discretionary time in the range associated with peak subjective well-being (highest around ~2h).")};
  if(h<1) return {status:'low', note:tr("Very little discretionary time is associated with feeling time-starved and lower well-being.")};
  return {status:'high', note:tr("Large amounts of unstructured time show diminishing (sometimes slightly negative) well-being returns unless spent purposefully.")};
}
function lbEvaluateSocial(h){
  if(h>=1) return {status:'optimal', note:tr("Meaningful social contact is one of the strongest predictors of long-term well-being.")};
  if(h>0) return {status:'low', note:tr("Some connection logged, but more consistent social time is consistently linked to better outcomes.")};
  return {status:'none', note:tr("No social time logged. Isolation is an established risk factor for both mental and physical health.")};
}
function lbEvaluateStudy(h){
  if(h===0) return {status:'na', note:tr("No study time logged today — not scored, since not everyone studies daily.")};
  if(h<=4) return {status:'good', note:tr("Within the range where focused cognitive work stays sustainable (deliberate-practice research puts the ceiling near 4h/day even for experts).")};
  if(h<=6) return {status:'caution', note:tr("Above the range associated with sustained peak performance — make sure real breaks are built in.")};
  return {status:'high', note:tr("Sustained high cognitive load without recovery is linked to diminishing returns and burnout risk.")};
}
function lbEvaluateWeeklyWork(weeklyHours, daysLogged){
  if(daysLogged===0) return {status:'na', note:tr("No work hours logged in the past 7 days.")};
  if(weeklyHours<=40) return {status:'optimal', note:tr("At or under the standard 40h/week.")};
  if(weeklyHours<=55) return {status:'caution', note:tr("Above standard full-time hours; sustained overwork in this range carries rising health risk.")};
  return {status:'high', note:tr("Above 55h/week — a WHO/ILO joint study linked this level to a 35% higher stroke risk and 17% higher risk of fatal ischemic heart disease versus 35–40h/week.")};
}
function lbBadgeHtml(status){
  const colors={optimal:'var(--success)',good:'var(--success)',caution:'var(--warning)',low:'var(--danger)',high:'var(--danger)',none:'var(--text3)',na:'var(--text3)'};
  return '<span class="lb-badge" style="background:'+colors[status]+'">'+tr(LB_STATUS_LABEL[status])+'</span>';
}
function lbFieldChanged(){
  const log={};
  LB_FIELDS.forEach(f=>{ log[f.key]=lbClampHours(document.getElementById('lbIn_'+f.key).value); });
  saveLbLog(lbDate, log);
  lbRenderCalculations(log);
}
function lbRenderCalculations(log){
  const sum=LB_FIELDS.reduce((s,f)=>s+(log[f.key]||0),0);
  const other=Math.max(0,24-sum);
  document.getElementById('lbSumHint').textContent = sum>24
    ? tr("— logged ")+sum.toFixed(1)+tr("h, that’s more than 24h in a day, adjust your entries")
    : '— '+sum.toFixed(1)+tr("h logged, ")+other.toFixed(1)+tr("h unaccounted for (commute, meals, chores, etc.)");
  const evals={
    sleep:lbEvaluateSleep(log.sleep||0),
    exercise:lbEvaluateExercise(log.exercise||0),
    leisure:lbEvaluateLeisure(log.leisure||0),
    social:lbEvaluateSocial(log.social||0),
    study:lbEvaluateStudy(log.study||0)
  };
  const weeklyWork=lbWeeklyWorkSummary();
  evals.work=weeklyWork.evaluation;
  const labels={sleep:tr("Sleep"),exercise:tr("Exercise"),leisure:tr("Leisure"),social:tr("Social"),study:tr("Study"),work:tr("Work (weekly)")};
  document.getElementById('lbBreakdown').innerHTML=Object.keys(evals).map(k=>{
    const e=evals[k];
    return '<div class="lb-cat-card" style="border-left-color:'+({optimal:'var(--success)',good:'var(--success)',caution:'var(--warning)',low:'var(--danger)',high:'var(--danger)',none:'var(--text3)',na:'var(--text3)'}[e.status])+'">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><strong>'+labels[k]+'</strong>'+lbBadgeHtml(e.status)+'</div>'+
      '<p style="font-size:.78rem;color:var(--text2);margin-top:4px">'+e.note+'</p></div>';
  }).join('');
  const scored=['sleep','exercise','leisure','social','work'].map(k=>LB_STATUS_SCORE[evals[k].status]).filter(v=>v!==null);
  const overall=scored.length?Math.round(scored.reduce((a,b)=>a+b,0)/scored.length):null;
  let overallLabel=tr("Not enough data"), overallColor='var(--text3)';
  if(overall!==null){
    if(overall>=85){overallLabel=tr("Excellent balance");overallColor='var(--success)';}
    else if(overall>=65){overallLabel=tr("Good balance");overallColor='var(--success)';}
    else if(overall>=45){overallLabel=tr("Needs attention");overallColor='var(--warning)';}
    else {overallLabel=tr("Poor balance");overallColor='var(--danger)';}
  }
  document.getElementById('lbScoreCard').innerHTML=
    '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">'+
      '<div style="width:100px;height:100px;border-radius:50%;border:6px solid '+overallColor+';display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-size:1.6rem;font-weight:800">'+(overall!==null?overall:'--')+'</span></div>'+
      '<div><div style="font-size:1.1rem;font-weight:800;color:'+overallColor+'">'+overallLabel+'</div>'+
      ("<p style=\"font-size:.8rem;color:var(--text3);max-width:480px;margin-top:4px\">"+tr("Composite of sleep, exercise, leisure, social and weekly work-hour scores against the sources below. Study time is shown for reflection but not included, since there’s no universal healthy amount.")+"</p></div>")+
    '</div>';
  document.getElementById('lbWeekly').innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><strong>'+weeklyWork.totalHours.toFixed(1)+tr("h over last ")+weeklyWork.daysLogged+(""+tr(" logged day(s)")+"</strong>")+lbBadgeHtml(weeklyWork.evaluation.status)+'</div>'+
    '<p style="font-size:.78rem;color:var(--text2);margin-top:6px">'+weeklyWork.evaluation.note+'</p>';
}
function lbWeeklyWorkSummary(){
  let totalHours=0, daysLogged=0;
  for(let i=0;i<7;i++){
    const ds=addDaysToDateStr(lbDate, -i);
    const log=loadLbLog(ds);
    if(log&&Object.hasOwn(log,'work')){ totalHours+=lbClampHours(log.work); daysLogged++; }
  }
  return {totalHours, daysLogged, evaluation:lbEvaluateWeeklyWork(totalHours, daysLogged)};
}
function toggleLbSources(){
  const el=document.getElementById('lbSources');
  const show=el.style.display==='none';
  el.style.display=show?'block':'none';
  document.getElementById('lbSourcesToggle').textContent=show?tr('lb_hide_sources'):tr('lb_show_sources');
  if(show&&!el.dataset.filled){
    el.dataset.filled='1';
    el.innerHTML=
      tr('lb_sources_html')+
      ("<p style=\"color:var(--text3);margin-top:8px\">"+tr("These are population-level research findings used as reflection benchmarks, not individualized medical advice. Needs vary by age, health status and personal circumstances.")+"</p>");
  }
}
function renderLifeBalance(){
  const isToday=lbDate===todayStr();
  document.getElementById('lbDateLabel').innerHTML=(isToday?tr("Today &bull; "):'')+escHtml(new Date(lbDate+'T00:00:00').toLocaleDateString(appLocale(),{weekday:'short',month:'short',day:'numeric'}));
  const log=loadLbLog(lbDate);
  document.getElementById('lbInputGrid').innerHTML=LB_FIELDS.map(f=>
    '<div class="lb-field"><label for="lbIn_'+f.key+'">'+f.icon+' '+tr(f.label)+'</label><input type="number" id="lbIn_'+f.key+'" min="0" max="24" step="0.25" placeholder="0" value="'+(log[f.key]!=null?log[f.key]:'')+'" oninput="lbFieldChanged()"></div>'
  ).join('');
  lbRenderCalculations(log);
}

/* ═══════ PROGRESS & CHALLENGES (auto-calculated from activity, self-competition only) ═══════ */
function dateOfMs(ms){ return localDateStr(new Date(ms)); }
function lbDailyScore(log){
  if(!log) return null;
  const keys=['sleep','exercise','leisure','social'];
  if(!keys.some(k=>(log[k]||0)>0)) return null;
  const evalFns={sleep:lbEvaluateSleep,exercise:lbEvaluateExercise,leisure:lbEvaluateLeisure,social:lbEvaluateSocial};
  const scores=keys.filter(k=>(log[k]||0)>0).map(k=>LB_STATUS_SCORE[evalFns[k](log[k]).status]).filter(v=>v!=null);
  return scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):null;
}
function calcActivityScore(dateStr, tasks, habits){
  const dayTasks=tasks.filter(t=>t.completedAt&&dateOfMs(t.completedAt)===dateStr);
  const taskScore=dayTasks.length?Math.min(100, dayTasks.length*25):null;
  const hoursSum=dayTasks.reduce((s,t)=>s+(t.logged_hours||0),0);
  const hoursScore=hoursSum>0?Math.min(100, hoursSum/8*100):null;
  let habitScore=null;
  if(habits.length){ const doneCount=habits.filter(h=>h.completions?.[dateStr]).length; habitScore=Math.round(doneCount/habits.length*100); }
  const lbScore=lbDailyScore(loadLbLog(dateStr));
  const parts=[taskScore,hoursScore,habitScore,lbScore].filter(v=>v!=null);
  return parts.length?Math.round(parts.reduce((a,b)=>a+b,0)/parts.length):null;
}
function getActivityScoreSeries(days){
  const tasks=loadTasks(), habits=loadHabits(), today=todayStr(), out=[];
  for(let i=days-1;i>=0;i--){ const ds=addDaysToDateStr(today,-i); out.push({date:ds, score:calcActivityScore(ds,tasks,habits)}); }
  return out;
}
function calcBestRollingWeek(tasks, metric, lookbackDays=180){
  const perDay={};
  tasks.forEach(t=>{
    if(!t.completedAt) return;
    const ds=dateOfMs(t.completedAt);
    if(!perDay[ds]) perDay[ds]={tasks:0,hours:0};
    perDay[ds].tasks++;perDay[ds].hours+=(t.logged_hours||0);
  });
  const today=todayStr();
  let best=0;
  for(let i=0;i<lookbackDays;i++){
    const end=addDaysToDateStr(today,-i);
    let sum=0;
    for(let j=0;j<7;j++){ const ds=addDaysToDateStr(end,-j); sum+=perDay[ds]?perDay[ds][metric]:0; }
    if(sum>best) best=sum;
  }
  return Math.round(best*10)/10;
}
function calcBestStreakEver(tasks){
  const uniq=[...new Set(tasks.filter(t=>t.completedAt).map(t=>dateOfMs(t.completedAt)))].sort((a,b)=>a.localeCompare(b));
  let best=0,cur=0,prev=null;
  uniq.forEach(ds=>{ cur=(prev&&ds===addDaysToDateStr(prev,1))?cur+1:1; best=Math.max(best,cur); prev=ds; });
  return best;
}
function calcBestHabitStreakEver(){
  let best=0;
  loadHabits().forEach(h=>{
    if(h.completions){
      const dates=Object.keys(h.completions).filter(k=>h.completions[k]).sort((a,b)=>a.localeCompare(b));
      let cur=0,prev=null;
      dates.forEach(ds=>{ cur=(prev&&ds===addDaysToDateStr(prev,1))?cur+1:1; best=Math.max(best,cur); prev=ds; });
    }
  });
  return best;
}
/* Challenges: self-set targets, auto-tracked against your own activity, no manual progress entry */
function loadChallenges(){ try{ return JSON.parse(localStorage.getItem(userKey('taskflow_challenges')))||[]; }catch{ return []; } }
function saveChallenges(list){ persistData(userKey('taskflow_challenges'), JSON.stringify(list)); }
function normalizeChallenge(c){
  return {
    id:asText(c.id,80)||'ch'+genId(),
    title:asText(c.title,100),
    metric:asChoice(c.metric,['tasks','hours','habits','streak'],'tasks'),
    target:Math.max(1, Number.parseFloat(c.target)||1),
    days:Math.max(1, Math.min(90, Number.parseInt(c.days)||7)),
    startDate:asDateText(c.startDate)||todayStr(),
    createdAt:Number(c.createdAt)||Date.now(),
    status:asChoice(c.status,['active','completed','expired'],'active'),
    completedAt:c.completedAt?Number(c.completedAt):null
  };
}
const CHALLENGE_METRIC_LABEL={tasks:'Tasks Completed', hours:'Hours Logged', habits:'Habit Check-ins', streak:'Day Completion Streak'};
function getChallengeProgress(ch, tasks, habits){
  if(ch.metric==='streak'){
    const current=calcStreak(tasks);
    return {current, target:ch.target, pct:Math.min(100,Math.round(current/ch.target*100)), done:current>=ch.target, expired:false};
  }
  const periodEnd=addDaysToDateStr(ch.startDate, ch.days);
  let current=0;
  if(ch.metric==='tasks'||ch.metric==='hours'){
    tasks.forEach(t=>{ if(t.completedAt){ const ds=dateOfMs(t.completedAt); if(ds>=ch.startDate&&ds<periodEnd) current+=ch.metric==='tasks'?1:(t.logged_hours||0); } });
  } else if(ch.metric==='habits'){
    habits.forEach(h=>{
      if(!h.completions) return;
      Object.keys(h.completions).forEach(ds=>{ if(h.completions[ds]&&ds>=ch.startDate&&ds<periodEnd) current++; });
    });
  }
  current=Math.round(current*10)/10;
  const done=current>=ch.target;
  const expired=!done&&todayStr()>=periodEnd;
  return {current, target:ch.target, pct:Math.min(100,Math.round(current/ch.target*100)), done, expired, periodEnd};
}
function refreshChallengeStatuses(){
  const challenges=loadChallenges(), tasks=loadTasks(), habits=loadHabits();
  let changed=false; const justCompleted=[];
  challenges.forEach(ch=>{
    if(ch.status!=='active') return;
    const p=getChallengeProgress(ch,tasks,habits);
    if(p.done){ ch.status='completed'; ch.completedAt=Date.now(); changed=true; justCompleted.push(ch); }
    else if(p.expired){ ch.status='expired'; changed=true; }
  });
  if(changed) saveChallenges(challenges);
  return justCompleted;
}
function autoChallengeTitle(metric,target,days){
  if(metric==='streak') return tr('auto_challenge_streak',{n:target});
  const unit=tr(CHALLENGE_METRIC_LABEL[metric] || CHALLENGE_METRIC_LABEL.tasks);
  return tr('auto_challenge_period',{target,unit,days});
}
function openChallengeModal(){
  document.getElementById('challengeTitleInput').value='';
  document.getElementById('challengeMetricInput').value='tasks';
  document.getElementById('challengeTargetInput').value=10;
  document.getElementById('challengeDaysInput').value=7;
  updateChallengeMetricUI();
  document.getElementById('challengeModal').classList.add('active');
}
function closeChallengeModal(){ document.getElementById('challengeModal').classList.remove('active'); }
function updateChallengeMetricUI(){
  const metric=document.getElementById('challengeMetricInput').value;
  document.getElementById('challengeDaysGroup').style.display=metric==='streak'?'none':'block';
}
function saveChallenge(){
  const metric=document.getElementById('challengeMetricInput').value;
  const target=Number.parseFloat(document.getElementById('challengeTargetInput').value)||1;
  const days=Number.parseInt(document.getElementById('challengeDaysInput').value)||7;
  const title=document.getElementById('challengeTitleInput').value.trim()||autoChallengeTitle(metric,target,days);
  const challenges=loadChallenges();
  challenges.push(normalizeChallenge({title,metric,target,days,startDate:todayStr(),createdAt:Date.now(),status:'active'}));
  saveChallenges(challenges);
  closeChallengeModal();
  toast(tr("Challenge started"));
  renderProgress();
}
function startSuggestedChallenge(metric,target,days){
  const challenges=loadChallenges();
  challenges.push(normalizeChallenge({title:autoChallengeTitle(metric,target,days),metric,target,days,startDate:todayStr(),createdAt:Date.now(),status:'active'}));
  saveChallenges(challenges);
  toast(tr("Challenge started &mdash; beat your record!"));
  renderProgress();
}
function deleteChallenge(id){
  saveChallenges(loadChallenges().filter(c=>c.id!==id));
  renderProgress();
}
function renderActivityChart(series){
  const w=100,h=40;
  const n=series.length;
  const stepX=n>1?w/(n-1):w;
  const segments=[]; let current=[];
  series.forEach((pt,i)=>{
    if(pt.score==null){ if(current.length){segments.push(current);current=[];} return; }
    const x=i*stepX, y=h-(pt.score/100)*h;
    current.push(x.toFixed(2)+','+y.toFixed(2));
  });
  if(current.length) segments.push(current);
  const paths=segments.map(seg=>'<polyline points="'+seg.join(' ')+'" fill="none" stroke="var(--primary)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>').join('');
  const dots=series.map((pt,i)=>{
    if(pt.score==null) return '';
    const x=i*stepX, y=h-(pt.score/100)*h, isLast=i===series.length-1;
    return '<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="'+(isLast?2.4:1.1)+'" fill="'+(isLast?'var(--primary)':'var(--primary-light)')+'"><title>'+pt.date+': '+pt.score+'</title></circle>';
  }).join('');
  const hasData=series.some(p=>p.score!=null);
  if(!hasData) return ("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:24px\">"+tr("No activity logged yet &mdash; complete tasks, check off habits, or log a Life Balance day to see your trend.")+"</p>");
  const first=series[0].date, mid=series[Math.floor(series.length/2)].date, last=series[series.length-1].date;
  return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="width:100%;height:160px;display:block">'+
    '<line x1="0" y1="'+h+'" x2="'+w+'" y2="'+h+'" stroke="var(--border)" stroke-width="0.5"/>'+
    '<line x1="0" y1="'+(h*0.5)+'" x2="'+w+'" y2="'+(h*0.5)+'" stroke="var(--border)" stroke-width="0.3" stroke-dasharray="2,2"/>'+
    paths+dots+
  '</svg><div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--text3);margin-top:4px"><span>'+fmtDate(first)+'</span><span>'+fmtDate(mid)+'</span><span>'+fmtDate(last)+'</span></div>';
}
function renderProgressTasksChart(tasks){
  const el=document.getElementById('progTasksChart'); if(!el) return;
  const today=todayStr(), bars=[];
  for(let i=13;i>=0;i--){
    const ds=addDaysToDateStr(today,-i);
    const count=tasks.filter(t=>t.completedAt&&dateOfMs(t.completedAt)===ds).length;
    bars.push({ds,count,isToday:i===0});
  }
  const max=Math.max(...bars.map(b=>b.count),1);
  el.innerHTML=bars.map(b=>'<div class="chart-bar-wrap"><div class="chart-bar" style="height:'+Math.max(b.count/max*140,4)+'px;background:'+(b.isToday?'var(--primary)':'var(--primary-light)')+';opacity:'+(b.isToday?1:.6)+'"><span class="tooltip">'+b.count+'</span></div><span class="label">'+new Date(b.ds+'T00:00:00Z').getUTCDate()+'</span></div>').join('');
}
function habitConsistencyPct(h, windowDays, today){
  let done=0;
  for(let i=0;i<windowDays;i++){ const ds=addDaysToDateStr(today,-i); if(h.completions?.[ds]) done++; }
  return Math.round(done/windowDays*100);
}
function renderHabitConsistency(containerId='progHabitConsistency',windowDays=30){
  const el=document.getElementById(containerId); if(!el) return;
  const habits=loadHabits();
  if(!habits.length){ el.innerHTML=("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:12px\">"+tr("No habits tracked yet")+"</p>"); return; }
  const today=todayStr();
  el.innerHTML=habits.map(h=>{
    const pct=habitConsistencyPct(h,windowDays,today);
    return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px"><span>'+escHtml(h.name)+'</span><span style="font-weight:600">'+pct+'%</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+pct+'%;background:var(--accent)"></div></div></div>';
  }).join('');
}
function renderChallengeList(){
  const el=document.getElementById('challengeList');
  const tasks=loadTasks(), habits=loadHabits();
  const challenges=loadChallenges().sort((a,b)=>b.createdAt-a.createdAt);
  if(!challenges.length){ el.innerHTML=("<p style=\"color:var(--text3);font-size:.82rem;text-align:center;padding:12px\">"+tr("No challenges yet &mdash; start one below or create your own.")+"</p>"); return; }
  el.innerHTML=challenges.map(ch=>{
    const p=getChallengeProgress(ch,tasks,habits);
    const badgeColors={completed:'var(--success)',expired:'var(--text3)',active:'var(--primary)'};
    const badgeLabels={completed:tr("&#127942; Completed"),expired:tr("Ended"),active:tr("Active")};
    const badgeColor=badgeColors[ch.status]||badgeColors.active;
    const badgeLabel=badgeLabels[ch.status]||badgeLabels.active;
    return '<div class="lb-cat-card" style="border-left-color:'+badgeColor+'">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><strong>'+escHtml(ch.title)+'</strong><span style="display:flex;align-items:center;gap:8px"><span class="lb-badge" style="background:'+badgeColor+'">'+badgeLabel+'</span><button class="btn-icon" onclick="deleteChallenge(\''+ch.id+("')\" style=\"color:var(--text3)\" title=\""+tr("Remove")+"\">&#128465;</button></span></div>")+
      '<div style="font-size:.78rem;color:var(--text2);margin:4px 0 6px">'+p.current+' / '+ch.target+' '+tr(CHALLENGE_METRIC_LABEL[ch.metric])+(ch.metric!=='streak'?' &bull; '+ch.days+tr("-day window"):'')+'</div>'+
      '<div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+p.pct+'%;background:'+badgeColor+'"></div></div>'+
    '</div>';
  }).join('');
}
function renderChallengeSuggestions(){
  const el=document.getElementById('challengeSuggestions');
  const tasks=loadTasks();
  const bestWeekTasks=calcBestRollingWeek(tasks,'tasks');
  const bestWeekHours=calcBestRollingWeek(tasks,'hours');
  const bestStreak=calcBestStreakEver(tasks);
  const bestHabitStreak=calcBestHabitStreakEver();
  const suggestions=[
    {metric:'tasks', days:7, target:Math.max(5,bestWeekTasks+1), note:tr("Your best 7-day run: ")+bestWeekTasks+tr(" tasks")},
    {metric:'hours', days:7, target:Math.max(5,Math.ceil(bestWeekHours)+1), note:tr("Your best 7-day run: ")+bestWeekHours+tr("h logged")},
    {metric:'streak', days:null, target:Math.max(3,bestStreak+1), note:tr("Your longest-ever streak: ")+bestStreak+tr(" day")+(lang==='ar'||bestStreak===1?'':'s')}
  ];
  if(loadHabits().length){ suggestions.push({metric:'habits', days:14, target:Math.max(5,bestHabitStreak+1), note:tr("Your longest-ever habit streak: ")+bestHabitStreak+tr(" day")+(lang==='ar'||bestHabitStreak===1?'':'s')}); }
  el.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">'+suggestions.map(s=>
    '<div class="tt-overflow-card" style="cursor:default"><div class="tt-ov-title">'+autoChallengeTitle(s.metric,s.target,s.days||0)+'</div><div class="tt-ov-meta">'+s.note+'</div><button class="btn btn-sm btn-outline" style="margin-top:8px;width:100%" onclick="startSuggestedChallenge(\''+s.metric+'\','+s.target+','+(s.days||1)+(")\">"+tr("Start Challenge")+"</button></div>")
  ).join('')+'</div>';
}
function renderProgress(){
  const justCompleted=refreshChallengeStatuses();
  if(justCompleted.length){ launchConfetti(); justCompleted.forEach(ch=>toast(tr("Challenge complete: ")+ch.title+' &#127881;','success')); }
  const tasks=loadTasks(), habits=loadHabits(), today=todayStr();
  const todayScore=calcActivityScore(today,tasks,habits);
  const streak=calcStreak(tasks), bestStreak=calcBestStreakEver(tasks);
  const activeCount=loadChallenges().filter(c=>c.status==='active').length;
  document.getElementById('progStats').innerHTML=
    ("<div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Activity Score Today")+"</h3><div class=\"num\">")+(todayScore!=null?todayScore:'—')+'</div></div></div>'+
    ("<div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Current Streak")+"</h3><div class=\"num\">")+streak+'</div></div></div>'+
    ("<div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Best Streak Ever")+"</h3><div class=\"num\">")+bestStreak+'</div></div></div>'+
    ("<div class=\"stat-card\" style=\"flex:1;min-width:120px\"><div class=\"stat-info\"><h3>"+tr("Challenges")+"</h3><div class=\"num\">")+activeCount+' <span style="font-size:.9rem;color:var(--text3)">'+tr('active')+'</span></div></div></div>';
  document.getElementById('progActivityChart').innerHTML=renderActivityChart(getActivityScoreSeries(30));
  renderProgressTasksChart(tasks);
  renderHabitConsistency();
  renderChallengeList();
  renderChallengeSuggestions();
  renderAchievements();
}

/* ═══════ WEEKLY REVIEW (pulls Goals + Habits + Life Balance together with one focus suggestion) ═══════ */
function weekRange(weeksAgo){
  const dow=new Date(todayStr()+'T00:00:00Z').getUTCDay();
  const thisWeekStart=addDaysToDateStr(todayStr(),-dow);
  const start=addDaysToDateStr(thisWeekStart,-7*weeksAgo);
  const end=weeksAgo===0?todayStr():addDaysToDateStr(start,6);
  return {start,end};
}
function countTasksCompletedInRange(tasks,start,end){
  return tasks.filter(t=>t.completedAt&&dateOfMs(t.completedAt)>=start&&dateOfMs(t.completedAt)<=end).length;
}
function lbWeeklyAverage(){
  const today=todayStr(); const scores=[];
  for(let i=0;i<7;i++){ const s=lbDailyScore(loadLbLog(addDaysToDateStr(today,-i))); if(s!=null) scores.push(s); }
  return scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):null;
}
function goalExpectedPct(g){
  const today=new Date(todayStr()+'T00:00:00Z');
  if(g.type==='monthly'){ const totalDays=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+1,0)).getUTCDate(); return Math.min(100,Math.round(today.getUTCDate()/totalDays*100)); }
  return Math.min(100,Math.round((today.getUTCDay()+1)/7*100));
}
function renderReviewGoals(goalRows){
  const c=document.getElementById('reviewGoals');
  if(!goalRows.length){ c.innerHTML='<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:12px">'+tr('review_no_goals')+'</p>'; }
  else {
    c.innerHTML=goalRows.map(r=>{
      const badge=r.behind?'<span class="lb-badge" style="background:var(--warning)">'+tr('goal_behind')+'</span>':'<span class="lb-badge" style="background:var(--success)">'+tr('goal_on_track')+'</span>';
      return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:center;font-size:.82rem;margin-bottom:3px;gap:8px"><span>'+escHtml(r.goal.title)+'</span>'+badge+'</div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:'+r.progress.pct+'%;background:'+(r.behind?'var(--warning)':'var(--primary)')+'"></div></div></div>';
    }).join('');
  }
}
function renderReviewVelocity(tasks){
  const thisWeek=weekRange(0), lastWeek=weekRange(1);
  const thisWeekCount=countTasksCompletedInRange(tasks,thisWeek.start,thisWeek.end);
  const lastWeekCount=countTasksCompletedInRange(tasks,lastWeek.start,lastWeek.end);
  const delta=thisWeekCount-lastWeekCount;
  let deltaColor='var(--text3)';
  if(delta>0) deltaColor='var(--success)';
  else if(delta<0) deltaColor='var(--danger)';
  const deltaSign=delta>0?'+':'';
  document.getElementById('reviewVelocity').innerHTML=
    '<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">'+
      '<div><div style="font-size:.72rem;color:var(--text3)">'+tr('review_this_week')+'</div><div style="font-size:1.8rem;font-weight:800;color:var(--primary)">'+thisWeekCount+'</div></div>'+
      '<div><div style="font-size:.72rem;color:var(--text3)">'+tr('review_last_week')+'</div><div style="font-size:1.8rem;font-weight:800;color:var(--text2)">'+lastWeekCount+'</div></div>'+
      '<div style="font-weight:700;color:'+deltaColor+'">'+deltaSign+delta+'</div>'+
    '</div>';

}
function renderReviewLifeBalance(){
  const lbAvg=lbWeeklyAverage();
  const lbEl=document.getElementById('reviewLifeBalance');
  if(lbAvg==null){ lbEl.innerHTML='<p style="color:var(--text3);font-size:.82rem;text-align:center;padding:12px">'+tr('review_no_lb')+'</p>'; }
  else{
    let color='var(--danger)';
    if(lbAvg>=65) color='var(--success)';
    else if(lbAvg>=45) color='var(--warning)';
    lbEl.innerHTML='<div style="display:flex;align-items:center;gap:16px"><div style="width:64px;height:64px;border-radius:50%;border:5px solid '+color+';display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-size:1.1rem;font-weight:800">'+lbAvg+'</span></div><div style="font-size:.82rem;color:var(--text2)">'+tr('review_lb_avg')+'</div></div>';
  }
  return lbAvg;
}
function renderReviewFocus(goalRows,worstHabit,lbAvg){
  let focusMsg=tr('focus_great'), focusColor='var(--success)';
  const worstGoal=goalRows.filter(r=>r.behind).sort((a,b)=>(a.progress.pct-goalExpectedPct(a.goal))-(b.progress.pct-goalExpectedPct(b.goal)))[0];
  if(worstGoal){ focusMsg=tr('focus_goal').replace('{name}',worstGoal.goal.title); focusColor='var(--warning)'; }
  else if(worstHabit&&worstHabit.pct<50){ focusMsg=tr('focus_habit').replace('{name}',worstHabit.h.name); focusColor='var(--warning)'; }
  else if(lbAvg!=null&&lbAvg<45){ focusMsg=tr('focus_lb'); focusColor='var(--warning)'; }
  document.getElementById('reviewFocusCard').innerHTML='<div style="display:flex;align-items:center;gap:12px"><div style="width:10px;height:10px;border-radius:50%;background:'+focusColor+';flex-shrink:0"></div><div style="font-size:.9rem;font-weight:600">'+focusMsg+'</div></div>';
}
function renderReview(){
  const tasks=loadTasks(),habits=loadHabits();
  const goalRows=loadGoals().map(goal=>{
    const progress=computeGoalProgress(goal,tasks,habits),expected=goalExpectedPct(goal);
    return {goal,progress,behind:progress.pct<100&&progress.pct<expected-15};
  });
  renderReviewGoals(goalRows);
  renderHabitConsistency('reviewHabits',7);
  const worstHabit=habits.map(h=>({h,pct:habitConsistencyPct(h,7,todayStr())})).sort((a,b)=>a.pct-b.pct)[0];
  renderReviewVelocity(tasks);
  const lbAvg=renderReviewLifeBalance();
  renderReviewFocus(goalRows,worstHabit,lbAvg);
}

/* ═══════ TODAY'S FOCUS (turns "what's behind" into "do this specific thing") ═══════ */
function computeTodaysFocus(){
  const tasks=loadTasks(), goals=loadGoals(), habits=loadHabits(), today=todayStr();
  const items=[];
  loadTasks().filter(isOverdue).slice(0,2).forEach(t=>items.push({color:'var(--danger)',tag:tr('focus_tag_overdue'),text:escHtml(t.title),onclick:"openModal('"+t.id+"')"}));
  tasks.filter(t=>t.status!=='done'&&t.due===today&&!isOverdue(t)).slice(0,2).forEach(t=>items.push({color:'var(--warning)',tag:tr('focus_tag_due_today'),text:escHtml(t.title),onclick:"openModal('"+t.id+"')"}));
  const behindGoals=goals.map(g=>{ const p=computeGoalProgress(g,tasks,habits), expected=goalExpectedPct(g); return {goal:g, behind:p.pct<100&&p.pct<expected-15}; }).filter(r=>r.behind).slice(0,2);
  behindGoals.forEach(r=>{
    const g=r.goal;
    if((g.linkType==='project'||g.linkType==='category')&&g.linkId){
      const candidates=tasks.filter(t=>t.status!=='done'&&t[g.linkType]===g.linkId).sort((a,b)=>(b.smartScore||0)-(a.smartScore||0));
      if(candidates.length){ items.push({color:'var(--primary)',tag:tr('focus_tag_goal'),text:tr('focus_do_task_for_goal').replace('{task}',escHtml(candidates[0].title)).replace('{goal}',escHtml(g.title)),onclick:"openModal('"+candidates[0].id+"')"}); return; }
    }
    if(g.linkType==='habit'&&g.linkId){
      const h=habits.find(x=>x.id===g.linkId);
      if(h&&!h.completions?.[today]){ items.push({color:'var(--accent)',tag:tr('focus_tag_habit'),text:tr('focus_checkin_habit').replace('{habit}',escHtml(h.name)).replace('{goal}',escHtml(g.title)),onclick:"showPage('habits')"}); return; }
    }
    items.push({color:'var(--primary)',tag:tr('focus_tag_goal'),text:tr('focus_update_goal').replace('{goal}',escHtml(g.title)),onclick:"showPage('goals')"});
  });
  return items.slice(0,6);
}
function renderTodaysFocus(){
  const el=document.getElementById('todaysFocusCard'); if(!el) return;
  const items=computeTodaysFocus();
  let html='<div class="card-title">'+tr('todays_focus_title')+'</div>';
  html+= items.length ? items.map(it=>'<div class="focus-item"><div class="focus-dot" style="background:'+it.color+'"></div><span class="focus-text" onclick="'+it.onclick+'">'+it.text+'</span><span class="focus-tag">'+it.tag+'</span></div>').join('')
    : '<p style="color:var(--text3);font-size:.85rem;padding:8px 0 0">'+tr('todays_focus_all_clear')+'</p>';
  el.innerHTML=html;
}

/* ═══════ ACHIEVEMENTS (earned from real activity, no manual claiming) ═══════ */
const BADGE_DEFS=[
  {id:'first_task',icon:'\u{1F331}',check:ctx=>ctx.tasksDoneCount>=1},
  {id:'ten_tasks',icon:'✅',check:ctx=>ctx.tasksDoneCount>=10},
  {id:'fifty_tasks',icon:'\u{1F680}',check:ctx=>ctx.tasksDoneCount>=50},
  {id:'hundred_tasks',icon:'\u{1F4AF}',check:ctx=>ctx.tasksDoneCount>=100},
  {id:'streak_3',icon:'\u{1F525}',check:ctx=>ctx.streak>=3},
  {id:'streak_7',icon:'⚡',check:ctx=>ctx.streak>=7},
  {id:'streak_14',icon:'\u{1F3C6}',check:ctx=>ctx.bestStreakEver>=14},
  {id:'goal_getter',icon:'\u{1F3AF}',check:ctx=>ctx.goalCompleted},
  {id:'habit_builder',icon:'\u{1F9E9}',check:ctx=>ctx.bestHabitStreak>=7},
  {id:'challenger',icon:'\u{1F3C5}',check:ctx=>ctx.challengesWon>=1},
  {id:'balanced_life',icon:'⚖️',check:ctx=>ctx.lbBestScore>=85}
];
function computeBadgeContext(){
  const tasks=loadTasks(), archive=loadArchive(), habits=loadHabits(), goals=loadGoals(), challenges=loadChallenges(), today=todayStr();
  const tasksDoneCount=tasks.filter(t=>t.status==='done').length+archive.filter(t=>t.status==='done').length;
  const goalCompleted=goals.some(g=>computeGoalProgress(g,tasks,habits).pct>=100);
  const bestHabitStreak=habits.reduce((m,h)=>Math.max(m,calcHabitStreak(h)),0);
  const challengesWon=challenges.filter(c=>c.status==='completed').length;
  let lbBestScore=0;
  for(let i=0;i<30;i++){ const s=lbDailyScore(loadLbLog(addDaysToDateStr(today,-i))); if(s!=null) lbBestScore=Math.max(lbBestScore,s); }
  return {tasksDoneCount, streak:calcStreak(tasks), bestStreakEver:calcBestStreakEver(tasks), goalCompleted, bestHabitStreak, challengesWon, lbBestScore};
}
function getSeenBadgeIds(){ try{ return new Set(JSON.parse(localStorage.getItem(userKey('taskflow_badges_seen')))||[]); }catch{ return new Set(); } }
function renderAchievements(){
  const el=document.getElementById('achievementsGrid'); if(!el) return;
  const ctx=computeBadgeContext();
  const earnedIds=BADGE_DEFS.filter(b=>b.check(ctx)).map(b=>b.id);
  const seen=getSeenBadgeIds();
  const newlyEarned=earnedIds.filter(id=>!seen.has(id));
  if(newlyEarned.length){
    launchConfetti();
    newlyEarned.forEach(id=>toast(tr('new_badge_toast').replace('{name}',tr('badge_'+id)),'success'));
    const updated=new Set([...seen,...earnedIds]);
    localStorage.setItem(userKey('taskflow_badges_seen'),JSON.stringify([...updated]));
    syncKey(userKey('taskflow_badges_seen'));
  }
  const earnedSet=new Set(earnedIds);
  el.innerHTML=BADGE_DEFS.map(b=>{
    const earned=earnedSet.has(b.id);
    return '<div class="badge-tile'+(earned?' earned':'')+'"><div class="badge-icon">'+b.icon+'</div><div class="badge-name">'+tr('badge_'+b.id)+'</div><div class="badge-hint">'+tr('badge_'+b.id+'_hint')+'</div></div>';
  }).join('');
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
  syncKey(userKey('pomoWork')); syncKey(userKey('pomoBreak')); syncKey(userKey('pomoSessions'));
}
function openPomodoro(){
  document.getElementById('focusOverlay').classList.add('active');
  const tasks=loadTasks().filter(t=>t.status!=='done');
  const sel=document.getElementById('focusTaskSelect');
  if(sel){sel.innerHTML=("<option value=\"\">"+tr("-- Select Task --")+"</option>")+tasks.map(t=>'<option value="'+t.id+'"'+(t.id===focusTaskId?' selected':'')+'>'+escHtml(t.title)+'</option>').join('');}
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
  document.getElementById('pomoModeLabel').textContent=pomoMode==='work'?tr("Work Session"):tr("Break Time");
  document.getElementById('pomoModeLabel').style.background=pomoMode==='work'?'var(--primary)':'var(--success)';
  const dots=document.getElementById('pomoSessions');
  dots.innerHTML='';
  for(let i=0;i<4;i++){const dot=document.createElement('div');dot.className='pomo-dot'+(i<(pomoSessionCount%4)?' filled':'');dots.appendChild(dot);}
}
function togglePomoTimer(){
  if(focusInterval){clearInterval(focusInterval);focusInterval=null;return;}
  if(focusSeconds<=0) focusSeconds=pomoMode==='work'?pomoWorkSec:pomoBreakSec;
  focusInterval=setInterval(()=>{
    if(pomoMode==='work')focusElapsedSeconds++;
    focusSeconds--;
    if(focusSeconds<=0){
      clearInterval(focusInterval);focusInterval=null;
      pomoBeep();
      if(pomoMode==='work'){pomoSessionCount++;savePomodoroSettings();toast(tr("Work session complete! Take a break."));pomoMode='break';}
      else{toast(tr("Break over! Start working."));pomoMode='work';}
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
  focusElapsedSeconds=0;focusLoggedSeconds=0;
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
  if(!focusTaskId){toast(tr("No task selected"));return;}
  const tasks=loadTasks(),t=tasks.find(x=>x.id===focusTaskId);
  const unsaved=focusElapsedSeconds-focusLoggedSeconds;
  if(t&&unsaved>0){t.logged_hours=(t.logged_hours||0)+unsaved/3600;focusLoggedSeconds=focusElapsedSeconds;saveTasks(tasks);toast(tr("Time logged to ")+escHtml(t.title));}
}
function selectFocusTask(){
  const sel=document.getElementById('focusTaskSelect');
  if(!sel?.value){return;}
  if(focusTaskId!==sel.value){resetPomoTimer();}
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
  if(!currentUser) return;
  const tasks=loadTasks(), now=new Date();
  let changed=false;
  tasks.forEach(t=>{
    if(t.status!=='done'&&t.reminder&&!t.reminderDismissed){
      const rTime=new Date(t.reminder);
      if(rTime<=now&&(now-rTime)<300000){
        const title=tr("Reminder: ")+t.title, body=tr("Task \"")+t.title+tr("\" is due!");
        if(t.important) triggerAlarm(title,body); else showNotification(title,body);
        t.reminderDismissed=true;changed=true;
      }
    }
  });
  if(changed) saveTasks(tasks);
  checkTimetableBlockReminders(now);
  checkEventReminders(now);
  maybeSendDailyDigest();
}
function checkTimetableBlockReminders(now){
  const blocks=loadTimetableBlocks();let changed=false;
  blocks.forEach(block=>{
    if(!block.reminder||block.reminderDismissed||block.completedAt)return;
    const reminderTime=new Date(block.reminder);
    if(reminderTime<=now&&(now-reminderTime)<300000){
      const title=tr("Reminder: ")+block.title,body=tr('event_reminder_body_generic');
      if(block.important)triggerAlarm(title,body);else showNotification(title,body);
      block.reminderDismissed=true;changed=true;
    }
  });
  if(changed)saveTimetableBlocks(blocks);
}
function checkEventReminders(now){
  const events=loadEvents();
  let changed=false;
  events.forEach(ev=>{
    if(ev.remindBefore==null||ev.reminderFired||!ev.date) return;
    const eventTime=new Date(ev.date+'T'+(ev.time||'00:00')+':00');
    const triggerTime=new Date(eventTime.getTime()-ev.remindBefore*60000);
    if(triggerTime<=now&&(now-triggerTime)<300000){
      const bodyKeys={meeting:'event_reminder_body_meeting',deadline:'event_reminder_body_deadline'};
      const bodyKey=bodyKeys[ev.type]||'event_reminder_body_generic';
      const title=tr('event_reminder_title').replace('{title}',ev.title), body=tr(bodyKey);
      if(ev.important) triggerAlarm(title,body); else showNotification(title,body);
      ev.reminderFired=true; changed=true;
    }
  });
  if(changed) saveEvents(events);
}
/* ═══════ ALARM (for reminders marked "important") ═══════ */
let alarmAudioCtx=null, alarmIntervalId=null, alarmSnoozeTimeout=null;
function playAlarmSound(){
  stopAlarmSound();
  try{
    const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!Ctx) return;
    alarmAudioCtx=new Ctx();
    const beep=()=>{
      if(!alarmAudioCtx) return;
      const osc=alarmAudioCtx.createOscillator(), gain=alarmAudioCtx.createGain();
      osc.type='square'; osc.frequency.value=880;
      gain.gain.setValueAtTime(0.001,alarmAudioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25,alarmAudioCtx.currentTime+0.02);
      gain.gain.exponentialRampToValueAtTime(0.001,alarmAudioCtx.currentTime+0.35);
      osc.connect(gain).connect(alarmAudioCtx.destination);
      osc.start(); osc.stop(alarmAudioCtx.currentTime+0.4);
    };
    beep();
    alarmIntervalId=setInterval(beep,700);
  }catch{ /* Web Audio unavailable — the OS notification below still fires */ }
}
function stopAlarmSound(){
  if(alarmIntervalId){ clearInterval(alarmIntervalId); alarmIntervalId=null; }
  if(alarmAudioCtx){ alarmAudioCtx.close().catch(()=>{}); alarmAudioCtx=null; }
}
function triggerAlarm(title,body){
  document.getElementById('alarmModalTitle').textContent=title;
  document.getElementById('alarmModalBody').textContent=body;
  document.getElementById('alarmModal').classList.add('active');
  playAlarmSound();
  if('Notification' in globalThis && Notification.permission==='granted'){
    try{ new Notification(title,{body,icon:'icon-192.png',requireInteraction:true,vibrate:[300,150,300,150,300]}); }catch{}
  }
}
function dismissAlarm(){
  stopAlarmSound();
  if(alarmSnoozeTimeout){ clearTimeout(alarmSnoozeTimeout); alarmSnoozeTimeout=null; }
  document.getElementById('alarmModal').classList.remove('active');
}
function snoozeAlarm(){
  const title=document.getElementById('alarmModalTitle').textContent;
  const body=document.getElementById('alarmModalBody').textContent;
  stopAlarmSound();
  document.getElementById('alarmModal').classList.remove('active');
  toast(tr('alarm_snoozed'));
  alarmSnoozeTimeout=setTimeout(()=>triggerAlarm(title,body),300000);
}
function maybeSendDailyDigest(){
  if(!currentUser) return;
  const today=todayStr(), lastKey=userKey('taskflow_last_digest');
  if(localStorage.getItem(lastKey)===today) return;
  const tasks=loadTasks(), habits=loadHabits(), goals=loadGoals();
  const overdueCount=tasks.filter(isOverdue).length;
  const dueTodayCount=tasks.filter(t=>t.status!=='done'&&t.due===today&&!isOverdue(t)).length;
  const behindGoalsCount=goals.filter(g=>{ const p=computeGoalProgress(g,tasks,habits), expected=goalExpectedPct(g); return p.pct<100&&p.pct<expected-15; }).length;
  localStorage.setItem(lastKey,today);
  if(!overdueCount&&!dueTodayCount&&!behindGoalsCount) return;
  const parts=[];
  if(overdueCount) parts.push(tr('notif_digest_overdue').replace('{n}',overdueCount));
  if(dueTodayCount) parts.push(tr('notif_digest_due').replace('{n}',dueTodayCount));
  if(behindGoalsCount) parts.push(tr('notif_digest_goals').replace('{n}',behindGoalsCount));
  showNotification(tr('notif_digest_title'),parts.join(' • '));
}
function showNotification(title,body){
  try{if('Notification' in globalThis&&Notification.permission==='granted'){new Notification(title,{body,icon:'icon-192.png'});return;}}catch{}
  toast(title);
}
function requestNotifPermission(){
  if('Notification' in globalThis&&Notification.permission!=='granted'){
    Notification.requestPermission().then(p=>{
      toast(p==='granted'?tr('notif_enabled'):tr('notif_blocked'));
      if(p==='granted') subscribeToPush();
    });
  } else if('Notification' in globalThis&&Notification.permission==='granted'){
    subscribeToPush();
  }
}
function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replaceAll('-','+').replaceAll('_','/');
  const raw=atob(base64);
  const arr=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) arr[i]=raw.codePointAt(i);
  return arr;
}
async function detachPushSubscription(token){
  const base=API_BASE_URL;
  try{
    const registration=await navigator.serviceWorker?.getRegistration();
    const subscription=await registration?.pushManager.getSubscription();
    if(subscription)await fetch(base+'/api/push/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({endpoint:subscription.endpoint})});
  }catch{} // Offline logout cannot contact the server; a later subscription transfers ownership.
}
async function disableNotifications(){
  try{
    const registration=await navigator.serviceWorker?.getRegistration();
    const subscription=await registration?.pushManager.getSubscription();
    if(subscription){await apiRaw('/api/push/unsubscribe','POST',{endpoint:subscription.endpoint});await subscription.unsubscribe();}
    toast(tr("Push notifications disabled on this browser"));
  }catch(error){toast(tr("Could not disable push: ")+error.message,'error');}
}
async function subscribeToPush(){
  if(!apiConfigured()||!currentUser||!getAuthSession(currentUser)) return;
  if(!('serviceWorker' in navigator)||!('PushManager' in globalThis)) return;
  try{
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      const {publicKey}=await apiRaw('/api/push/vapid-public-key','GET',undefined,false);
      if(!publicKey) return;
      sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});
    }
    const json=sub.toJSON();
    await apiRaw('/api/push/subscribe','POST',{endpoint:json.endpoint,p256dh:json.keys.p256dh,auth:json.keys.auth,tzOffsetMinutes:new Date().getTimezoneOffset()});
  }catch{ /* best-effort: push is a nice-to-have, never block the rest of the app */ }
}

/* ═══════ CATEGORY NAV & PROJECT FILTER ═══════ */
function renderCategoryNav(){
  const tasks=loadTasks(), cats=new Set(tasks.map(t=>t.category).filter(Boolean));
  const select=document.getElementById('filterCategory');
  if(select){const selected=select.value;select.replaceChildren(new Option(tr('filter_all_categories'),'all'),...[...cats].sort().map(category=>new Option(category,category)));select.value=cats.has(selected)?selected:'all';}
  const el=document.getElementById('categoryNav');
  if(!el) return;
  if(cats.size===0){
    el.innerHTML=("<span style=\"font-size:.72rem;color:var(--text3);padding:2px 0\">"+tr("Add categories to tasks to filter here")+"</span>");
    return;
  }
  el.innerHTML=("<button class=\"cat-pill active\" onclick=\"filterByCat('')\">"+tr("All")+"</button>")+
    [...cats].sort((a,b)=>a.localeCompare(b)).map(c=>'<button class="cat-pill" onclick="filterByCat('+inlineArg(c)+')">'+escHtml(c)+'</button>').join('');
}

function filterByCat(cat){
  showPage('tasks');
  document.getElementById('filterCategory').value=cat||'all';
  document.querySelectorAll('.cat-pill').forEach(b=>b.classList.remove('active'));
  const active=[...document.querySelectorAll('.cat-pill')].find(b=>b.textContent===(cat||tr("All")));
  if(active) active.classList.add('active');
  renderTasks();
}

/* ═══════ GLOBAL SEARCH ═══════ */
function handleGlobalSearch(e){
  const input=e?.target || document.getElementById('searchInput');
  const q=input ? input.value.trim().toLowerCase() : '';
  const results=document.getElementById('searchResults');
  if(!q){results.innerHTML='';results.style.display='none';return;}
  const tasks=loadTasks().filter(t=>t.title.toLowerCase().includes(q)||(t.description||'').toLowerCase().includes(q)||(t.tags||[]).some(tg=>tg.toLowerCase().includes(q)));
  results.style.display='block';
  results.innerHTML=tasks.slice(0,8).map(t=>'<div class="search-result-item" onclick="openModal(\''+t.id+'\');closeSearch()"><span class="tag tag-'+t.priority+'" style="font-size:.6rem">'+priorityLabel(t.priority)+'</span> '+escHtml(t.title)+(t.due?' <span style="font-size:.7rem;color:var(--text3)">'+fmtDate(t.due)+'</span>':'')+'</div>').join('')||("<div class=\"search-result-item\" style=\"color:var(--text3)\">"+tr("No results")+"</div>");
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
  addActivity(tr("Created \"")+val+'"','add');
  sheetPost({action:'ADD',...taskToSheetRow(newT)});
  closeQuickAdd();toast(tr("Task created"));refreshAll();
}

/* ═══════ TEMPLATES ═══════ */
function saveAsTemplate(){
  const name=prompt(tr("Template name:"));if(!name) return;
  const templates=loadTemplates();
  const tasks=loadTasks().filter(t=>selectedIds.has(t.id));
  if(!tasks.length){toast(tr("Select tasks first"));return;}
  templates.push({id:'tpl'+Date.now(),name:name,tasks:tasks.map(t=>({title:t.title,description:t.description,priority:t.priority,category:t.category,tags:t.tags||[],subtasks:(t.subtasks||[]).map(s=>({text:s.text,done:false})),estimated_hours:t.estimated_hours||0})),createdAt:Date.now()});
  saveTemplates(templates);clearSelection();toast(tr("Template saved"));
}
function openTemplatesModal(){
  const tpls=loadTemplates();
  document.getElementById('templateList').innerHTML=tpls.length?tpls.map(tp=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)"><div><strong>'+escHtml(tp.name)+'</strong><span style="font-size:.72rem;color:var(--text3);margin-left:8px">'+tp.tasks.length+(""+tr(" tasks")+"</span></div><div style=\"display:flex;gap:6px\"><button class=\"btn btn-sm\" onclick=\"useTemplate('")+tp.id+("')\">"+tr("Use")+"</button><button class=\"btn btn-sm\" style=\"color:var(--danger)\" onclick=\"deleteTemplate('")+tp.id+("')\">"+tr("Delete")+"</button></div></div>")).join(''):("<p style=\"color:var(--text3);text-align:center;padding:16px\">"+tr("No templates")+"</p>");
  document.getElementById('templatesModal').classList.add('active');
}
function closeTemplates(){document.getElementById('templatesModal').classList.remove('active');}
function useTemplate(id){
  const tpl=loadTemplates().find(t=>t.id===id);if(!tpl) return;
  const tasks=loadTasks();
  let nextTemplateNumId=getNextNumId();
  tpl.tasks.forEach(tt=>{
    tasks.push({id:'t'+genId(),numId:nextTemplateNumId++,title:tt.title,description:tt.description||'',status:'todo',priority:tt.priority||'medium',category:tt.category||'',tags:tt.tags||[],due:'',recurring:'',subtasks:(tt.subtasks||[]).map(s=>({text:s.text,done:false})),progress:0,estimated_hours:tt.estimated_hours||0,logged_hours:0,link:'',createdAt:Date.now(),completedAt:null,sortOrder:tasks.length,project:'',dependencies:[],eisenhower:'',milestone:false,reminder:'',comments:[],smartScore:0,myDay:'',myDaySlot:'morning'});
  });
  saveTasks(tasks);closeTemplates();toast(tr("Template applied"));refreshAll();
}
function deleteTemplate(id){saveTemplates(loadTemplates().filter(t=>t.id!==id));openTemplatesModal();toast(tr("Template deleted"));}

/* ═══════ SAVED FILTERS ═══════ */
function openSavedFilters(){
  renderSavedFilters();
  document.getElementById('filtersModal').classList.add('active');
}
function closeFiltersModal(){document.getElementById('filtersModal').classList.remove('active');}
function saveCurrentFilter(){
  const name=prompt(tr("Filter name:"));if(!name) return;
  const filters=loadFilters();
  filters.push({id:'f'+Date.now(),name:name,status:document.getElementById('filterStatus').value,priority:document.getElementById('filterPriority').value,category:document.getElementById('filterCategory').value,project:document.getElementById('filterProject')?document.getElementById('filterProject').value:'all',assignee:document.getElementById('filterAssignee')?document.getElementById('filterAssignee').value:'all',sort:document.getElementById('sortBy').value});
  saveFilters(filters);renderSavedFilters();toast(tr("Filter saved"));
}
function renderSavedFilters(){
  const filters=loadFilters();
  document.getElementById('savedFiltersList').innerHTML=filters.length?filters.map(f=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)"><span>'+escHtml(f.name)+'</span><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="applyFilter(\''+f.id+("')\">"+tr("Apply")+"</button><button class=\"btn btn-sm\" style=\"color:var(--danger)\" onclick=\"deleteFilter('")+f.id+("')\">"+tr("Delete")+"</button></div></div>")).join(''):("<p style=\"color:var(--text3);text-align:center;padding:16px\">"+tr("No saved filters")+"</p>");
}
function applyFilter(id){
  const f=loadFilters().find(x=>x.id===id);if(!f) return;
  document.getElementById('filterStatus').value=f.status||'all';
  document.getElementById('filterPriority').value=f.priority||'all';
  document.getElementById('filterCategory').value=f.category||'all';
  if(document.getElementById('filterProject')) document.getElementById('filterProject').value=f.project||'all';
  if(document.getElementById('filterAssignee')) document.getElementById('filterAssignee').value=f.assignee||'all';
  document.getElementById('sortBy').value=f.sort||'created-desc';
  closeFiltersModal();showPage('tasks');renderTasks();toast(tr("Filter applied"));
}
function deleteFilter(id){saveFilters(loadFilters().filter(f=>f.id!==id));renderSavedFilters();toast(tr("Filter deleted"));}

/* ═══════ RECURRING ═══════ */
function advanceRecurrence(date,mode){
  const next=new Date(date);
  if(mode==='monthly'){
    const day=next.getDate();next.setDate(1);next.setMonth(next.getMonth()+1);
    const last=new Date(next.getFullYear(),next.getMonth()+1,0).getDate();next.setDate(Math.min(day,last));
  }else next.setDate(next.getDate()+(mode==='weekly'?7:1));
  return next;
}
function processRecurring(){
  const tasks=loadTasks();let added=false;let nextRecurNumId=getNextNumId(tasks);
  tasks.forEach(t=>{
    if(t.status==='done'&&t.recurring&&t.completedAt){
      if(['daily','weekly','monthly'].includes(t.recurring)&&Date.now()>=advanceRecurrence(new Date(t.completedAt),t.recurring).getTime()){
        const nd=advanceRecurrence(t.due?new Date(t.due+'T12:00:00'):new Date(t.completedAt),t.recurring);
        tasks.push({id:'t'+genId(),numId:nextRecurNumId++,title:t.title,description:t.description,status:'todo',priority:t.priority,category:t.category,tags:[...(t.tags||[])],due:localDateStr(nd),recurring:t.recurring,subtasks:(t.subtasks||[]).map(s=>({text:s.text,done:false})),progress:0,estimated_hours:t.estimated_hours||0,logged_hours:0,link:t.link||'',createdAt:Date.now(),updatedAt:Date.now(),completedAt:null,sortOrder:tasks.length,project:t.project||'',assignee:t.assignee||currentUser||'',dependencies:[],eisenhower:t.eisenhower||'',milestone:t.milestone||false,reminder:'',comments:[],smartScore:0,myDay:'',myDaySlot:'morning'});
        t.recurring='';added=true;
      }
    }
  });
  if(added){saveTasks(tasks);refreshAll();}
}

/* ═══════ EXPORT / IMPORT ═══════ */
function csvCell(value){
  let text=String(value??'');
  if(/^[=+@\-\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function exportCSV(){
  const rows=[['ID','Title','Status','Priority','Category','Due','Tags','Owner','Created','Updated'].map(key=>tr(key))];
  for(const t of loadTasks()) rows.push([t.numId||'',t.title,statusLabel(t.status),priorityLabel(t.priority),t.category,t.due,(t.tags||[]).join(';'),t.assignee,t.createdAt?new Date(t.createdAt).toISOString():'',t.updatedAt?new Date(t.updatedAt).toISOString():'']);
  downloadFile('tasks.csv',rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv');
}
function exportJSON(){downloadFile('tasks.json',JSON.stringify({tasks:loadTasks(),projects:loadProjects(),goals:loadGoals(),habits:loadHabits(),notes:loadNotes()},null,2),'application/json');}
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('Excel library not loaded','error');return;}
  const users=loadUsers();
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
      'ID':t.numId||'','Title':t.title||'','Status':statusLabel(t.status||'todo'),'Priority':priorityLabel(t.priority||'medium'),
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
    const localizedRows=(sheetData.length?sheetData:[{'Info':tr('No tasks for this user')}]).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[tr(key),value])));
    const ws=XLSX.utils.json_to_sheet(localizedRows);
    XLSX.utils.book_append_sheet(wb,ws,sheetName);
  });
  XLSX.writeFile(wb,'TaskFlow_Export.xlsx');
  toast(tr('Excel exported with ')+users.length+tr(' user sheet(s)'));
}
function downloadFile(name,content,type){
  const blob=new Blob([content],{type:type});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href);
}
function importJSON(event){
  const file=event?.target?.files?.[0];
  if(!file){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=e=>{importJSON(e);};input.click();return;}
  file.text().then(text=>{
    try{
      const data=JSON.parse(text);
      const clean=validateBackup(data);
      pendingImport=clean;
      const summary=[
        [tr("Tasks"),clean.tasks],
        [tr("Projects"),clean.projects],
        [tr("Goals"),clean.goals],
        [tr("Habits"),clean.habits],
        [tr("Notes"),clean.notes]
      ].map(([label,list])=>'<div class="sync-row"><span>'+label+'</span><strong>'+(list?list.length:tr('unchanged'))+'</strong></div>').join('');
      document.getElementById('importPreviewSummary').innerHTML=summary;
      document.getElementById('importPreviewModal').classList.add('active');
    }catch(err){toast(err instanceof SyntaxError?tr('backup_invalid_json'):err.message,'error');}
  }).catch(()=>toast(tr('backup_read_failed'),'error'));
  const inputElement=event?.target;
  if(inputElement) inputElement.value='';
}
function closeImportPreview(){
  pendingImport=null;
  const modal=document.getElementById('importPreviewModal');
  if(modal) modal.classList.remove('active');
}
function confirmImportPreview(){
  if(!pendingImport) return;
  const sections=[['tasks',saveTasks],['projects',saveProjects],['goals',saveGoals],['habits',saveHabits],['notes',saveNotes]];
  const snapshot=new Map(sections.map(([name])=>[userKey('taskflow_'+name),localStorage.getItem(userKey('taskflow_'+name))]));
  snapshot.set(pendingSyncKey(),localStorage.getItem(pendingSyncKey()));
  const wasHydrating=hydrationInFlight;hydrationInFlight=true;
  try{
    for(const [name,save] of sections)if(pendingImport[name])save(pendingImport[name]);
    ensureNumIds();closeImportPreview();refreshAll();toast(tr("Backup imported"));
  }catch(error){
    for(const [key,value] of snapshot){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}
    toast(tr("Import was not saved. Free browser storage and try again."),'error');
  }finally{hydrationInFlight=wasHydrating;}
  flushSyncQueue();
}

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
  const url=prompt(tr("Google Apps Script URL:"),APPS_SCRIPT_URL);
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
  if(!APPS_SCRIPT_URL){toast(tr("Set Apps Script URL first"),'error');return null;}
  const token=getSyncToken();
  if(!token){toast(tr("Set Sync Token first"),'error');return null;}
  return token;
}
function editSyncToken(){
  const token=prompt(tr("Sync token from Apps Script Properties:"), getSyncToken());
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
  const apiEl=document.getElementById('apiUrlStatus');
  if(urlEl) urlEl.textContent=APPS_SCRIPT_URL ? tr("Configured") : tr("Not configured");
  if(tokenEl) tokenEl.textContent=getSyncToken() ? tr("Configured for this account") : tr("Required for Google Sheets sync");
  if(syncEl) syncEl.textContent=getSyncStatusText();
  let apiStatus=tr("Not configured");
  if(apiConfigured()){
    apiStatus=tr("Configured — not signed in");
    if(getAuthSession(currentUser)) apiStatus=tr("Configured — signed in");
  }
  if(apiEl) apiEl.textContent=apiStatus;
}
function getLastSyncAt(){return Number(localStorage.getItem(userKey('taskflow_last_sync_at')))||0;}
function setLastSyncAt(ts=Date.now()){localStorage.setItem(userKey('taskflow_last_sync_at'),String(ts));refreshSettingsStatus();}
function getSyncStatusText(){
  const ts=getLastSyncAt();
  if(!APPS_SCRIPT_URL||!getSyncToken()) return tr("Not configured");
  return ts ? tr("Last synced ")+fmtRelative(ts) : tr("Ready, not synced yet");
}
async function clearAllData(){
  if(!currentUser||!confirm(tr("Delete ALL synced data for this account? This cannot be undone!")))return;
  const user=currentUser;
  try{
    const server=await apiRaw('/api/data','GET');
    if(currentUser!==user)return;
    const keys=new Set([...Object.keys(localStorage),...server.map(item=>item.key)].filter(key=>ownsDataKey(key,user)));
    const pending=getPendingSync(user);
    for(const key of keys)pending[key]=null;
    // Persist all tombstones first so a failed request/reload cannot resurrect deleted data.
    setPendingSync(pending,user);
    for(const key of keys)localStorage.removeItem(key);
    refreshAll();await flushSyncQueue();
    toast(Object.keys(getPendingSync(user)).length?tr("Deletion queued; waiting for synchronization"):tr("Account data cleared"));
  }catch(error){toast(tr("Could not clear account data: ")+error.message,'error');}
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
  document.getElementById('onboardTitle').textContent=tr(s.title);
  document.getElementById('onboardDesc').textContent=tr(s.desc);
  document.getElementById('onboardProgress').textContent=tr("Step ")+(i+1)+tr(" of ")+onboardSteps.length;
}
function nextOnboardStep(){showOnboardStep(onboardIdx+1);}
function skipOnboarding(){document.getElementById('onboardOverlay').classList.remove('active');const k=userKey('onboarded');persistData(k,'1');}
let onboardIdx=0;

/* ═══════ KEYBOARD SHORTCUTS ═══════ */
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape'&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')) return;
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
    if(!btn.getAttribute('aria-label') || btn.dataset.autoAria){
      btn.dataset.autoAria='1';
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
  const map={dashboard:renderDashboard,tasks:renderTasks,kanban:renderKanban,calendar:renderCalendar,timetable:renderTimetable,analytics:renderAnalytics,myday:renderMyDay,projects:renderProjects,eisenhower:renderEisenhower,goals:renderGoals,habits:renderHabits,notes:renderNotes,reports:renderReports,archive:renderArchive,lifebalance:renderLifeBalance,progress:renderProgress,review:renderReview};
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
    .then(r=>r.json()).then(res=>{if(res.status&&res.status!=='ok') toast(tr("Sync failed: ")+(res.message||res.status),'error'); else setLastSyncAt();})
    .catch(()=>{toast(tr("Sync failed"),'error');});
}
function testSyncConnection(){
  const token=requireSyncConfig();
  if(!token) return;
  const label=document.getElementById('syncStateLabel');
  if(label) label.textContent=tr("Testing connection...");
  fetch(APPS_SCRIPT_URL+'?action=PING&user='+encodeURIComponent(currentUser)+'&authToken='+encodeURIComponent(token))
    .then(r=>r.json()).then(data=>{
      if(data.status==='ok'){toast(tr("Sync connection ready"));setLastSyncAt(Date.now());}
      else{toast(tr("Sync test failed: ")+(data.message||'error'),'error');refreshSettingsStatus();}
    }).catch(()=>{toast(tr("Sync test failed"),'error');refreshSettingsStatus();});
}
function syncPushAll(){
  if(!requireSyncConfig()) return;
  const tasks=loadTasks();
  tasks.sort((a,b)=>(a.numId||0)-(b.numId||0));
  const rows=[SHEET_HEADERS,...tasks.map(taskToSheetArray)];
  sheetPost({action:'SYNC_PUSH',sheetName:currentUser.split('@')[0],rows:rows,tasks:tasks.map(taskToSheetRow)});
  toast(tr("Syncing to Google Sheets..."));
}
function syncAllUsersToSheet(){
  const token=requireSyncConfig();
  if(!token) return;
  const users=loadUsers();
  if(!users.length){toast(tr("No users found"),'error');return;}
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
    .then(r=>r.json()).then(res=>{if(res.status&&res.status!=='ok') toast(tr("Sync failed: ")+(res.message||res.status),'error'); else setLastSyncAt();})
    .catch(()=>{toast(tr("Sync failed"),'error');});
  toast(tr("Syncing all users to Google Sheets..."));
}
function syncPullAll(){
  const token=requireSyncConfig();
  if(!token) return;
  const last=getLastSyncAt();
  if(last && loadTasks().some(t=>(t.updatedAt||t.createdAt||0)>last) && !confirm(tr("Local tasks changed since last sync. Pulling will replace them. Continue?"))) return;
  fetch(APPS_SCRIPT_URL+'?action=SYNC_PULL&user='+encodeURIComponent(currentUser)+'&authToken='+encodeURIComponent(token))
    .then(r=>r.json()).then(data=>{
      if(data.status==='error'){toast(tr("Sync failed: ")+(data.message||'error'),'error');return;}
      if(data.tasks&&Array.isArray(data.tasks)){
        const pulled=data.tasks.map(sheetRowToTask).map(normalizeTask);
        saveTasks(pulled);setLastSyncAt();refreshAll();toast(tr("Pulled ")+pulled.length+tr(" tasks"));
      }
    }).catch(()=>{toast(tr("Sync failed"));});
}

/* ═══════ OVERDUE NOTIFICATION ═══════ */
function showOverdueTasks(){
  const overdue=loadTasks().filter(isOverdue);
  if(overdue.length) toast(tr('overdue_count', {n:overdue.length}));
}

/* ═══════ INIT ═══════ */
initAccessibility();
applyLang();
checkAutoLogin();

/* ═══════ SERVICE WORKER & PWA ═══════ */
function updateWorkerLanguage(){
  if('serviceWorker' in navigator && ['http:','https:'].includes(location.protocol)){
    navigator.serviceWorker.ready.then(registration=>registration.active?.postMessage({type:'TASKFLOW_LANGUAGE',language:lang})).catch(()=>{});
  }
}
if ('serviceWorker' in navigator && ['http:','https:'].includes(location.protocol)) {
  navigator.serviceWorker.register('./sw.js').then(updateWorkerLanguage).catch(()=>{});
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
  toast(tr("App installed successfully!"));
});
function installApp() {
  if (!deferredInstallPrompt) { toast(tr("Open in browser to install")); return; }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') toast(tr("Installing..."));
    deferredInstallPrompt = null;
  });
}
