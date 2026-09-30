import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const port=Number(process.env.PORT||4318);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT 必须是 1–65535 的整数。');
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<9))throw new Error('需要 Node.js 22.9 或更新版本，请使用完整下载包。');
if(process.platform!=='darwin')throw new Error('此启动器仅适用于 macOS。');
const url=`http://127.0.0.1:${port}`;
const noBrowser=process.argv.includes('--no-browser');
const openBrowser=()=>{
  if(noBrowser)return;
  const opener=spawn('/usr/bin/open',[url],{stdio:'ignore'});
  opener.on('error',()=>console.log(`请在浏览器打开 ${url}`));
};
async function info(){try{return await (await fetch(`${url}/api/app-info`,{signal:AbortSignal.timeout(1000)})).json();}catch{return null;}}
const existing=await info();
if(existing){
  if(existing.app!=='ielts-writing-studio'||existing.version!==version)throw new Error('端口已有其他程序或旧版本，请关闭旧版后再打开。');
  console.log(`句进 ${version} 已运行：${url}`);openBrowser();
}else{
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:process.env,stdio:'inherit'});
  let stopping=false;
  const stop=()=>{if(!stopping){stopping=true;child.kill('SIGTERM');}};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('SIGHUP',stop);
  child.on('error',()=>{console.error('服务未能启动，请检查下载包是否完整。');process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=stopping?0:code??1;});
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    if(child.exitCode!==null||stopping)break;
    const current=await info();
    if(current?.app==='ielts-writing-studio'&&current.pid===child.pid){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(ready){console.log(`句进 ${version} 已就绪：${url}\n保留此终端窗口；关闭窗口或按 Control+C 可结束服务。`);openBrowser();}
  else if(!stopping){stop();console.error('服务启动失败，请检查端口占用后重试。');process.exitCode=1;}
}
