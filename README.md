# TaskFlow Pro

Task, habit, and time-management PWA with an independent ASP.NET Core 9 / EF Core / SQLite API.

## Projects

```text
frontend/                 Vanilla JavaScript PWA, assets, npm scripts and browser tests
backend/
  TaskFlow.sln
  src/TaskFlow.Domain/
  src/TaskFlow.Application/
  src/TaskFlow.Infrastructure/   SQLite migrations, services, reminder worker
  src/TaskFlow.Api/
  tests/TaskFlow.IntegrationTests/
  Dockerfile
  railway.json
integrations/google-sheets/     Optional AppsScript.gs mirror
.github/workflows/             CI and GitHub Pages staging
 docs/                         Shared guides and verification evidence
```

- [Frontend installation, configuration, testing, and deployment](frontend/README.md)
- [Backend installation, configuration, testing, and deployment](backend/README.md)
- [User guide](docs/user-guide.md)
- [Feature verification matrix and remaining checks](docs/verification-matrix.md)
- [Test evidence and defects fixed](docs/test-evidence.md)
- [Optional Google Sheets integration](integrations/google-sheets/README.md)

## Local development

In one terminal:

```powershell
cd backend
dotnet run --project src/TaskFlow.Api --launch-profile http
```

In another:

```powershell
cd frontend
npm ci
npm start
```

Open `http://127.0.0.1:8000/`. The API default is `http://localhost:5299`, configured in `frontend/config.js`. Production is never selected by the checked-in default or tests. An existing browser URL override still takes precedence; clear `localStorage.taskflow_api_url` if needed. Preserve existing databases by configuring their absolute path before starting the relocated backend.

## Actual architecture

The frontend reads and writes account-scoped browser data, queues changes, and synchronizes through authenticated `/api/data` HTTP endpoints. The reminder worker reads those same per-user JSON sections. Pending changes survive network/server failures and login hydration. Version-aware writes detect conflicting section edits; the user can back up and explicitly resolve a conflict in Settings.

The structured `/api/tasks`, `/api/projects`, subtask/comment/tag APIs use organization-scoped tables. They are a separate model and are not mirrored into the PWA store. Do not create a structured API task expecting it to appear in the PWA or produce a PWA reminder. Changing that contract would require an explicit migration; this separation preserves existing database compatibility.

Registration creates a user, organization, and Owner membership. Access JWTs expire after 15 minutes; refresh tokens rotate and can be revoked on logout. Existing access tokens expire naturally after logout. MFA, invitations, password reset, email verification, and fine-grained roles remain outside the implemented product.

## Testing

```powershell
dotnet test backend/TaskFlow.sln
npm --prefix frontend test
dotnet publish backend/src/TaskFlow.Api -c Release -o backend/artifacts/publish
node backend/tests/runtime-check.js
```

Browser tests use an isolated local API/database and real Chrome/Edge on Windows. Unit tests mock network races; backend reminder tests mock external push transport. Tests cover both HTTP root/subpath configuration and offline PWA loading; neither browser smoke checks nor API tests prove every device or feature permutation. Read the verification matrix for exact scope.

## Deployment

GitHub Pages stages only frontend assets and generates public API configuration from repository variable `TASKFLOW_API_URL`. Both test jobs must pass before Pages publishing. Railway needs Root Directory `/backend`, config `/backend/railway.json`, a `/data` persistent volume, a private JWT key, explicit frontend CORS origins, and optional VAPID secrets. Railway's own deployment trigger is independent of Pages CI.

No remote environment, deployment, production data, or repository history was changed by the local audit. Published environments have not been reverified. Docker execution requires a running Docker engine.

## Verification limits

English/Arabic dictionaries and RTL exist, but hard-coded dynamic English strings remain; the old claim of complete translation coverage was too broad. JSON backups cover five documented sections, not every synced key. Excel depends on an external CDN. Daily digests and alarm snooze require the app to be running. Real push permission, installation prompts, device sounds, expired provider subscriptions, and hosting persistence need the manual checks listed in the matrix.

Historical `docs/phase-1-audit.md` and `docs/feature-parity-matrix.md` describe an earlier architecture and are retained as historical records. Current setup and evidence are in the linked project READMEs and verification documents.
