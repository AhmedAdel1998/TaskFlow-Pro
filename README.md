# TaskFlow Pro Documentation

TaskFlow Pro is a task, habit, and time-management PWA with a real .NET backend. Unlike the "two disconnected halves" state described in older versions of this document, the client app and backend are now fully wired together and deployed live:

- **Frontend (PWA)**: `ahmedadel1998.github.io/TaskFlow-Pro/` — static site on GitHub Pages, auto-deployed from `main`.
- **Backend API**: `api-production-1da6.up.railway.app` — ASP.NET Core 9 + SQLite on Railway, auto-deployed from `main`.

Every push to `main` runs the test suite (frontend syntax/smoke tests on Windows, backend integration tests on Linux) via GitHub Actions, then deploys both the static site and the API automatically — see "Deployment & CI/CD" below.

`docs/phase-1-audit.md` and `docs/feature-parity-matrix.md` are historical planning documents from before this integration; they describe a since-superseded architecture (PostgreSQL, no wired-up auth, no deployment) and are kept only for background on why the backend was originally structured as a "strangler" migration. They no longer reflect the current state — this README does.

## Contents

- Application overview
- Live environment
- Repository structure
- Running the client app
- User guide (client app)
- Reminders, alarms, and push notifications
- Internationalization (English/Arabic)
- Authentication
- Sync and offline behavior
- Backend API
- Deployment & CI/CD
- Security model
- Backup, restore, import, and export
- Testing
- Developer notes
- Known limitations
- Troubleshooting

## Application Overview

TaskFlow Pro is a task manager for personal and lightweight team use: tasks, Kanban, calendar, Eisenhower matrix, projects, goals, habits, notes, a timetable auto-scheduler, life-balance tracking, progress/achievements, and a weekly review — all synced to a real per-account database, usable offline, and installable as a PWA.

- **Client app** (`index.html`, `styles.css`, `app.js`, `sw.js`) — the PWA. Local-first: every read/write goes through `localStorage` first for instant UI, then syncs to the backend in the background.
- **Backend** (`src/TaskFlow.*`) — ASP.NET Core 9 Web API with SQLite, JWT auth (access + refresh tokens), organization-scoped data, a generic per-user key/value sync store, and a background service that sends real push notifications.

## Live Environment

| Component | URL |
| --- | --- |
| App (PWA) | `https://ahmedadel1998.github.io/TaskFlow-Pro/` |
| API | `https://api-production-1da6.up.railway.app` |
| API health | `https://api-production-1da6.up.railway.app/health/ready` |

The app ships already pointed at the live API (`DEFAULT_API_URL` in `app.js`). To point a local build at a different API instance, use Settings → Account Database (API) URL, or set `localStorage.taskflow_api_url` before loading the page.

## Repository Structure

```text
E:\Task Pro
  index.html                        Client app: HTML shell, all page/modal markup
  styles.css                        Client app: styling, themes, responsive layout
  app.js                            Client app: data layer, rendering, sync, auth, reminders/alarms
  sw.js                             Client app: service worker — offline caching + Web Push handling
  manifest.json                     Client app: PWA manifest
  AppsScript.gs                     Optional legacy Google Sheets export/sync script
  icon-192.png, icon-512.png        PWA icons
  package.json, package-lock.json   Test scripts and dev dependency metadata

  tests/
    syntax-check.js                 Static syntax + DOM-reference validation for app.js/index.html
    smoke.js                        End-to-end Playwright smoke test (spins up a real local API instance)
    TaskFlow.IntegrationTests/      xUnit integration tests: auth, tenancy, concurrency, rate limiting

  TaskFlow.sln                      .NET solution file
  src/
    TaskFlow.Domain/                Entities: User, Organization, TaskItem, UserDataEntry,
                                     PushSubscription, SentReminder, ...
    TaskFlow.Application/           DTOs, commands, and service interfaces
    TaskFlow.Infrastructure/        EF Core DbContext + SQLite migrations, auth/task/data/push
                                     services, ReminderPushBackgroundService
    TaskFlow.Api/                   Program.cs — endpoint mapping, JWT config, rate limiting,
                                     health checks, Dockerfile

  .github/workflows/deploy.yml      CI/CD: test (frontend + backend) -> deploy (GitHub Pages)
  railway.json                      Railway build config (Dockerfile-based deploy for the API)

  docs/
    phase-1-audit.md                Historical: pre-integration architecture/security audit
    feature-parity-matrix.md        Historical: local-only vs. API feature tracking from that phase
```

## Running The Client App

### Simple local use

Open `index.html` directly in a browser. Most features work this way, but service workers (offline caching, push notifications) only run over `http://`, `https://`, or `localhost` — never `file://`.

### Local HTTP server

```powershell
cd "E:\Task Pro"
python -m http.server 8000
```

Then open `http://127.0.0.1:8000/index.html`. By default this still talks to the **live** production API — see "Backend API > Running it locally" if you want a fully local stack.

## User Guide

### Account

Registration and login require a **username** (3–32 characters: letters, numbers, underscores) and a **password** (6+ characters). This is real server-side authentication — the backend hashes passwords and issues short-lived JWT access tokens plus long-lived rotating refresh tokens. There is no anonymous/local-only mode; an account is required to use the app.

### Dashboard

- Total / completed / in-progress / overdue task counts
- Weekly completion chart, priority distribution, productivity heatmap
- Upcoming deadlines, goal progress, habit streaks, recent activity
- **Today's Focus** widget: a short, prioritized list of what most needs attention right now (overdue items, due-today items, goals falling behind pace)
- Filters: date range, project, owner

### Tasks

Fields: title, description, priority, category, project, owner, Eisenhower quadrant, due date/time, status, progress, estimated/logged hours, link, notes, tags, recurrence, **reminder** (date + time), **Important (alarm)** flag, milestone flag, dependencies, subtasks, comments.

Shortcuts: `Q` quick add, `/` focus search, `Alt+N` new task modal, `Escape` close overlays.

Quick add syntax: `Prepare report !high @Work #finance ~ProjectName` — supports `!priority`, `@category`, `#tag`, `~project`.

### Kanban, Eisenhower Matrix, Projects, Goals, Habits, Notes, Reports, Archive

Unchanged in spirit from earlier versions, with one addition: **Goals** can now be linked to a project, category, or habit (`linkType`/`linkId`) so their progress is auto-tracked from real activity instead of manual entry — see "Weekly Review" below.

### Calendar

Events support title, date/time/end time, type (meeting/event/reminder/deadline), color, description, a **"Remind me"** interval (none / at the time / 10 / 30 / 60 minutes / 1 day before), and an **Important (alarm)** flag.

### Timetable

Auto-assigns tasks across the day's available hours based on estimated duration, priority, and due date — a lightweight daily schedule generated from your task list rather than something you build by hand.

### Life Balance

Tracks time allocation across life areas and reports back against general well-established time-use guidance, so you can see where your logged hours are actually going versus where you intend them to go.

### Progress

- Auto-calculated activity/progress charts from real task completion and habit data
- Self-competition "Beat Your Record" challenges
- **Achievements**: badges computed live from your existing data (no separate tracking to maintain), shown once per unlock via a toast and permanently in a badge grid

### Review (Weekly Review)

A dedicated weekly page: goal progress vs. expected pace, habit consistency (30-day window), task-completion velocity, a life-balance summary, and a suggested focus area for the week ahead.

### Pomodoro Timer

Work/break duration, session count, optional task linking, and saving focus time back to a task. Configured in Settings.

## Reminders, Alarms, And Push Notifications

TaskFlow Pro has three escalating layers of "don't let me forget this":

1. **In-app reminder** (tab open): a toast/browser notification at the reminder time for tasks, and per the "Remind me" interval for calendar events.
2. **Push notification** (app fully closed): a background service on the server checks every user's synced task/event data once a minute and sends a real Web Push notification via the browser's push service (e.g. Chrome's FCM) — this works even with no tab open anywhere, because it's server-initiated, not driven by a page timer.
3. **Alarm** (important items, tab open): check **"Important (alarm)"** on a task or event, and when its reminder fires while the app is open, a full-screen alarm modal appears with a looping Web Audio beep, staying up until you hit **Dismiss** or **Snooze (5 min)**. The corresponding push notification is also marked `requireInteraction` + vibration, so even when the tab is closed it won't silently auto-dismiss the way a normal notification does — but a genuinely looping alarm *sound* from a fully closed app isn't achievable with web push; that's a browser/OS platform limit, not a client-code gap.

To receive push notifications at all, click **Enable Notifications** in Settings once per device/browser — this requests OS notification permission and registers a push subscription with the backend (VAPID). A daily digest notification also summarizes overdue tasks, tasks due today, and goals falling behind pace, once per day.

Editing a task's reminder to a new time always re-arms it (this used to silently fail to re-arm after a reminder had already fired once — fixed 2026-09-23).

## Internationalization (English/Arabic)

Full English and Arabic translations (360 matched keys as of this writing) covering every page, modal, button, placeholder, and notification string — not just top-level labels. Arabic mode also switches the layout to RTL. Toggle language in Settings.

## Authentication

- Registration: `POST /api/auth/register` with `{username, password, organizationName}`.
- Login: `POST /api/auth/login` with `{username, password}`.
- Access tokens are JWTs with a 15-minute lifetime; refresh tokens are long random values, stored server-side only as a SHA-256 hash, and rotate on every use (the old one is revoked the moment a new one is issued).
- The client (`app.js`) transparently refreshes the access token in the background via `ensureFreshToken()`/`apiRaw()` and retries once on a 401.

## Sync And Offline Behavior

Every piece of app data — tasks, events, goals, habits, notes, everything — is stored in `localStorage` first (instant, works offline) and mirrored to the backend through a generic key/value store:

- `GET /api/data` — fetch every synced key for the signed-in user
- `PUT /api/data/{key}` — upsert one key's JSON value
- `DELETE /api/data/{key}`

On login, the client hydrates from the server, replays anything still queued locally (`taskflow_pending_sync`), then keeps flushing that queue every 30 seconds and on `online`/visibility-change events. If the network is unreachable, changes queue locally and sync automatically once connectivity returns — this is what makes the app usable offline on mobile with no data loss.

`AppsScript.gs` (Google Sheets export/sync) still exists as an optional, separate mirror for anyone who wants a spreadsheet copy of their tasks — it is independent of the real backend sync above and not required for normal use.

## Backend API

### Architecture

```text
src/TaskFlow.Api            Program.cs: endpoint mapping, JWT bearer auth, rate limiting,
                             security headers, exception-to-HTTP-status middleware, health checks,
                             hosts ReminderPushBackgroundService
src/TaskFlow.Application     Commands/DTOs and service interfaces
src/TaskFlow.Infrastructure  EF Core DbContext + SQLite migrations; auth/task/project/subtask/
                             comment/tag/user-data/push-subscription service implementations;
                             ReminderPushBackgroundService (server-side reminder scanning + Web Push)
src/TaskFlow.Domain          Entities: User, Organization, OrganizationMember, Project, TaskItem,
                             Subtask, TaskComment, Tag, TaskTag, RefreshSession, UserDataEntry,
                             PushSubscription, SentReminder
```

Every organization-scoped entity carries an `OrganizationId`, and every service method re-verifies the caller's membership (from the signed JWT claim, never a client-supplied value) before touching a row.

Database is **SQLite** (not PostgreSQL — deliberately, to avoid running/paying for a separate database service). `DateTimeOffset` columns use a custom value converter (stored as Unix milliseconds) since SQLite has no native `DateTimeOffset` support; WAL mode is enabled at startup for safe concurrent writes.

### Endpoints

```text
POST /api/auth/register             Create user + organization + Owner membership
POST /api/auth/login                Returns access + refresh token, or 401
POST /api/auth/refresh              Rotates a refresh token, or 401 if invalid/expired/revoked

GET  /api/tasks | POST /api/tasks | PUT /api/tasks/{id}
GET  /api/projects | POST /api/projects
GET  /api/tasks/{taskId}/subtasks | POST .../subtasks | PUT .../subtasks/{id}
GET  /api/tasks/{taskId}/comments | POST .../comments
GET  /api/tags | POST /api/tags

GET  /api/data                      All synced key/value entries for the caller
PUT  /api/data/{key}                Upsert one key
DELETE /api/data/{key}

GET  /api/push/vapid-public-key     Public VAPID key for the client to subscribe with
POST /api/push/subscribe            Register a browser push subscription
POST /api/push/unsubscribe          Remove a push subscription

GET  /health/live                   Liveness probe
GET  /health/ready                  Readiness probe (checks DB connectivity)
```

All `/api/*` routes except `/api/auth/*` and the VAPID public-key lookup require `Authorization: Bearer <token>`.

### ReminderPushBackgroundService

A `BackgroundService` that ticks every 60 seconds: for every user with at least one push subscription, it reads their synced task/event JSON from `/api/data`'s underlying table, finds reminders due in the last 5 minutes (correcting for the browser's timezone offset, captured at subscribe time), sends a real Web Push notification via VAPID, and records what it sent in `SentReminders` so the same reminder is never pushed twice. This is what makes reminders fire even when no browser tab is open anywhere.

### Running it locally

Requires the .NET 9 SDK. No external database service is needed — SQLite is a local file.

```powershell
cd "E:\Task Pro"
dotnet ef database update --project src\TaskFlow.Infrastructure --startup-project src\TaskFlow.Api
dotnet run --project src\TaskFlow.Api
```

Try it:

```powershell
curl -X POST http://localhost:5299/api/auth/register -H "Content-Type: application/json" -d "{\"username\":\"you\",\"password\":\"a-long-enough-password\",\"organizationName\":\"My Org\"}"
```

### Configuration

`src/TaskFlow.Api/appsettings.json` reads:

```text
ConnectionStrings:TaskFlow   SQLite connection string (required), e.g. Data Source=taskflow.db
Jwt:Key                      HMAC-SHA256 signing key for access tokens (required)
RateLimits:Auth              Requests/minute on /api/auth/* (default 10)
Vapid:PublicKey / PrivateKey / Subject   VAPID key pair + contact for Web Push
```

The checked-in values are **development-only placeholders**. Production (Railway) uses its own distinct values set as environment variables (`Jwt__Key`, `Vapid__PublicKey`, `Vapid__PrivateKey`, `ConnectionStrings__TaskFlow` pointing at the persistent volume) — never the values committed to source.

### Testing

```powershell
cd "E:\Task Pro"
dotnet build TaskFlow.sln
dotnet test TaskFlow.sln
```

`tests/TaskFlow.IntegrationTests` spins up a real, ephemeral SQLite database per test class and exercises the running API through `WebApplicationFactory`. It proves: registration/login/task-creation end-to-end; wrong-password and duplicate-username rejection; cross-tenant isolation (404, not an empty list); anonymous access rejection (401); stale optimistic-concurrency rejection (409); server-side input validation (400); and the auth rate limiter actually returning 429.

## Deployment & CI/CD

`.github/workflows/deploy.yml` runs on every push to `main`:

1. **`frontend-test`** (windows-latest): builds a throwaway local API instance, runs `tests/syntax-check.js` and `tests/smoke.js` against it with a real Chrome/Edge browser.
2. **`backend-test`** (ubuntu-latest): `dotnet test` against the integration test suite.
3. **`deploy-pages`** (needs both to pass): deploys the static site to GitHub Pages.

Railway watches the same GitHub repo directly and rebuilds/redeploys the API container from `src/TaskFlow.Api/Dockerfile` on every push to `main`, independent of the GitHub Actions run. Both deploys are triggered by the same push, so "push to `main`" is the single action that ships both halves of the product.

If a CI job fails intermittently with a loopback CORS-looking error on `frontend-test`, that is a known, environment-level Chrome Private Network Access quirk unrelated to the app — re-running the job resolves it.

## Security Model

### What is protected

- Passwords are hashed (`Microsoft.AspNetCore.Identity.PasswordHasher`), never stored or logged in plain text.
- Access tokens are short-lived (15 min) signed JWTs; refresh tokens are long random values, stored server-side only as a SHA-256 hash, and rotate on every use.
- Every data-access path derives the organization ID from the signed JWT, then re-verifies membership before any read or write.
- Row-version optimistic concurrency prevents silent overwrite on concurrent task edits.
- `/api/auth/*` is rate-limited; unhandled exceptions map to generic HTTP status codes instead of leaking stack traces.
- Security response headers (`X-Content-Type-Options`, `Referrer-Policy`) are set on every response.
- VAPID private key and JWT signing key are environment-variable secrets in production, distinct from the dev placeholders committed to source.

### What is not (yet) protected

- No email verification, password reset flow, account lockout, or MFA.
- Only the `Owner` role is enforced in practice — the `OrganizationRole` enum has Admin/Manager/Member/Viewer values, but no endpoint currently checks role beyond "is a member of this organization."
- No audit log, no invitations.
- Single-tenant-per-user in practice: registration always creates a new personal organization; there's no UI for inviting others into an existing one yet.

## Backup, Restore, Import, And Export

- **Export JSON**: tasks, projects, goals, habits, notes.
- **Export CSV**: tasks with id, title, status, priority, category, due date, tags, owner, created/updated.
- **Export Excel**: one sheet per known local user.
- **Import JSON**: validated and normalized before saving, with a preview showing record counts; replaces matching local data sections for the current account.

Because everything also syncs to the server automatically, a JSON export is a manual point-in-time backup, not the only copy of your data.

## Testing

Client app test suite (Node/Playwright):

```powershell
cd "E:\Task Pro"
npm install
npm test               # syntax + smoke
npm run test:syntax
npm run test:smoke
```

The smoke test covers: app load, register+login, navigation across every page (including Timetable, Life Balance, Progress, Review), task creation, global search, planning-record creation, note + calendar event creation, dashboard filters, settings/sync status, import preview, accessibility attributes, and local data persistence.

Backend test suite: see "Backend API > Testing" above.

## Developer Notes

### Backend conventions

- Every new `Infrastructure` service method takes the caller's `Guid organizationId` (or `userId` for account-scoped data) from the JWT claim and verifies access before touching any row.
- New entities go in `src/TaskFlow.Domain/Entities.cs`, get configured in `TaskFlowDbContext.OnModelCreating`, then need a migration:
  ```powershell
  dotnet ef migrations add <Name> --project src\TaskFlow.Infrastructure --startup-project src\TaskFlow.Api --output-dir Migrations
  ```
- Be careful with LINQ comparisons against columns that use a custom `ValueConverter` (e.g. the `DateTimeOffset` -> Unix-ms converter): comparing directly against `DateTimeOffset.UtcNow` in a `Where()` clause can fail to translate to SQL under SQLite. Filter by the indexed/simple columns in SQL, then compare the converted value in memory after materializing the row (see `AuthService.RefreshAsync` for the fixed pattern).
- New endpoints go in `src/TaskFlow.Api/Program.cs`; throw `UnauthorizedAccessException` (403), `KeyNotFoundException` (404), `ArgumentException`/`InvalidOperationException` (400), or let EF Core throw `DbUpdateConcurrencyException` (409) — shared middleware maps these consistently.
- Add integration test coverage in `tests/TaskFlow.IntegrationTests`, favoring negative/security cases over happy-path-only.

### Main client files

- `index.html`: markup, modals, page containers.
- `styles.css`: theme variables, layout, component styles.
- `app.js`: data layer, rendering, sync engine, auth, reminders/alarms, push subscription, i18n.
- `sw.js`: offline cache + Web Push (`push`/`notificationclick`) handling.

### Data storage

Data lives in `localStorage`, namespaced per account:

```text
<base_key>_<currentUsername>
```

e.g. `taskflow_tasks_ahmedadel`, `taskflow_events_ahmedadel`, `taskflow_goals_ahmedadel`. These same keys are what gets mirrored to the backend's generic `/api/data` store.

### When saving a task/event, always re-set dismissal flags

If you add a new escalation flag similar to `reminderDismissed` (tasks) or `reminderFired` (events), make sure the save path resets it whenever the underlying trigger condition (the reminder time itself) changes — otherwise editing a fired reminder to a new time silently never re-arms it. This was a real bug (fixed 2026-09-23); the pattern to follow is calendar events' `saveEvent()`, which already always includes `reminderFired:false` in its update payload.

### Adding Tests

- `tests/syntax-check.js` for static/syntax validation.
- `tests/smoke.js` for browser-level behavior.

Run `npm test` before pushing — `deploy-pages` won't run if it fails.

## Known Limitations

- No email verification, password reset, or MFA.
- No role enforcement beyond organization membership.
- A true looping alarm sound cannot be played from a fully closed browser tab — push notifications for important items get `requireInteraction` + vibration instead, which is the strongest thing the Web Push API allows in that state.
- Push notifications depend on the browser's own push service (e.g. Chrome/Edge use Google's FCM) being reachable; there is no fallback if that service is down or blocked.
- Google Sheets sync (`AppsScript.gs`) is a separate, optional, non-transactional mirror — not a substitute for the real backend sync.
- Large task histories may eventually hit browser storage limits.
- Excel export depends on the XLSX CDN being available.

## Troubleshooting

### Service worker does not register / no push notifications

Use HTTP/HTTPS, not `file://`. Then check, in order: (1) OS notification permission was granted (Settings → Enable Notifications), (2) the browser console for a failed `/api/push/subscribe` call, (3) whether the account's session can actually reach the API at all — a broken refresh token loop (repeated 400/429 on `/api/auth/refresh` in the console) will silently prevent all syncing, including the data the server-side push service needs to see. Log out and back in to get a fresh session if you see that.

### An "important" reminder fired once but never fires again after I changed its time

Fixed 2026-09-23 — make sure you're on the latest deploy (hard-refresh, `Ctrl+Shift+R`). If it's still stuck, open the task and click Save Changes once (even without further edits) to clear the old dismissed state.

### Sync shows "waiting to sync" indefinitely

Check the browser console for failed requests to the API. If `/api/auth/refresh` is failing, your session needs to be re-established — log out and back in.

### Import does not work

Confirm the file is valid JSON containing supported arrays (`tasks`, `projects`, `goals`, `habits`, `notes`), and confirm the import preview modal before finalizing.

### Excel export fails

Check internet access to the XLSX CDN, or bundle the XLSX library locally and update `index.html`.

### Google Sheets sync (optional, legacy)

If using `AppsScript.gs`: confirm the Apps Script URL and Sync Token in Settings match the deployed script's `SYNC_TOKEN`, that it's deployed as a web app, and that `SPREADSHEET_ID` is set in Script Properties.
