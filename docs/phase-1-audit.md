# TaskFlow Pro: Phase 1 Architecture Audit

**Audit date:** 2026-09-14  
**Repository revision:** `922c0ea` (`Initial TaskFlow Pro app`)  
**Scope:** Read-only architectural and product audit. No runtime application behaviour was changed in this phase.

## Executive conclusion

TaskFlow Pro is a polished, static, browser-local productivity PWA. It is suitable for an individual using one browser profile, with optional task replication to Google Sheets. It is **not a commercial multi-tenant SaaS** and must not be represented as production-ready for company or team data.

The largest blockers are architectural rather than cosmetic: the browser accepts any email as an identity, authorization is a client-side string comparison, all authoritative records and the Google sync credential are readable and mutable in `localStorage`, and the Apps Script endpoint authorizes a bearer token supplied by the browser. There is no backend, relational database, tenant boundary, server-side audit trail, session lifecycle, or CI/CD deployment system.

The correct path is a staged strangler migration: preserve this UI and its local export format while adding a separately deployable API and database. Do not attempt a wholesale framework rewrite before the backend foundation and feature-parity contract are proven.

## A. Current architecture

```text
Browser
  index.html + styles.css + app.js
    ├─ localStorage (authoritative data, per-email key suffixes)
    ├─ browser notifications and timers
    ├─ service worker cache (network-first)
    ├─ JSON / CSV / XLSX file import-export
    └─ optional Google Apps Script HTTP calls
           └─ one Google Spreadsheet, separate sheets by email prefix
```

| Area | Actual implementation | Assessment |
| --- | --- | --- |
| Frontend | One 46 KB HTML shell, 41 KB stylesheet and 122 KB global JavaScript file; DOM rendering is string-based and event handlers are mostly inline. | Working, but not componentized, typed, or independently testable. |
| Identity | Email-format check, persisted as `taskflow_current_user`; auto-login restores that value. | Not authentication. Any person with browser access can impersonate any email. |
| Data | `localStorage`; most keys are suffixed with current email. Templates, users, language, theme, and script URL are global. | No durable server source of truth, transactions, tenancy, or quota management. |
| Sync | Apps Script calls send `authToken` and email/user information from the client; Apps Script uses a spreadsheet property token. | Experimental replication, not secure synchronization or a database. |
| PWA | Manifest, icons, and a network-first cache-all-GET service worker. | Basic install/offline shell support; no offline operation queue, sync protocol, or cache version safety. |
| Test tooling | Node syntax/DOM-reference check and a Playwright smoke script using a local browser executable. | Useful regression baseline; no unit, API, security, accessibility, integration, or CI coverage. |
| Deployment | Static files opened directly or served with a local Python HTTP server. | No production environment definition, API, database, Docker, health checks, observability, or release pipeline. |

## B. Complete feature inventory

| Feature | Current behavior and storage | Regression risk / production replacement |
| --- | --- | --- |
| Local sign-in and onboarding | Email selector; user list/current user in `localStorage`. | Replace with registration, verified login, sessions, organization creation, and guided onboarding. Preserve migration entry point. |
| Tasks | Rich local task model, filtering/sorting, bulk actions, task detail, subtasks, comments, recurrence, dependencies, My Day, reminders and archive. | Highest priority. Replace with organization-scoped Tasks, Subtasks, Comments, Tags, Dependencies, history and row-version concurrency. |
| Dashboard and analytics | Browser-side counts, charts, heatmap, deadlines, goals/habits, and activity. | Move large-data aggregation to authorized API queries; provide personal/team/project scopes. |
| Kanban / Eisenhower / My Day | Client-side task projections; drag/drop persists immediately to local storage. | Retain views over API task queries; use optimistic updates with conflict recovery. |
| Calendar | Task due dates plus local custom events. | Introduce CalendarEvents with UTC instants, timezone display, validation, and recurrence policy. |
| Projects | Name, description, color and task-derived progress. | Add owner, members, state, dates, project permissions, milestones, and analytics. |
| Goals and habits | Personal local records and completion map. | Scope per user and organization; add server persistence and history. |
| Notes | Local Markdown-style preview, folders, pinning and search. | Add ownership/permissions, autosave protocol, server search and concurrency. |
| Time and Pomodoro | Browser timer adds logged time to a task. | Model time entries / sessions server-side; retain personal timer UX. |
| Templates and saved filters | Local templates are global to browser; filters are email-keyed. | Make explicitly user or organization scoped and permissioned. |
| Import/export | JSON import preview replaces selected local collections; CSV/JSON/XLSX export. | Preserve file format where possible; add authenticated server import jobs, validation, preview, audit log, limits and export authorization. |
| Google Sheets | Optional push/pull and per-task calls to a public Apps Script deployment. | Retain only as an explicit opt-in integration using server-held OAuth/credentials and job-based sync. |
| Notifications | Browser permission and in-browser due reminder interval. | Add server notification preferences, in-app inbox, email worker and optional browser push. |
| Theme and English/Arabic RTL | Global local preference, partial translation dictionary, `dir` toggle. | Preserve; centralize strings and localize dates/numbers as frontend architecture evolves. |
| PWA | Cached application files and install prompt. | Retain app shell; replace blind data persistence with IndexedDB cache and a durable, idempotent sync queue. |

## C. Current data model

### Storage namespaces

`taskflow_tasks`, `taskflow_activity`, `taskflow_archive`, `taskflow_filters`, `taskflow_projects`, `taskflow_goals`, `taskflow_habits`, `taskflow_notes`, `taskflow_events`, daily notes, Pomodoro preferences, sync token/status, and onboarding state use a current-email suffix. `taskflow_users`, `taskflow_templates`, language, theme, script URL, and current user are browser-global.

### Core records

| Record | Key fields currently present | Gaps material to SaaS |
| --- | --- | --- |
| Task | ID/number, title, description, status, priority, category, project, assignee, Eisenhower quadrant, due date/time, progress, notes/link, tags, subtasks, recurrence, reminder, milestone, dependencies, timestamps, comments, sort/My Day/smart score. | No immutable organization/user foreign keys, normalized relations, server validation, soft delete policy, audit actor, version/ETag, or reliable timezone contract. |
| Project | ID, name, color, description, created timestamp. | No owner/membership/status/date boundaries or authorization. |
| Goal | ID, title, weekly/monthly type, target/current/unit, created timestamp. | No owner/organization relation or activity history. |
| Habit | ID, name, completion-date map, created timestamp. | No owner/organization relation or timezone rule. |
| Note | ID, title, content, folder, pinned, created/updated timestamps. | No access control, revision, robust rich-text policy, or search index. |
| Calendar event | Local ID/title/date/time/end time/type/color/description. | No attendee/owner/organization relation, UTC instant, recurrence, or audit history. |

### Proposed initial relational model

Build only the migration-critical entities first:

```text
User ─< OrganizationMember >─ Organization ─< Project ─< Task
                                               │          ├─< TaskComment
                                               │          ├─< TaskTag >─ Tag
                                               │          ├─< TaskDependency
                                               │          ├─< Subtask
                                               │          └─< TimeEntry
Organization ─< Team ─< TeamMember
Organization ─< Invitation
Organization ─< AuditLog
User ─< RefreshToken / Session
```

Every tenant-owned table needs `OrganizationId`, a database foreign key, an index beginning with `OrganizationId`, and repository/query policies that derive the organization from the authenticated principal and active membership—not from a browser-provided value. Use UUIDs or ULIDs, UTC timestamps, and a row-version/concurrency token on mutable aggregate roots.

Defer Goals, Habits, Notes, CalendarEvents, Notifications, Templates, SavedFilters, and Integration configurations until the core foundation has security and parity tests.

## D. Security audit

### Critical findings

| ID | Finding | Evidence | Impact | Required remediation |
| --- | --- | --- | --- | --- |
| SEC-01 | No authentication or session security. | A syntactically valid email becomes `currentUser`; auto-login trusts the stored value. | Account impersonation and direct access to locally retained data. | Server-side registration/login, strong password hashing, verified email, secure session/refresh design, logout/revocation, reset flow and rate limits. |
| SEC-02 | No authorization or tenant isolation. | `isAdmin()` compares the email to a hard-coded client constant; all role/user data is browser-visible/mutable. | Privilege escalation, IDOR/BOLA, and organization data exposure in any shared design. | Enforce membership, role and permission checks in API use cases; derive principal and tenant only server-side. |
| SEC-03 | Sync bearer secret is stored in `localStorage` and sent by query string for GET requests. | `taskflow_sync_token`; PING/PULL place `authToken` in the URL. | Token exposure through browser storage, history, proxy/server logs and XSS; token reuse grants spreadsheet access. | Retire as primary path. Future integrations use encrypted server-side credentials and POST authorization; rotate exposed credentials. |
| SEC-04 | Apps Script permits any client knowing one shared token to read/write a sheet selected by supplied email/sheet name. | `assertAuthorized` only checks token; `SYNC_PUSH`, `SYNC_PULL`, and per-row actions trust user/sheet input. | Cross-user data reads/writes, destructive overwrites, no identity/audit boundary. | Remove from primary data path. Rebuild as OAuth integration initiated by authenticated organization admins. |
| SEC-05 | Client data is directly mutable and clearable. | All records, current user, users, and templates reside in localStorage. | No confidentiality, integrity, recoverability, retention, or legal deletion assurance. | Move authoritative records to a relational database with access controls, backups, audit and retention policies. |

### High findings

| ID | Finding | Impact | Required remediation |
| --- | --- | --- | --- |
| SEC-06 | Pull sync replaces all local tasks; task-sheet conversion discards many fields; no record merge/version check. | Silent data loss and inconsistent records across devices. | Use server versions/ETags, idempotency keys, operation queue, conflict responses and resolution UI. |
| SEC-07 | User-supplied links are HTML-escaped but not URI-scheme allowlisted. | Stored `javascript:` URLs can execute when clicked in the same page context. | Validate URLs server and client to `https:`/`http:` (and document any alternatives); retain `noopener noreferrer`. |
| SEC-08 | CSP permits inline scripts/styles, while the UI uses many inline `onclick` handlers. | Raises XSS blast radius and prevents a strict CSP. | Move to delegated event listeners/components; use nonce/hash-based CSP and security headers at the host/API. |
| SEC-09 | Shared Google Sheet uses email-prefix sheet names. | Prefix collisions can route data to the wrong sheet; no organization boundary. | Eliminate as data store; integration resource IDs must be server-owned and tenant-scoped. |
| SEC-10 | No server validation, request limits, observability, audit, abuse protection, CSRF model, security headers at deployment, or secret scan/CI. | Commercial security and incident response controls are absent. | Add API validation, structured logging, correlation IDs, rate limits, headers, secret management, dependency and SAST checks. |

### Existing positive controls and limitations

The app normalizes imported task/record fields and limits array sizes, escapes many displayed values, uses `rel="noopener"` for task links, configures a restrictive baseline CSP, checks Apps Script input shapes, and tests basic modal accessibility attributes. These are useful safeguards for a local app, but none establishes an authentication, authorization, or tenant boundary.

## E. Production gaps and technical debt

- A single `app.js` combines storage, domain logic, rendering, client state, sync transport, accessibility behavior, import/export, localization, and PWA bootstrapping.
- There are no TypeScript types, module boundaries, package build/lint process, component tests, database migrations, or API contracts.
- User-facing text is mostly hard-coded English; only a subset of labels is in the translation map.
- Task/project identity is generated from timestamp/random client values; IDs and record timestamps are neither authoritative nor concurrency-safe.
- The service worker caches every successful GET indefinitely under a manually bumped cache name and does not distinguish navigation, static assets, external assets, API responses, or failed updates.
- The XLSX export depends on a CDN at runtime, so offline export can fail.
- The Apps Script integration uses destructive sheet replacement and returns raw error messages.
- No current evidence exists for mobile breakpoints, keyboard-only task workflows, screen-reader journeys, performance budgets, backup restore drills, audit integrity, or browser compatibility.

## F. Recommended target architecture

Adopt a modular monorepo only if it reduces operational complexity; separate deployable frontend/API/database concerns regardless of repository layout.

```text
apps/
  web/                 TypeScript component frontend (migration can begin behind API adapters)
  api/                 ASP.NET Core Web API
src/
  TaskFlow.Domain/     entities, permission constants, domain rules
  TaskFlow.Application/ use cases, DTOs, validators, authorization requirements
  TaskFlow.Infrastructure/ EF Core/PostgreSQL, identity, email, storage, integrations
  TaskFlow.Api/        thin endpoints, auth, middleware, OpenAPI, health checks
tests/
  unit/ integration/ e2e/ security/
deploy/
  Dockerfiles, compose, environment examples, CI workflows
```

**Recommended choices:** ASP.NET Core LTS, PostgreSQL, EF Core migrations, ASP.NET Core Identity or equivalent vetted identity layer, opaque secure refresh-token/session records (or short-lived signed access tokens plus rotation), an email-provider abstraction, object storage only when attachments enter scope, and a background worker for reminders/email/integration jobs. The final choice should be confirmed by deployment constraints before code generation.

### Authorization model

Roles (Owner, Admin, Manager, Member, Viewer) map centrally to named permissions. Endpoint and application-service authorization must check an active organization membership and permission before loading or mutating any record. Project membership may narrow access further; it must never widen organization access. Frontend route guards only improve UX.

### Offline and conflict model

Use IndexedDB only as a client cache and durable outbound operation queue. Each write includes a record version and idempotency key. The API returns a conflict on mismatched versions; the client refreshes and offers field-aware resolution rather than overwriting. Acknowledged operations update cache only after server confirmation.

## G. Migration strategy

1. **Protect existing users first:** ship the current JSON export as a documented backup path; do not delete existing browser records or repurpose their keys.
2. **Foundation:** deploy API/database, environments, migrations, health checks, structured logs, identity, organization/membership/role/permission model, audit log, and integration test harness.
3. **Authenticated onboarding:** registration creates user + organization + owner membership. Add login, verification, invitations, password reset, session management, and organization setup.
4. **Core parity:** move Projects, Tasks, Subtasks, Tags, Dependencies and Comments behind API endpoints. Retain the existing UI behind a client repository adapter initially to minimize visual regressions.
5. **Explicit data import:** after authenticated organization selection, parse existing JSON export in a preview; map/validate records, record import audit entries, report rejected rows, and make the operation retry-safe. Never auto-import solely because local data exists.
6. **Secondary features:** migrate events, goals, habits, notes, time/Pomodoro, templates/filters, then notifications/report aggregation.
7. **Offline/PWA:** introduce versioned cached API reads and queued writes only after core API concurrency is tested.
8. **Google Sheets:** freeze its role as optional read/export integration, migrate credentials out of the browser, rotate existing shared tokens, and provide a documented sunset/migration path.

## H. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Existing data loss during migration | Medium | High | Export before migration, import preview, immutable original local data, backup/restore testing. |
| Feature regression from frontend rewrite | High | High | Start with API adapter and contract/E2E parity tests; migrate UI module by module. |
| Tenant isolation defect | Medium | Critical | Tenant-scoped query abstraction, integration tests for cross-tenant IDs, code review and security test gate. |
| Credential exposure through legacy Sheets token | High | High | Rotate token, remove URLs/query tokens, deprecate client credential entry early. |
| Scope inflation | High | High | Stage delivery and accept only tested vertical slices; defer attachments/billing/advanced integrations. |
| Offline conflict data loss | Medium | High | Establish ETag/version protocol before queue; test reconnect/conflict/idempotency cases. |

## I. Implementation roadmap

| Phase | Deliverable and acceptance evidence |
| --- | --- |
| 1 — Audit | This document and feature-parity matrix; baseline test result recorded. |
| 2 — Architecture | Approved ADRs, ERD, OpenAPI skeleton, threat model, deployment/environment design. |
| 3 — Backend foundation | API + PostgreSQL migrations + identity + organization/roles/permissions + tenant security integration tests + health/logging. |
| 4 — Core vertical slice | Project/task/subtask/comment/tag APIs; API-backed task UI; cross-tenant, viewer, concurrency and E2E tests. |
| 5 — Remaining parity | Goals, habits, notes, calendar, time, templates/filters, reporting, notifications and imports in prioritized slices. |
| 6 — PWA/integrations | IndexedDB queue, sync tests, server-side Google integration; legacy token rotation/removal. |
| 7 — Operational readiness | Docker, staging, CI/CD, backups/restore drill, monitoring, accessibility/performance suites, deployment runbook. |
| 8 — Commercial readiness | Marketing/legal pages reviewed by counsel, entitlement abstraction, support/runbook and final honest quality gate. |

## Verification performed for this audit

On 2026-09-14:

- `npm test` passed: syntax/DOM-reference validation plus **21** browser smoke checkpoints.
- `npm audit --omit=dev --json` reported **0** production dependency vulnerabilities.
- The smoke test runs the app from `file://`; it does not validate service-worker/PWA behavior, an HTTP deployment, Apps Script, production headers, a database, or any SaaS security property.

## Readiness decision

**Current commercialization readiness: 18/100.** The interface and baseline local workflow are demonstrably functional, but critical requirements for real authentication, authorization, tenant isolation, persistence, auditability, deployability, and security testing have not been implemented. The product must remain described as a local/browser PWA until the staged target architecture is built and verified.
