import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, mkdir, rm, readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createUpdater, releaseUpdate, isNewerVersion} from '../updater.mjs';
import {createServer} from '../server.mjs';

const bytes=Buffer.from('synthetic installer: must never execute');
function release(version='0.3.0') {
  const name=`ielts-writing-studio-v${version}-windows-x64-setup.exe`;
  return {tag_name:`v${version}`,draft:false,prerelease:false,assets:[{name,state:'uploaded',size:bytes.length,digest:`sha256:${createHash('sha256').update(bytes).digest('hex')}`,browser_download_url:`https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/download/v${version}/${name}`}]};
}
async function setup(t, options={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'jujin-update-test-'));
  const tempRoot=path.join(root,'downloads'); await mkdir(tempRoot);
  await writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.2.0'}));
  await writeFile(path.join(root,'INSTALLATION.json'),JSON.stringify({kind:'windows-installer'}));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const launches=[];
  const updater=createUpdater({root,tempRoot,platform:'win32',arch:'x64',fetchImpl:async url => url.includes('api.github.com')?Response.json(release()):new Response(bytes),launch:async data=>launches.push(data),...options});
  return {root,tempRoot,updater,launches};
}
test('version comparison is numeric and excludes previews/downgrades',()=>{
  assert(isNewerVersion('v0.10.0','0.2.0'));
  for(const next of ['0.2.0','0.1.9','0.3.0-preview','x','01.2.0']) assert.equal(isNewerVersion(next,'0.2.0'),false);
  assert.equal(releaseUpdate(release('0.1.2'),'0.2.0').available,false);
});
test('rejects substituted URLs, unknown hashes and unfinished releases',()=>{
  for(const mutate of [r=>r.assets[0].browser_download_url='https://evil.example/run.exe',r=>r.assets[0].digest=null,r=>r.assets[0].size=-1,r=>r.assets[0].state='new',r=>r.draft=true,r=>r.prerelease=true]){
    const data=release();mutate(data);assert.throws(()=>releaseUpdate(data,'0.2.0'));
  }
});
test('verified update is handed off once and preserves the target directory',async t=>{
  const {updater,root,launches}=await setup(t);
  assert.equal((await updater.check()).canInstall,true);
  assert.equal((await updater.install({port:4318})).version,'0.3.0');
  assert.equal(launches.length,1);assert.equal(launches[0].root,root);assert.equal(launches[0].port,4318);
  await assert.rejects(updater.install({port:4318}),/更新已在进行/);
});
test('hash mismatch and truncated downloads never launch, clean up, and allow retry',async t=>{
  for(const body of [Buffer.from('x'),Buffer.alloc(bytes.length,0),Buffer.alloc(bytes.length+1,0)]){
    const {updater,launches,tempRoot}=await setup(t,{fetchImpl:async url=>url.includes('api.github.com')?Response.json(release()):new Response(body)});
    await assert.rejects(updater.install({port:4318}),/校验失败|大小不一致/);
    await assert.rejects(updater.install({port:4318}),/校验失败|大小不一致/);
    assert.equal(launches.length,0);assert.deepEqual(await readdir(tempRoot),[]);
  }
});
test('source checkout, portable package and macOS cannot be overwritten',async t=>{
  const {updater,root,launches}=await setup(t);
  await mkdir(path.join(root,'.git'));
  assert.equal((await updater.check()).canInstall,false);
  await assert.rejects(updater.install({port:4318}),/仅支持/);assert.equal(launches.length,0);
  const portable=await setup(t);await rm(path.join(portable.root,'INSTALLATION.json'));
  await assert.rejects(portable.updater.install({port:4318}),/仅支持/);
  const mac=await setup(t,{platform:'darwin'});await assert.rejects(mac.updater.install({port:4318}),/仅支持/);
});
test('network failure gives a retryable message',async t=>{
  const {updater}=await setup(t,{fetchImpl:async()=>{throw Error('network');}});
  await assert.rejects(updater.check(),/无法连接 GitHub/);
});
test('update endpoint rejects cross-origin requests, arbitrary parameters and concurrent work',async t=>{
  let finishDownload, started=false;
  const server=createServer({
    cloudStore:{load:async()=>null},localAI:{restore:async()=>{},getProviderConfig:()=>null,getStatus:async()=>({busy:false}),close:async()=>{}},
    updater:{check:async()=>({available:true,asset:{private:'not exposed'}}),install:async()=>{started=true;await new Promise(resolve=>finishDownload=resolve);throw Error('simulated failure');}},shutdown:()=>assert.fail('failed update must not close app')
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body={},origin=base)=>fetch(base+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await (await fetch(base+'/api/updates')).json()).asset,undefined);
  assert.equal((await post('/api/updates/install',{},'https://evil.example')).status,403);
  assert.equal((await post('/api/updates/install',{url:'https://evil.example'})).status,400);
  const request=post('/api/updates/install');
  while(!started)await new Promise(r=>setTimeout(r,5));
  assert.equal((await post('/api/provider',{provider:'ollama'})).status,409);
  assert.equal((await post('/api/analyze')).status,409);
  assert.equal((await post('/api/updates/install')).status,409);
  finishDownload();assert.equal((await request).status,500);
  assert.equal((await post('/api/updates/install',{bad:true})).status,400);
});
