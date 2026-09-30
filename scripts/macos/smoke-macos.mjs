import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

assert.equal(process.platform,'darwin');
const output=path.resolve('release-artifacts');
const zip=(await readdir(output)).find(name=>name.endsWith(`macos-${process.arch}.zip`));assert(zip);
const directory=await mkdtemp(path.join(os.tmpdir(),'句进 Mac smoke '));
execFileSync('/usr/bin/ditto',['-x','-k',path.join(output,zip),directory]);
const root=path.join(directory,zip.replace(/\.zip$/,''));
const launcher=path.join(root,'Start Writing Studio.command');
assert((await stat(launcher)).mode & 0o111,'ZIP must preserve launcher executable permission');
const manifest=JSON.parse(await readFile(path.join(root,'MAC-MANIFEST.json'),'utf8'));
const child=spawn(launcher,['--no-browser'],{cwd:root,env:{...process.env,PORT:'4397',AI_PROVIDER:'openai-compatible'},stdio:['ignore','pipe','pipe']});
let error='';child.stderr.on('data',data=>error+=data);child.stdout.resume();
let exited;const done=new Promise(resolve=>child.once('exit',code=>{exited=code;resolve(code);}));
try{
  let info;
  for(let i=0;i<100;i++){
    try{info=await (await fetch('http://127.0.0.1:4397/api/app-info',{signal:AbortSignal.timeout(500)})).json();break;}catch{}
    assert.equal(exited,undefined,error);await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(info?.version,manifest.version);
  const page=await (await fetch('http://127.0.0.1:4397/')).text();assert(page.includes('task1-academic'));
  const settings=await (await fetch('http://127.0.0.1:4397/api/cloud-settings')).json();assert(settings.providers.some(p=>p.id==='doubao'));
  const local=await (await fetch('http://127.0.0.1:4397/api/local-ai/status')).json();assert.equal(local.supported,false);
  console.log(`PASS macOS ${process.arch}: extracted package, executable launcher, bundled Node, HTTP, Task 1, online settings, unsupported auto-install boundary`);
}finally{child.kill('SIGTERM');await done;}
assert.equal(exited,0,error);
await assert.rejects(fetch('http://127.0.0.1:4397/api/app-info',{signal:AbortSignal.timeout(500)}));
