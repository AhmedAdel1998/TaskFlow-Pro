# Using TaskFlow Pro


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


For setup, storage semantics, reminders, and limitations see the frontend and backend READMEs and the verification matrix.
