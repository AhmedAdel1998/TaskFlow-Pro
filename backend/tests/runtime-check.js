// Checks the published API as an independent process, including disk persistence across restart.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'taskflow-runtime-'));
const dll=path.resolve(__dirname,'../artifacts/publish/TaskFlow.Api.dll');
const base='http://127.0.0.1:51788';
const key=crypto.randomBytes(48).toString('base64');
let child,logs='';
async function start(){
  child=spawn(process.platform==='win32'?'C:/Program Files/dotnet/dotnet.exe':'dotnet',[dll],{
    cwd:temp,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(ConnectionStrings|Jwt|Vapid|ASPNETCORE|DOTNET_ENVIRONMENT|PORT|Cors|RateLimits)/i.test(key))),
      ASPNETCORE_ENVIRONMENT:'Production',ASPNETCORE_URLS:base,Jwt__Key:key,
      ConnectionStrings__TaskFlow:'Data Source='+path.join(temp,'test.db')+';Default Timeout=10',Cors__Origins__0:'http://127.0.0.1:8000'}
  });
  child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw new Error('API exited: '+logs);
    try{if((await fetch(base+'/health/ready')).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('API readiness timed out: '+logs);
}
async function stop(){if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}}
async function request(url,method,body,token){
  const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  assert.ok(response.ok,await response.clone().text());return response.status===204?null:response.json();
}
(async()=>{
  try{
    await start();
    const auth=await request('/api/auth/register','POST',{username:'restartuser',password:'password123',organizationName:'Restart'});
    await request('/api/data/taskflow_tasks_restartuser','PUT',{value:'[{"title":"Persistent"}]',requireVersion:true},auth.accessToken);
    await stop();await start();
    const login=await request('/api/auth/login','POST',{username:'restartuser',password:'password123'});
    assert.equal((await request('/api/data','GET',undefined,login.accessToken))[0].value,'[{"title":"Persistent"}]');
    console.log('PASS published Production API: migrate, register, write, restart, login, persistent read, readiness');
  }finally{
    await stop();
    // This directory is created exclusively by this test; never use configured user data paths.
    const resolved=path.resolve(temp);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('taskflow-runtime-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
