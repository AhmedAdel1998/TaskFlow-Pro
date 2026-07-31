# TaskFlow Pro Documentation

TaskFlow Pro is a static, browser-based task management Progressive Web App (PWA). It stores work locally in the browser and can optionally sync task data to Google Sheets through a hardened Google Apps Script web app.

## Contents

- Application overview
- Features
- File structure
- Running the app
- User guide
- Google Sheets sync setup
- Security model
- Backup, restore, import, and export
- Offline/PWA behavior
- Testing
- Developer notes
- Known limitations
- Troubleshooting

## Application Overview

TaskFlow Pro is designed for personal and lightweight team task monitoring. The app runs entirely in the browser from static files:

- No build step is required to open or host the app.
- User data is stored in browser `localStorage`.
- Optional sync pushes/pulls task data to a Google Sheet using `AppsScript.gs`.
- PWA support allows browser installation and offline access when served over `http` or `https`.

The application includes task lists, Kanban, calendar events, Eisenhower matrix, projects, goals, habits, notes, analytics, reports, archive, Pomodoro timer, templates, saved filters, import/export, RTL language toggle, theme toggle, and Google Sheets sync.

## File Structure

```text
E:\Task Pro
  index.html          Main HTML shell and UI markup
  styles.css          Application styling and responsive design
  app.js              Main application logic
  sw.js               Service worker for PWA/offline caching
  manifest.json       PWA manifest
  AppsScript.gs       Google Apps Script sync backend
  icon-192.png        PWA icon
  icon-512.png        PWA icon
  package.json        Test scripts and dev dependency metadata
  package-lock.json   Locked npm dependency versions
  tests/
    syntax-check.js   Syntax and DOM reference validation
    smoke.js          Browser smoke test using Playwright Core
```

## Running The App

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

## Security Model

### What is protected

- The Apps Script rejects requests without the configured `SYNC_TOKEN`.
- Spreadsheet ID is stored in Apps Script Properties, not in source.
- Sync All requires the current user email to be in `ADMIN_EMAILS`.
- Client no longer ships a hardcoded Apps Script deployment URL.
- XLSX CDN script includes Subresource Integrity.
- A Content Security Policy is defined in `index.html`.

### What is not protected

TaskFlow Pro is still a static browser app. It does not provide true server-side login, sessions, or role permissions.

The login screen is local identity selection only. Anyone with browser access can inspect localStorage. For sensitive team data, use a real backend with authentication, authorization, audit logs, and server-side storage.

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

## Known Limitations

- No true server-side authentication.
- No true role-based authorization inside the static client.
- Google Sheets sync is not a transactional database.
- Conflict handling warns before overwrite but does not merge record-by-record.
- LocalStorage can be cleared by the browser or user.
- Large task histories may eventually hit browser storage limits.
- Excel export depends on the XLSX CDN being available.

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

