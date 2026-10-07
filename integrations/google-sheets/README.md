# Optional Google Sheets mirror

`AppsScript.gs` is the legacy, optional Google Sheets integration. The PWA and API do not require it. Configure `SPREADSHEET_ID` and `SYNC_TOKEN` in Apps Script Properties, deploy it as a web app, and enter the URL/token in the frontend settings. Never commit deployment credentials.

This mirror is separate from `/api/data`, not transactional, and is not the application source of truth. Push/pull is explicit. Pull can replace local task data after confirmation. Account exports are restricted to the currently signed-in user. Real Apps Script execution requires an authorized Google deployment and was not tested in this local audit.
