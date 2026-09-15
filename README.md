# TaskFlow Pro Documentation

TaskFlow Pro is a task management product currently made of **two parts that are not yet connected to each other**:

1. **The client app** (`index.html`, `styles.css`, `app.js`, `sw.js`, `AppsScript.gs`) — a static, browser-based Progressive Web App (PWA). It stores work locally in the browser and can optionally sync task data to Google Sheets. This is what a person actually opens and uses today.
2. **The backend foundation** (`src/TaskFlow.*`, `tests/TaskFlow.IntegrationTests`) — a real ASP.NET Core Web API with PostgreSQL, JWT authentication, and organization-scoped (multi-tenant) data, built to replace `localStorage` as the system of record. It is functional and covered by automated tests, but **no UI is wired up to it yet** — it cannot currently be used by an end user.

This split is deliberate: see `docs/phase-1-audit.md` for why (short version — the client app has no real authentication, authorization, or tenant isolation, so it is not safe to sell to teams/companies as-is; the backend is being built as a staged "strangler" replacement rather than a risky big-bang rewrite). `docs/feature-parity-matrix.md` tracks which features have moved from "local-only" to "built and tested on the API" so far.

## Contents

- Application overview
- Repository structure
- Running the client app
- User guide (client app)
- Google Sheets sync setup
- Backend API (in progress)
- Security model
- Backup, restore, import, and export
- Offline/PWA behavior
- Testing
- Developer notes
- Project status and roadmap
- Known limitations
- Troubleshooting

## Application Overview

TaskFlow Pro is designed for personal and lightweight team task monitoring, with a longer-term goal of becoming a commercial multi-tenant SaaS product (see `docs/phase-1-audit.md` for the full target architecture).

### Client app (what exists today, usable now)

- No build step is required to open or host it.
- User data is stored in browser `localStorage`.
- Optional sync pushes/pulls task data to a Google Sheet using `AppsScript.gs`.
- PWA support allows browser installation and offline access when served over `http` or `https`.
- Includes task lists, Kanban, calendar events, Eisenhower matrix, projects, goals, habits, notes, analytics, reports, archive, Pomodoro timer, templates, saved filters, import/export, RTL language toggle, theme toggle, and Google Sheets sync.

### Backend API (new, not yet connected to any UI)

- ASP.NET Core 9 Web API (`src/TaskFlow.Api`) following a Clean Architecture split: `TaskFlow.Domain` (entities), `TaskFlow.Application` (contracts/use-case interfaces), `TaskFlow.Infrastructure` (EF Core/PostgreSQL, JWT auth, tenant-scoped services), `TaskFlow.Api` (thin HTTP endpoints).
- Real registration/login (password hashing, JWT access token + refresh token), organization-scoped tasks/projects/subtasks/comments/tags, row-version optimistic concurrency, and server-side tenant isolation enforced on every query.
- Verified with an automated integration test suite that runs against a real, ephemeral PostgreSQL container (see "Backend API" section below).

## Repository Structure

```text
E:\Task Pro
  index.html                        Client app: HTML shell and UI markup
  styles.css                        Client app: styling and responsive design
  app.js                            Client app: main application logic
  sw.js                             Client app: service worker for PWA/offline caching
  manifest.json                     Client app: PWA manifest
  AppsScript.gs                     Client app: Google Apps Script sync backend
  icon-192.png, icon-512.png        Client app: PWA icons
  package.json, package-lock.json   Client app: test scripts and dev dependency metadata
  tests/
    syntax-check.js                 Client app: syntax and DOM reference validation
    smoke.js                        Client app: browser smoke test using Playwright Core
    TaskFlow.IntegrationTests/      Backend: xUnit integration tests (auth, tenant isolation, concurrency)

  TaskFlow.sln                      Backend: .NET solution file
  src/
    TaskFlow.Domain/                Backend: entities (User, Organization, TaskItem, Subtask, TaskComment, Tag, ...)
    TaskFlow.Application/           Backend: DTOs, commands, and service interfaces
    TaskFlow.Infrastructure/        Backend: EF Core DbContext, migrations, auth/task/project/subtask/comment/tag services
    TaskFlow.Api/                   Backend: Program.cs — endpoint mapping, JWT config, rate limiting, health checks

  docs/
    phase-1-audit.md                Architecture, security, and data-model audit of the client app
    feature-parity-matrix.md        Feature-by-feature status: local-only vs. built-and-tested on the API
```

## Running The Client App

### Simple local use

Open `index.html` directly in a browser.

Most app features work this way. Service worker registration is skipped on `file://` because browsers only allow service workers on `http`, `https`, or localhost.

### Local HTTP server

For full PWA behavior, serve the folder over HTTP:

```powershell
cd "E:\Task Pro"
python -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/index.html
```

## User Guide

### Login

Enter an email address on the login screen.

Important: this is local identity selection, not secure account authentication. It separates each local user's data in browser storage and enables owner assignment.

### Dashboard

The dashboard shows:

- Total tasks
- Completed tasks
- In-progress tasks
- Overdue tasks
- Weekly completion chart
- Priority distribution
- Productivity heatmap
- Upcoming deadlines
- Goal progress
- Habit streaks
- Recent activity

Dashboard filters:

- Date: all dates, today, this week, this month
- Project
- Owner

### Tasks

Tasks support:

- Title and description
- Priority
- Category
- Project
- Owner
- Eisenhower quadrant
- Due date and due time
- Status
- Progress
- Estimated hours
- Logged hours
- Link
- Notes
- Tags
- Recurrence
- Reminder
- Milestone flag
- Dependencies
- Subtasks
- Comments

Useful shortcuts:

- `Q`: quick add task
- `/`: focus task search
- `Alt+N`: open new task modal
- `Escape`: close open overlays/modals

Quick add syntax:

```text
Prepare report !high @Work #finance ~ProjectName
```

Supported quick tokens:

- `!high`, `!medium`, `!low` for priority
- `@category` for category
- `#tag` for tags
- `~project` for an existing project

### Task Filters

The task page can filter by:

- Status
- Priority
- Category
- Project
- Owner
- Search text

Sorting options:

- Newest
- Oldest
- Due soon
- Priority
- Smart score
- A-Z

### Kanban

Kanban groups tasks by:

- To Do
- In Progress
- Done

Drag a task between columns to update its status.

### Calendar

Calendar includes:

- Tasks by due date
- Custom events
- Event type
- Event time and end time
- Event color
- Event description

Click a day to create an event.

### Eisenhower Matrix

The matrix organizes active tasks into:

- Urgent and important
- Not urgent and important
- Urgent and not important
- Not urgent and not important

Tasks can be assigned manually to a quadrant, or the app can infer placement from priority and due date.

### Projects

Projects support:

- Name
- Description
- Color
- Progress based on linked tasks

Projects can be used as filters across tasks and dashboard views.

### Goals

Goals support:

- Weekly or monthly goal type
- Target
- Current progress
- Unit

### Habits

Habits track daily completion and streaks.

### Notes

Notes support:

- Title
- Folder
- Pinning
- Markdown-style preview for simple formatting
- Search

### Reports

Reports summarize logged time by:

- Total logged hours
- Category
- Project
- Recent days

### Archive

Archived tasks are removed from the active task list and stored in the archive. They can be restored or permanently cleared.

### Pomodoro Timer

The Pomodoro timer supports:

- Work duration
- Break duration
- Session count
- Optional task selection
- Saving focus time to a task

Durations are configured in Settings.

## Settings

Settings includes:

- Current local user
- Apps Script URL
- Sync token
- Google Sheets sync controls
- Admin sync-all control
- Pomodoro durations
- Language/RTL toggle
- Export
- Import
- Browser notifications
- Clear all data

## Google Sheets Sync Setup

Google Sheets sync uses `AppsScript.gs`. It is optional.

### 1. Create a Google Sheet

Create a spreadsheet in Google Sheets and copy its spreadsheet ID from the URL.

Example URL shape:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

### 2. Create Apps Script Project

1. Go to `https://script.google.com`.
2. Create a new project.
3. Paste the full contents of `AppsScript.gs`.

### 3. Configure Script Properties

In Apps Script:

1. Open Project Settings.
2. Add Script Properties:

```text
SPREADSHEET_ID = your spreadsheet id
SYNC_TOKEN = a long random secret
ADMIN_EMAILS = admin1@example.com,admin2@example.com
```

`ADMIN_EMAILS` is required only for the Sync All Users action.

Use a long random `SYNC_TOKEN`. Do not publish it in source code.

### 4. Deploy Web App

Deploy as a web app:

- Execute as: Me
- Who has access: Anyone

The web app can be public because `AppsScript.gs` checks `SYNC_TOKEN` before spreadsheet access.

### 5. Configure The App

In TaskFlow Pro Settings:

1. Set Apps Script URL to the deployed web app URL.
2. Set Sync Token to the same value as `SYNC_TOKEN`.
3. Click Test.
4. Use Push or Pull.

## Sync Behavior

### Push

Push sends the current account's tasks to the matching sheet.

### Pull

Pull replaces the current account's local tasks with tasks from Google Sheets.

If local tasks changed after the last sync, the app warns before pulling.

### Sync All

Admin-only client control for pushing all local users from this browser to separate sheets. Server-side Apps Script also checks `ADMIN_EMAILS`.

## Backend API (In Progress)

This is the real API/database foundation described in the audit. It is functional and tested but **has no connected UI** — there is no login screen, task list, or any other page that talks to it. It is meant to eventually replace the client app's `localStorage` layer.

### Architecture

```text
src/TaskFlow.Api            Program.cs: minimal-API endpoint mapping, JWT bearer auth, rate limiting,
                             security headers, exception-to-HTTP-status middleware, health checks
src/TaskFlow.Application     Commands/DTOs (RegisterCommand, CreateTaskCommand, TaskDto, ...) and
                             service interfaces (IAuthService, ITaskService, IProjectService, ...)
src/TaskFlow.Infrastructure  EF Core DbContext + PostgreSQL migrations, and the concrete service
                             implementations that enforce organization membership on every query
src/TaskFlow.Domain          Plain entities: User, Organization, OrganizationMember, Project,
                             TaskItem, Subtask, TaskComment, Tag, TaskTag, RefreshSession
```

Every entity that belongs to an organization carries an `OrganizationId`, and every service method re-checks that the authenticated user is a member of that organization before touching any row — the organization ID is read from the signed JWT claim, never from a client-supplied value.

### Endpoints implemented so far

```text
POST /api/auth/register        Create user + organization + Owner membership; returns JWT + refresh token
POST /api/auth/login            Returns JWT + refresh token, or 401
POST /api/auth/refresh          Rotates a refresh token, or 401 if invalid/expired/revoked

GET  /api/tasks                 List tasks in the caller's organization
POST /api/tasks                 Create a task
PUT  /api/tasks/{id}             Update a task (requires the row's current Version; stale Version -> 409)

GET  /api/projects              List projects in the caller's organization
POST /api/projects              Create a project

GET  /api/tasks/{taskId}/subtasks    List a task's subtasks
POST /api/tasks/{taskId}/subtasks    Add a subtask
PUT  /api/tasks/{taskId}/subtasks/{id} Update a subtask

GET  /api/tasks/{taskId}/comments    List a task's comments
POST /api/tasks/{taskId}/comments    Add a comment

GET  /api/tags                  List organization tags
POST /api/tags                  Create a tag

GET  /health/live               Liveness probe
GET  /health/ready               Readiness probe (checks DB connectivity)
```

All `/api/*` routes except `/api/auth/*` require a valid `Authorization: Bearer <token>` header. Unauthenticated requests get 401; requests for another organization's data get 403/404 rather than leaking whether the record exists.

### Running it locally

Requires the .NET 9 SDK and a PostgreSQL instance. The quickest way to get a database is Docker:

```powershell
docker run -d --name taskflow-postgres -e POSTGRES_PASSWORD=devpassword123 -e POSTGRES_DB=taskflow -p 5432:5432 postgres:16-alpine
```

Set the connection string and JWT signing key (either edit `src/TaskFlow.Api/appsettings.Development.json` or set environment variables), then apply migrations and run:

```powershell
cd "E:\Task Pro"
dotnet ef database update --project src\TaskFlow.Infrastructure --startup-project src\TaskFlow.Api
dotnet run --project src\TaskFlow.Api
```

The API listens on the URL printed at startup (see `src/TaskFlow.Api/Properties/launchSettings.json`). Try it with:

```powershell
curl -X POST http://localhost:5299/api/auth/register -H "Content-Type: application/json" -d "{\"email\":\"you@example.com\",\"password\":\"a-long-enough-password\",\"organizationName\":\"My Org\"}"
```

### Configuration

`src/TaskFlow.Api/appsettings.json` reads:

```text
ConnectionStrings:TaskFlow   PostgreSQL connection string (required)
Jwt:Key                      HMAC-SHA256 signing key for access tokens (required, 32+ bytes recommended)
RateLimits:Auth              Requests/minute permitted per policy window on /api/auth/* (default 10)
```

The checked-in `appsettings.json` value for `Jwt:Key` and the PostgreSQL password are placeholders for local development only — replace both before deploying anywhere real. Real secrets must never be committed; use environment variables or a secrets manager in any shared or production environment.

### Testing

```powershell
cd "E:\Task Pro"
dotnet build TaskFlow.sln
dotnet test TaskFlow.sln
```

`dotnet test` runs `tests/TaskFlow.IntegrationTests`, which spins up a real, ephemeral PostgreSQL container per test class (via Testcontainers) and exercises the running API through `WebApplicationFactory`. It currently proves:

- Registration, login, and task creation succeed end-to-end.
- Wrong password and duplicate-email registration are rejected.
- **Cross-tenant isolation**: one organization's tasks, subtasks, and comments are invisible to, and cannot be modified by, a user in a different organization (404, not just an empty list).
- Anonymous requests to protected endpoints are rejected (401).
- A stale optimistic-concurrency `Version` on update is rejected (409), proving two concurrent editors cannot silently clobber each other.
- Blank/invalid input is rejected server-side (400), not trusted from the client.
- The auth rate limiter actually returns 429 once its configured threshold is exceeded.

As of 2026-09-15, all 9 integration tests pass against a clean build. This is evidence for the claims above — it is not a claim that the backend is production-ready as a whole (see "Known Limitations").

## Security Model

### Client app: what is protected

- The Apps Script rejects requests without the configured `SYNC_TOKEN`.
- Spreadsheet ID is stored in Apps Script Properties, not in source.
- Sync All requires the current user email to be in `ADMIN_EMAILS`.
- Client no longer ships a hardcoded Apps Script deployment URL.
- XLSX CDN script includes Subresource Integrity.
- A Content Security Policy is defined in `index.html`.

### Client app: what is not protected

The client app is still a static browser app. It does not provide true server-side login, sessions, or role permissions.

The login screen is local identity selection only. Anyone with browser access can inspect localStorage. For sensitive team data, use a real backend with authentication, authorization, audit logs, and server-side storage — which is exactly what the backend API above is being built to provide, once it is wired up.

### Backend API: what is protected

- Passwords are hashed (`Microsoft.AspNetCore.Identity.PasswordHasher`), never stored or logged in plain text.
- Access tokens are short-lived (15 min) signed JWTs; refresh tokens are long random values stored server-side only as a SHA-256 hash, so a leaked database row cannot be replayed as a token.
- Every data-access path derives the organization ID from the signed JWT, then re-verifies organization membership before any read or write — a client cannot request another organization's data by guessing or forging an ID.
- Row-version optimistic concurrency prevents silent overwrite on concurrent edits.
- `/api/auth/*` is rate-limited; unhandled exceptions are mapped to generic HTTP status codes instead of leaking stack traces.
- Security response headers (`X-Content-Type-Options`, `Referrer-Policy`) are set on every response; HTTPS redirection is enabled.

### Backend API: what is not yet protected

- No email verification, password reset flow, account lockout, or MFA.
- Only the `Owner` role currently exists in practice — the `OrganizationRole` enum has Admin/Manager/Member/Viewer values, but no endpoint yet checks role beyond "is a member of this organization."
- No audit log, no invitations, no CORS policy configured, no secrets manager integration — the JWT key and DB password in `appsettings.json` are dev-only placeholders.
- Not deployed anywhere; no CI/CD; no production configuration has been created or tested.

## Backup, Restore, Import, And Export

### Export JSON

Exports:

- Tasks
- Projects
- Goals
- Habits
- Notes

### Export CSV

Exports tasks with:

- ID
- Title
- Status
- Priority
- Category
- Due date
- Tags
- Owner
- Created
- Updated

### Export Excel

Exports one sheet per known local user.

### Import JSON

Import validates and normalizes data before saving. It opens a preview showing the number of records to import.

Import replaces matching local data sections for the current account.

## Offline And PWA Behavior

`sw.js` caches:

- `index.html`
- `styles.css`
- `app.js`
- `manifest.json`
- icons

The service worker uses a network-first strategy and falls back to cached files.

Service workers require HTTP/HTTPS. They do not run from direct `file://` loading.

## Testing

This section covers the client app's own test suite (Node/Playwright). For the backend API's test suite (`dotnet test`), see "Backend API > Testing" above.

Install dependencies:

```powershell
cd "E:\Task Pro"
npm install
```

Run all tests:

```powershell
npm test
```

Run syntax checks:

```powershell
npm run test:syntax
```

Run browser smoke test:

```powershell
npm run test:smoke
```

The smoke test verifies:

- App load
- Login
- Navigation across all primary pages
- Task creation
- Global search
- Owner filtering
- Project/goal/habit creation
- Note creation and search
- Calendar event creation
- Dashboard filters
- Settings sync status
- Import preview
- Accessibility attributes
- Local data persistence

## Developer Notes

### Backend layout and conventions

- Keep tenant scoping mandatory: every new `Infrastructure` service method must take the caller's `Guid organizationId` (read from the JWT claim by the endpoint, never from the request body) and verify membership (see the `Tenant.Require`/`Tenant.IsMember` helper in `src/TaskFlow.Infrastructure/Services.cs`) before touching any row.
- Add new entities to `src/TaskFlow.Domain/Entities.cs`, configure them in `TaskFlowDbContext.OnModelCreating`, then generate a migration:
  ```powershell
  dotnet ef migrations add <Name> --project src\TaskFlow.Infrastructure --startup-project src\TaskFlow.Api --output-dir Migrations
  ```
- Add new endpoints in `src/TaskFlow.Api/Program.cs`; wrap anything that should map to a specific HTTP status by throwing `UnauthorizedAccessException` (403), `KeyNotFoundException` (404), `ArgumentException`/`InvalidOperationException` (400), or letting EF Core throw `DbUpdateConcurrencyException` (409) — the shared exception-handling middleware maps these consistently.
- Add integration test coverage in `tests/TaskFlow.IntegrationTests`. Prefer proving negative/security cases (cross-tenant access, missing auth, stale versions) over only happy-path cases — that is what makes the test suite meaningful evidence rather than a smoke check.

### Main client files

- `index.html`: markup, modals, page containers, external scripts.
- `styles.css`: theme variables, layout, responsive rules, component styles.
- `app.js`: data layer, rendering, event handlers, sync, import/export, PWA registration.

### Data storage

Data is stored in browser `localStorage`.

Most keys are user-scoped:

```text
<base_key>_<currentUserEmail>
```

Examples:

```text
taskflow_tasks_user@example.com
taskflow_projects_user@example.com
taskflow_goals_user@example.com
```

Global keys:

```text
taskflow_users
taskflow_templates
taskflow_lang
taskflow_theme
taskflow_current_user
taskflow_script_url
```

### Task model

Core task fields include:

```text
id
numId
title
description
status
priority
category
project
assignee
eisenhower
due
due_time
progress
note
estimated_hours
logged_hours
link
tags
subtasks
recurring
reminder
milestone
dependencies
createdAt
updatedAt
completedAt
comments
sortOrder
myDay
myDaySlot
smartScore
```

### Adding New UI

Use existing patterns:

- Page containers use `id="page-..."`.
- Navigation uses `data-page`.
- Modals use `.modal-overlay` and `.modal`.
- Toasts use `toast(message, type)`.
- User data should be scoped through `userKey(base)`.
- Validate imported or synced data before saving.

### Adding Tests

Add coverage in:

- `tests/syntax-check.js` for static/syntax validation.
- `tests/smoke.js` for browser-level behavior.

Run `npm test` before deployment.

## Project Status And Roadmap

TaskFlow Pro is mid-migration from a local-only client app to a real multi-tenant SaaS backend, following the staged plan in `docs/phase-1-audit.md`. Current state, honestly:

| Layer | Status |
| --- | --- |
| Client app (`index.html`/`app.js`) | Fully functional as a local/single-browser tool. This is the only part an end user can currently use. |
| Backend API (`src/TaskFlow.*`) | Auth, tasks, projects, subtasks, comments, and tags are implemented, tenant-isolated, and covered by passing integration tests against a real database. Not deployed; not connected to any UI. |
| Frontend-to-API integration | Not started. The client app still reads/writes only `localStorage`. |
| Everything else in the audit (roles beyond Owner, invitations, goals/habits/notes/calendar/reports on the API, billing, CI/CD, deployment) | Not started. |

See `docs/feature-parity-matrix.md` for the up-to-date feature-by-feature status, and `docs/phase-1-audit.md` for the full architecture/security audit and target design. Do not describe this project as "production-ready" or safe for real company/team data until both the audit's critical findings are resolved and a frontend is actually wired to the authenticated API.

## Known Limitations

### Client app

- No true server-side authentication.
- No true role-based authorization inside the static client.
- Google Sheets sync is not a transactional database.
- Conflict handling warns before overwrite but does not merge record-by-record.
- LocalStorage can be cleared by the browser or user.
- Large task histories may eventually hit browser storage limits.
- Excel export depends on the XLSX CDN being available.

### Backend API

- No UI is connected to it yet — it cannot be used end-to-end today.
- No password reset, email verification, or account recovery flow.
- No role enforcement beyond "is an organization member" (the Admin/Manager/Member/Viewer roles exist in the data model but are not yet checked anywhere).
- No invitations, audit log, notifications, or reporting endpoints.
- Not deployed, no CI/CD pipeline, and the checked-in dev configuration values (JWT key, DB password) must be replaced before any real deployment.

## Troubleshooting

### Service worker does not register

Use HTTP/HTTPS instead of opening `index.html` directly with `file://`.

### Sync test fails

Check:

- Apps Script URL is correct.
- Sync token matches `SYNC_TOKEN`.
- Apps Script is deployed as a web app.
- `SPREADSHEET_ID` is set in Script Properties.
- The script owner has access to the spreadsheet.

### Sync All fails

Check:

- `ADMIN_EMAILS` is set in Script Properties.
- The logged-in app email matches one of the admin emails.
- The same `SYNC_TOKEN` is configured in the app.

### Import does not work

Check:

- File is valid JSON.
- File shape contains supported arrays such as `tasks`, `projects`, `goals`, `habits`, or `notes`.
- Confirm the import preview modal.

### Excel export fails

Check internet access to the XLSX CDN, or bundle the XLSX library locally and update `index.html`.

## Operational Checklist

Before using with real team data:

1. Deploy the latest `AppsScript.gs`.
2. Set `SPREADSHEET_ID`, `SYNC_TOKEN`, and `ADMIN_EMAILS`.
3. Configure Apps Script URL and Sync Token in Settings.
4. Click Test in Settings.
5. Run `npm test`.
6. Export a JSON backup before large imports or pulls.

