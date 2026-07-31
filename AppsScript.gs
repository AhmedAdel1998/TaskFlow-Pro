/**
 * Google Apps Script for TaskFlow Pro
 * ====================================
 *
 * Deployment:
 * 1. Create a Google Apps Script project.
 * 2. Add Script Properties:
 *    - SPREADSHEET_ID: target spreadsheet id
 *    - SYNC_TOKEN: a long random secret shared only with trusted users
 *    - ADMIN_EMAILS: comma-separated admin email addresses, optional
 * 3. Deploy as Web App. "Anyone" access is acceptable only because every
 *    request is checked against SYNC_TOKEN before spreadsheet access.
 */

const DEFAULT_HEADERS = ['ID', 'Title', 'Status', 'Priority', 'Category', 'Due Date', 'Tags', 'Created', 'Project', 'Milestone', 'Owner', 'Updated'];
const FULL_HEADERS = ['ID','Title','Status','Priority','Category','Due Date','Tags','Progress','Est. Hours','Logged Hours','Created','Completed','Description','Note','Owner','Updated'];

function jsonOut(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  const syncToken = props.getProperty('SYNC_TOKEN');
  const adminEmails = (props.getProperty('ADMIN_EMAILS') || '')
    .split(',')
    .map(function(email) { return email.trim().toLowerCase(); })
    .filter(Boolean);
  if (!spreadsheetId) throw new Error('Missing Script Property: SPREADSHEET_ID');
  if (!syncToken) throw new Error('Missing Script Property: SYNC_TOKEN');
  return { spreadsheetId: spreadsheetId, syncToken: syncToken, adminEmails: adminEmails };
}

function assertAuthorized(token) {
  const cfg = getConfig();
  if (!token || String(token) !== cfg.syncToken) throw new Error('Unauthorized');
  return cfg;
}

function assertAdmin(email, cfg) {
  if (!cfg.adminEmails.length) throw new Error('ADMIN_EMAILS is required for SYNC_ALL_USERS');
  if (cfg.adminEmails.indexOf(String(email || '').toLowerCase()) === -1) throw new Error('Admin authorization required');
}

function safeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Invalid user email');
  return value;
}

function safeSheetName(name) {
  const cleaned = String(name || 'unknown').replace(/[\\/*?:[\]]/g, '').trim().slice(0, 31);
  return cleaned || 'unknown';
}

function sheetNameForUser(email) {
  return safeSheetName(safeEmail(email).split('@')[0]);
}

function ensureSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function replaceSheetRows(ss, sheetName, rows) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) throw new Error('Invalid rows payload');
  if (rows.length > 5000) throw new Error('Too many rows');
  if (rows[0].length > 30) throw new Error('Too many columns');
  const sheet = ensureSheet(ss, safeSheetName(sheetName), rows[0]);
  sheet.clear();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  for (let c = 1; c <= rows[0].length; c++) sheet.autoResizeColumn(c);
}

function taskRow(data) {
  return [
    data.numId || '',
    String(data.title || '').slice(0, 200),
    ['todo','in-progress','done'].indexOf(data.status) > -1 ? data.status : 'todo',
    ['low','medium','high'].indexOf(data.priority) > -1 ? data.priority : 'medium',
    String(data.category || '').slice(0, 50),
    String(data.due || '').slice(0, 20),
    String(data.tags || '').slice(0, 300),
    String(data.created || '').slice(0, 40),
    String(data.project || '').slice(0, 80),
    data.milestone === 'yes' ? 'yes' : 'no',
    String(data.assignee || '').slice(0, 120),
    String(data.updatedAt || '').slice(0, 40)
  ];
}

function doPost(e) {
  try {
    const data = JSON.parse((e.postData && e.postData.contents) || '{}');
    const cfg = assertAuthorized(data.authToken);
    const action = data.action;
    const ss = SpreadsheetApp.openById(cfg.spreadsheetId);

    if (action === 'SYNC_ALL_USERS') {
      assertAdmin(data.user, cfg);
      const sheets = data.sheets || {};
      Object.keys(sheets).forEach(function(sheetName) {
        replaceSheetRows(ss, sheetName, sheets[sheetName]);
      });
      return jsonOut({ status: 'ok', message: 'All users synced' });
    }

    if (action === 'SYNC_PUSH') {
      safeEmail(data.user);
      replaceSheetRows(ss, data.sheetName || sheetNameForUser(data.user), data.rows);
      return jsonOut({ status: 'ok' });
    }

    if (action === 'ADD' || action === 'UPDATE') {
      const sheet = ensureSheet(ss, sheetNameForUser(data.user), DEFAULT_HEADERS);
      const rowData = taskRow(data);

      if (action === 'UPDATE') {
        const values = sheet.getDataRange().getValues();
        for (let i = 1; i < values.length; i++) {
          if (String(values[i][0]) === String(data.numId)) {
            sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
            return jsonOut({ status: 'ok' });
          }
        }
      }
      sheet.appendRow(rowData);
      return jsonOut({ status: 'ok' });
    }

    if (action === 'DELETE') {
      const sheet = ss.getSheetByName(sheetNameForUser(data.user));
      if (sheet) {
        const values = sheet.getDataRange().getValues();
        for (let i = values.length - 1; i >= 1; i--) {
          if (String(values[i][0]) === String(data.numId || data.id)) {
            sheet.deleteRow(i + 1);
            break;
          }
        }
      }
      return jsonOut({ status: 'ok' });
    }

    return jsonOut({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return jsonOut({ status: 'error', message: String(err.message || err) });
  }
}

function doGet(e) {
  try {
    const cfg = assertAuthorized(e.parameter.authToken);
    const action = e.parameter.action;
    const ss = SpreadsheetApp.openById(cfg.spreadsheetId);

    if (action === 'PING') {
      return jsonOut({ status: 'ok', message: 'ready' });
    }

    if (action === 'SYNC_PULL') {
      const sheet = ss.getSheetByName(sheetNameForUser(e.parameter.user));
      if (!sheet) return jsonOut({ tasks: [] });

      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) return jsonOut({ tasks: [] });

      const headers = data[0];
      const tasks = [];
      for (let i = 1; i < data.length; i++) {
        const row = {};
        for (let j = 0; j < headers.length; j++) row[headers[j]] = data[i][j];
        tasks.push({
          numId: row['ID'] || i,
          title: row['Title'] || '',
          status: row['Status'] || 'todo',
          priority: row['Priority'] || 'medium',
          category: row['Category'] || '',
          due: row['Due Date'] || '',
          tags: row['Tags'] || '',
          created: row['Created'] || new Date().toISOString(),
          project: row['Project'] || '',
          milestone: row['Milestone'] || 'no',
          assignee: row['Owner'] || '',
          updatedAt: row['Updated'] || '',
          id: 't' + Date.now() + i
        });
      }
      return jsonOut({ tasks: tasks });
    }

    return jsonOut({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return jsonOut({ status: 'error', message: String(err.message || err) });
  }
}
