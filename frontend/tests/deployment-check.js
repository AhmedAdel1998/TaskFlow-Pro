const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const frontend=path.join(root,'frontend');
const backend=path.join(root,'backend');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'taskflow-stage-'));
try{
  const env={...process.env,TASKFLOW_API_URL:'https://api.example.test'};
  execFileSync(process.execPath,[path.join(frontend,'stage.js'),directory],{env});
  const files=fs.readdirSync(directory);
  assert.equal(files.length,8);
  const html=fs.readFileSync(path.join(directory,'index.html'),'utf8');
  for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
    if(/^https?:/.test(match[1]))continue;
    assert.ok(fs.existsSync(path.join(directory,match[1].split('?')[0])),match[1]);
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
  assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./index.html');
  for(const icon of manifest.icons)assert.ok(fs.existsSync(path.join(directory,icon.src)));
  const config=fs.readFileSync(path.join(directory,'config.js'),'utf8');assert.match(config,/https:\/\/api.example.test/);
  const railway=JSON.parse(fs.readFileSync(path.join(backend,'railway.json')));
  assert.ok(fs.existsSync(path.join(backend,railway.build.dockerfilePath)));
  assert.equal(railway.deploy.healthcheckPath,'/health/ready');
  const dockerfile=fs.readFileSync(path.join(backend,'Dockerfile'),'utf8');
  for(const match of dockerfile.matchAll(/^COPY (src\/\S+)/gm))assert.ok(fs.existsSync(path.join(backend,match[1])),match[1]);
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/deploy.yml'),'utf8');
  assert.match(workflow,/working-directory: frontend/);assert.match(workflow,/node frontend\/stage.js site/);assert.match(workflow,/dotnet test backend\/tests\//);
  console.log('PASS static artifact (8 files), relative assets/manifest, API configuration, Docker context, Railway readiness, CI paths');
}finally{
  const resolved=path.resolve(directory);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('taskflow-stage-'));
  fs.rmSync(resolved,{recursive:true,force:true});
}
