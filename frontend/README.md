# TaskFlow Pro frontend

Independent vanilla JavaScript PWA. Runtime files contain no dependency on backend source, .NET, or a shared filesystem. All account traffic uses HTTP APIs.

## Install and run

Requires Node.js 20+ for the development server/tests. Static hosting itself needs no Node installation.

```powershell
cd frontend
npm ci
npm start
```

Open `http://127.0.0.1:8000/` or `http://127.0.0.1:8000/TaskFlow-Pro/`. Start the API separately following [backend instructions](../backend/README.md).

`config.js` is public configuration, loaded before `app.js`. Set `window.TASKFLOW_CONFIG.apiBaseUrl` to the independently hosted API URL, without a trailing slash. The checked-in default is `http://localhost:5299`; local tests never select production. An existing `localStorage.taskflow_api_url` override takes precedence. Remove that override when changing `config.js`. No secrets belong here.

HTTP/HTTPS hosting is required for a realistic PWA test. Avoid `file://`. For a custom local API port, add its origin to the HTML CSP `connect-src` directive as well as configuring its URL. Backend CORS must allow the frontend origin. The development API allows loopback origins; production uses an explicit allowlist.

## Tests

```powershell
npm run test:syntax
npm run test:unit
npm run test:smoke
npm test
```

Syntax and unit tests run independently without .NET. The browser integration test requires the sibling backend checkout, .NET 9 SDK, and installed Chrome or Edge on Windows. It launches a disposable SQLite API on port 51789 and a temporary HTTP frontend, tests `/TaskFlow-Pro/`, and stops both processes. It does not use your development database. Mocked request-race tests and real API/browser tests are separately reported. See [verification matrix](../docs/verification-matrix.md).

## Deploy

Publish only `index.html`, `app.js`, `config.js`, `styles.css`, `sw.js`, `manifest.json`, and the two icons. Set the public API URL in the deployed `config.js`. Relative asset URLs, manifest start URL/scope, and service worker registration support both `/` and `/TaskFlow-Pro/`.

The root GitHub workflow stages only those files. Configure repository variable `TASKFLOW_API_URL` to an HTTPS API origin before publishing. The workflow refuses an empty/invalid URL. Bump the service-worker cache name and the versioned `app.js` URL together when changing the shell. No publishing was performed during this audit.

## Persistence and conflicts

The PWA uses `/api/data` as its server store. Task/project structured endpoints are a separate API model, not a second PWA store. Reminder scanning reads the same generic data as the PWA.

Data and pending queues are account-scoped. Pending edits survive HTTP errors and hydration. Version-checked writes return 409 when another device changed the same section; the local queue is retained. Use Settings → Resolve sync conflicts to save both versions and explicitly choose the local or server version. Conflicts are per section (for example the whole tasks array), not a collaborative per-field merge.

The former shared template key is retained but not automatically attributed to a user. Recover legacy templates only after confirming their owner. Browser-local storage is not encrypted and is not a security boundary against someone controlling the same browser profile; use separate OS/browser profiles for mutually untrusted users. Logging out removes cached authentication credentials; offline login after logout is unavailable until authenticating again.

JSON backups currently cover tasks, projects, goals, habits, and notes; calendar, archive, timetable, and preferences are synced but are not part of that JSON format. Excel requires the existing CDN library; an unavailable library produces an error message. Daily digests and snooze run only while the app is open. Real push/device behavior requires manual verification in the matrix.
