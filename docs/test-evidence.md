# Local audit evidence — 2026-10-07

Workstation: Windows / PowerShell, .NET SDK 9.0.316, Node.js 24.11.0, installed Chrome/Edge driven by Playwright. Browser fixtures use `Africa/Cairo`. Tests use generated accounts and disposable SQLite files; they do not contact the production API. No deployment or production-data operation was performed.

## Commands and results

| Command (from repository root unless noted) | Result |
|---|---|
| `npm ci` in `frontend/` | Installed successfully; audited 2 packages, 0 reported vulnerabilities at execution time |
| `dotnet test backend/TaskFlow.sln --logger "trx;LogFileName=final.trx"` | 24 passed, 0 failed, 0 skipped; build completed without warnings |
| `npm --prefix frontend test` | Syntax/DOM checks; 371 matching English/Arabic keys and static references; 9 Node regression tests; deployment checks; 44 browser scenarios |
| `dotnet publish backend/src/TaskFlow.Api -c Release -o backend/artifacts/publish` | Published API, with no frontend files required |
| `node backend/tests/runtime-check.js` | Production process: migrations, register, save, stop, restart, login, persisted read, readiness |
| Independent frontend server (`node frontend/serve.js`, isolated port) | Root/subpath HTML, app/config scripts returned 200; README returned 404 |
| `docker info --format '{{.ServerVersion}}'` | Blocked: Docker Desktop Linux engine named pipe unavailable; container build/run not executed |
| `git diff --check` | No whitespace errors on final changes |

Saved logs: [backend tests](evidence/backend-tests.txt), [frontend tests](evidence/frontend-tests.txt), [publish and restart](evidence/publish-runtime.txt), [standalone frontend](evidence/frontend-server.txt). Full xUnit TRX is generated under `backend/tests/TaskFlow.IntegrationTests/TestResults/final.trx` (ignored build evidence, reproducible with the command above).

## Defects corrected

1. Shared sync queues could upload another account's data. Queues now belong to one account, legacy migration checks exact data-key ownership (including underscore usernames), and credentials are excluded.
2. HTTP failures removed queued writes; acknowledgments also removed newer in-flight edits. Failures retain their queue, and acknowledgments only remove the exact value sent.
3. Hydration/account-switch races could overwrite local work or write into a later session. Requests capture the account and hydration preserves pending data.
4. Generic store writes silently overwrote concurrent device edits. Version-aware PUTs now return 409; identical retries after lost responses are idempotent. Conflict resolution backs up both copies before explicit selection.
5. Concurrent refresh requests raced on both client and server. Client refresh is shared/locked; SQLite transactions serialize single-use refresh consumption. Expired, revoked and disabled sessions are rejected. Logout revokes refresh and clears local credentials/timers.
6. Structured task creation accepted foreign organization project/assignee references; updates lacked equivalent input validation. These cases now reject invalid input/reference access.
7. Production defaults included committed JWT/VAPID configuration and permissive CORS. VAPID keys were removed, production requires a private JWT key, production CORS is explicit, and push subscription targets are limited to browser push providers. If the old VAPID key was used, remote rotation remains necessary.
8. Local development defaulted to production and documented a port different from the launch profile/CSP. Default configuration, launch profile and CSP now agree on local port 5299; integration tests use local port 51789.
9. Templates and Excel/Sheets account enumeration crossed account boundaries. Templates and exported account lists now use the active account. Shared legacy template storage is retained for owner-confirmed recovery.
10. Push deduplication suppressed edited reminders permanently; failed sends were marked sent. Deduplication includes the trigger, successful delivery is required for sent state, and provider 410 removes expired subscriptions. Completed/dismissed items are suppressed and records are selected by exact username.
11. Browser account changes could leave one endpoint subscribed to multiple accounts. Subscription ownership transfers, unsubscribe remains scoped, and logout attempts detachment.
12. UTC dates were used for local-day reporting and overdue checks ignored due time. Local calendar helpers, due-time checks and explicit UTC reminder triggers cover Cairo midnight/DST fixtures. Monthly recurrence now clamps to the actual next month.
13. Completing tasks crashed in `launchConfetti` because `randomUnit` did not exist. It now uses `Math.random`; completion/archive flows are exercised.
14. Custom categories appeared as pills but were absent from the task-filter dropdown. The dropdown now includes actual categories; quoted names are safely passed to handlers.
15. RTL mobile flex content caused horizontal overflow. The main content can now shrink properly.
16. Reopening via editor/Kanban/bulk retained stale completion data; dependency checks were inconsistent. Completion metadata/progress and dependency guards now cover those paths.
17. Achievements counted unfinished archived tasks as completed. Counts now test completion status.
18. Pomodoro Save repeatedly added the configured full session even without elapsed work. It now records unlogged elapsed work seconds once.
19. Import silently truncated oversized sections and could generate duplicate IDs; dismissed reminder state was lost. Validation rejects oversized/invalid/duplicate records, generates unique IDs, and retains dismissal state. Storage failures roll back local import sections and normal data/queue writes.
20. CSV values were incompletely quoted and could be interpreted as formulas; task links/toasts and quoted folder/category handlers had unsafe rendering paths. CSV quoting/formula neutralization, HTTP(S) link filtering, attribute escaping, and text-only toasts were added.
21. Escape ignored focused inputs, leaving modals open. Escape now reaches overlay handling from inputs.
22. Offline cache omitted the actual versioned app script; failed HTTP responses could replace cached shell assets; notification clicks could focus unrelated same-origin windows. Cache and click handling were tightened and tested.
23. Clear-all removed only local values, so server hydration could resurrect them. Confirmed clearing now queues durable server deletions and is tested across reload.

## Investigated failures

- The first new logout test returned 400: EF/SQLite could not translate the timestamp expression inside `ExecuteUpdate`. Capturing the timestamp as a parameter fixed it; refresh/logout tests then passed.
- The first completion test raised `ReferenceError: randomUnit is not defined`; the code was fixed and the test retained.
- The mobile RTL assertion failed until flex shrinking was corrected; the width assertion remains.
- The quoted-category/link test failed because the new category never existed in the select options. The filtering implementation was fixed; the link and category assertions remain.
- A navigation/reload run produced an unexpected 409 despite passing its feature assertions. Idempotent identical-value retries and hydration acknowledgments were added, with a backend regression for a lost-response retry. The subsequent run passed without unexpected runtime errors. Real conflicts still return 409 and retain local data; they are not suppressed globally in tests.

## Limits

The [verification matrix](verification-matrix.md) records expected behavior, test cases, fixes, observed scope, and manual steps for every requested feature family. Not all permutations are covered. In particular: live push/device sounds/installation, running Docker and hosted volume persistence, all dynamic Arabic prose, full accessibility, long timer suspension, and complete spreadsheet download/opening checks are not claimed passed. Some browser checks call actual application functions with fixtures instead of exercising pointer gestures. External push transport and snooze timer tests are explicitly mocked.

Historical audit documents remain historical. The current stack is SQLite; the frontend's actual server store is `/api/data`. Structured task/project APIs remain a separate model. This audit does not claim “100% working.”
