# TaskFlow Pro Feature Parity Matrix

This matrix records the Phase 1 baseline plus what has since actually been built. "Planned" is a migration target, not a claim that the replacement exists; "Built" means code exists and has passing automated tests; "Deployed" is not yet claimed for anything — none of this backend has been deployed to a real environment.

**Verified 2026-09-15:** `dotnet build TaskFlow.sln` succeeds with 0 warnings/errors; `dotnet test TaskFlow.sln` passes 9/9 integration tests running against a real, ephemeral, Dockerized PostgreSQL instance (Testcontainers), covering registration, login, wrong-password rejection, duplicate-email rejection, cross-tenant task/subtask/comment isolation, anonymous-request rejection, optimistic-concurrency conflicts, server-side validation, and auth-endpoint rate limiting. The legacy static app (`index.html`/`app.js`) is untouched and still the only thing an end user can actually open in a browser today — there is no frontend wired to this new API yet.

| Existing Feature | Current Implementation | Production Replacement | Status | Tests / evidence |
| --- | --- | --- | --- | --- |
| Login | Local email identity selector | ASP.NET Core Web API: register/login/refresh, PBKDF2 password hashing (`PasswordHasher<User>`), JWT access token (15 min) + hashed opaque refresh token (30 day), rate-limited (configurable, default 10/min) | Built, not deployed | `SecurityAndTenancyTests`: register+create, duplicate email rejected, wrong password rejected; `RateLimitTests`: 429 after threshold |
| Tasks | Per-email localStorage record array | Tenant-scoped `TaskItem` entity + EF Core/PostgreSQL, org-membership check on every operation, row-version optimistic concurrency | Built, not deployed | `SecurityAndTenancyTests`: create, cross-tenant list isolation, cross-tenant update returns 404 (no existence leak), stale-version update returns 409, blank-title create returns 400 |
| Projects | Per-email localStorage | Tenant-scoped `Project` entity + API (list/create) | Built, not deployed | Covered indirectly by tenancy/auth middleware tests; no dedicated project test yet |
| Subtasks / Comments / Tags | Embedded in local task record | Separate tenant-scoped entities + API (`/api/tasks/{id}/subtasks`, `/comments`, `/api/tags`), task ownership re-verified before any child write | Built, not deployed | `SecurityAndTenancyTests.Subtasks_and_comments_are_tenant_scoped`: cross-tenant create/list on another org's task returns 404 |
| Kanban | Client drag/drop and local write | API persistence + concurrency | Gap | Navigation smoke only |
| Calendar | Local events and due-date projection | CalendarEvent API with UTC/timezones | Gap | Smoke create event |
| Notes | Local records + browser search | Authorized API persistence/search | Gap | Smoke create/search |
| Goals | Local records | User/org-scoped API | Gap | Smoke create |
| Habits | Local completion map | User/org-scoped API/history | Gap | Smoke create |
| Reports | Browser aggregation | Authorized server aggregation | Gap | Navigation smoke only |
| Google Sheets | Apps Script + client shared token | Optional server-side integration | Gap / insecure legacy | No integration test |
| PWA | Network-first service-worker cache | Cached API + offline operation queue | Partial | No HTTP/service-worker test |
| Import | Local JSON validation and replacement | Authorized preview/import job + audit | Partial | Smoke preview validation |
| Export | Client JSON/CSV/XLSX | Authorized export service; retain portable formats | Partial | No export assertion |
| Theme / RTL | Browser preferences and partial dictionary | Central i18n preferences | Partial | Smoke accessibility only |
| Notifications | Browser permission and interval | In-app/email/push notification system | Gap | No notification test |
| Archive | Local task archive | Soft deletion/retention policy | Gap | Navigation smoke only |
| Pomodoro/time | Browser timer modifies local task hours | Time entries and sessions API | Gap | No focused test |
| Templates / filters | Browser-global templates / per-email filters | User/org-scoped persistence | Gap | No focused test |
