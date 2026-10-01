import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {completeVisionJson, setCloudConfig, setProviderOverride} from '../provider.mjs';
import {createServer} from '../server.mjs';

const schema={type:'object',properties:{sourceData:{type:'string'},notes:{type:'array'}},required:['sourceData','notes']};
const image='data:image/png;base64,'+'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
async function fakeVision() {
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/v1/chat/completions') { req.resume(); req.on('end',()=>{ const result={sourceData:'柱状图，单位为百分比；2000 年汽车 40%，公交 35%，自行车 25%；2020 年汽车 55%，公交 30%，自行车 15%。',notes:['请核对图片中的年份和数值。']}; res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]})); }); return; }
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return server;
}
test('vision provider sends a data URL and returns structured source data',async t=>{
  const providerServer=await fakeVision(); const base=`http://127.0.0.1:${providerServer.address().port}/v1`;
  t.after(()=>providerServer.close());
  const result=await completeVisionJson({kind:'compatible',url:base,model:'vision-test',apiKey:'synthetic'}, {schema,prompt:'extract',system:'test',imageData:image});
  assert.match(result.sourceData,/2000/);assert.match(result.sourceData,/2020/);
});
test('vision endpoint rejects invalid and oversized image payloads',async t=>{
  setCloudConfig({baseUrl:'http://127.0.0.1:1/v1',model:'vision-test',apiKey:'synthetic'});setProviderOverride('openai-compatible');
  const localAI={getStatus:async()=>({busy:false}),restore:async()=>{},getProviderConfig:()=>null,close:async()=>{}};
  const server=createServer({localAI,cloudStore:{load:async()=>null},status:async()=>({available:true,engine:'test'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.close();setCloudConfig(null);setProviderOverride('auto');});
  const base=`http://127.0.0.1:${server.address().port}`;const post=body=>fetch(`${base}/api/task1/image-to-text`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({imageData:'data:text/plain;base64,abc'})).status,400);
  assert.equal((await post({imageData:'data:image/png;base64,'+'A'.repeat(12*1024*1024)})).status,413);
});
