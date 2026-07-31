const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);

scripts.forEach((script, index) => {
  try {
    new Function(script);
  } catch (err) {
    console.error(`Inline script ${index} syntax error: ${err.message}`);
    process.exitCode = 1;
  }
});

JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
new Function(appJs);
new Function(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'));
new Function(fs.readFileSync(path.join(root, 'AppsScript.gs'), 'utf8'));

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
const refs = new Set([...appJs.matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1]));
const dynamicIds = new Set(['taskDragList', 'burndownChart']);
const missingIds = [...refs].filter(id => !ids.has(id) && !dynamicIds.has(id));
if (missingIds.length) {
  console.error(`Missing DOM ids: ${missingIds.join(', ')}`);
  process.exitCode = 1;
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Syntax checks passed.');
