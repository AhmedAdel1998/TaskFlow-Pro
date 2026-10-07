const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const allowed=new Set(['index.html','app.js','config.js','styles.css','sw.js','manifest.json','icon-192.png','icon-512.png']);
http.createServer((req,res)=>{
  let name;
  try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/(TaskFlow-Pro\/)?/,'')||'index.html';}
  catch{res.writeHead(400).end();return;}
  if(!allowed.has(name)){res.writeHead(404).end();return;}
  fs.readFile(path.join(root,name),(error,data)=>{
    if(error){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(name)]);
    res.setHeader('Cache-Control','no-cache');res.end(data);
  });
}).listen(Number(process.env.PORT)||8000,'127.0.0.1',()=>console.log('TaskFlow frontend: http://127.0.0.1:'+(process.env.PORT||8000)+'/'));
