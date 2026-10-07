# TaskFlow Pro backend

Independent ASP.NET Core 9 API, Application, Infrastructure, and Domain projects with EF Core SQLite. The frontend is not copied into the API or required at runtime.

## Install, configure, run

Install the .NET 9 SDK. From this directory:

```powershell
dotnet restore TaskFlow.sln
dotnet build TaskFlow.sln
dotnet run --project src/TaskFlow.Api --launch-profile http
```

The development API listens on `http://localhost:5299`. Check `/health/live` and `/health/ready`. Startup applies the preserved SQLite migrations and enables WAL. Development configuration has an explicitly development-only JWT key; push is disabled until VAPID is configured.

**Existing data:** set `ConnectionStrings__TaskFlow` to the absolute path of your existing database before launching from the new directory. Relative SQLite paths depend on the working directory. The reorganization moved the old `src` tree intact; no database was reset or deleted. Back up the database with SQLite's backup mechanism before operational migration; do not copy only a live `.db` while ignoring its WAL.

Environment examples are in [.env.example](.env.example). .NET does not automatically load `.env`: set environment variables in your shell or hosting provider. In PowerShell use `$env:Jwt__Key='...'`. Production startup rejects missing/short JWT keys and the known development placeholder.

## Test

```powershell
dotnet test TaskFlow.sln --logger "trx;LogFileName=backend.trx"
dotnet publish src/TaskFlow.Api -c Release -o artifacts/publish
```

Tests use isolated temporary SQLite databases, migrations, and the real HTTP pipeline. Push transport is mocked in reminder tests; real browser delivery is not implied. The frontend integration suite additionally runs the API as a separate local process.

## Docker and Railway

Build context is **this `backend/` directory**:

```powershell
docker build -t taskflow-api .
docker run --rm -p 8080:8080 --env-file .env -v taskflow-data:/data taskflow-api
```

Use a generated secret JWT key (32+ characters), `ConnectionStrings__TaskFlow=Data Source=/data/taskflow.db;Default Timeout=30`, `ASPNETCORE_HTTP_PORTS=8080`, and `Cors__Origins__0=https://your-frontend.example`. Mount the persistent volume at `/data`. Never store JWT/VAPID secrets in an image or repository.

For Railway configure service Root Directory `/backend`, config file `/backend/railway.json`, Dockerfile `Dockerfile`, and a persistent volume at `/data`. The API honors Railway's `PORT`. Readiness probes use `/health/ready`. Railway's repository-triggered deployment is independent of GitHub Pages' CI gating; do not assume a failed Pages job prevents an API deployment. This audit did not modify remote service settings or deploy.

The previously committed VAPID private key was removed. If it was ever used, rotate that key in the hosting provider and renew browser subscriptions. A git working-tree removal cannot revoke a previously exposed key or remove it from history.

## API and data boundaries

- `/api/auth/register`, `/login`, `/refresh`, `/logout`: username/password login, rotating refresh sessions, logout refresh revocation. Already-issued access JWTs expire after 15 minutes; logout does not instantly revoke them.
- `/api/data`: per-user PWA sections. PUT accepts `{value, expectedUpdatedAt, requireVersion:true}`; timestamps serve as optimistic concurrency versions. A stale write returns 409. Legacy clients omitting version checks retain last-write-wins behavior for compatibility.
- `/api/tasks`, `/api/projects`, subtasks, comments, tags: separate organization-scoped structured API. It has no automatic projection into `/api/data`; it is not the PWA source of truth. Structured task creation does not schedule PWA reminders. Do not mix the two models expecting automatic synchronization.
- Push subscriptions are per user. Endpoints are limited to supported browser push providers. Timed task/event/timetable reminders read `/api/data`. New clients include trigger UTC timestamps, so future DST changes are resolved when editing. Legacy records fall back to the stored subscription offset until re-saved.

Use one API replica with a persistent local SQLite volume. Multi-replica push dispatch is not coordinated, and shared network filesystems are not a supported SQLite deployment. A push accepted by its provider is not proof of device delivery. Retries occur within the five-minute reminder window; delivery after a longer outage is not guaranteed.

MFA, invitations, email verification, password reset, role-based policy beyond membership, and audit logs remain unimplemented. See the [verification matrix](../docs/verification-matrix.md) for evidence and limitations.
