const fs=require('node:fs');
const path=require('node:path');
const api=process.env.TASKFLOW_API_URL;
if(!api||new URL(api).protocol!=='https:')throw new Error('TASKFLOW_API_URL must be an explicit HTTPS API URL for deployment.');
const destination=path.resolve(process.argv[2]||'dist');
fs.mkdirSync(destination,{recursive:true});
for(const file of ['index.html','app.js','styles.css','sw.js','manifest.json','icon-192.png','icon-512.png'])fs.copyFileSync(path.join(__dirname,file),path.join(destination,file));
fs.writeFileSync(path.join(destination,'config.js'),'window.TASKFLOW_CONFIG = '+JSON.stringify({apiBaseUrl:api.replace(/\/$/,'')})+';\n');
console.log('Static artifact staged at '+destination);
