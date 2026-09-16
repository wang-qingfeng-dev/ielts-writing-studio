import test from 'node:test';
import assert from 'node:assert/strict';
import { completeJson, getProviderStatus } from '../provider.mjs';

test('OpenAI-compatible provider keeps the API key server-side and parses JSON content', async () => {
  const previous = { provider:process.env.AI_PROVIDER, url:process.env.AI_BASE_URL, key:process.env.AI_API_KEY, model:process.env.AI_MODEL };
  const originalFetch = globalThis.fetch;
  let request;
  process.env.AI_PROVIDER='openai-compatible'; process.env.AI_BASE_URL='https://example.invalid/v1'; process.env.AI_API_KEY='test-secret'; process.env.AI_MODEL='free-model';
  globalThis.fetch = async (url, options) => { request={url,options}; return new Response(JSON.stringify({choices:[{message:{content:'```json\n{"ok":true}\n```'}}]}),{status:200,headers:{'content-type':'application/json'}}); };
  try {
    const result = await completeJson({kind:'compatible',url:'https://example.invalid/v1',model:'free-model'},{system:'system',prompt:'prompt',schema:{type:'object'},signal:undefined});
    assert.deepEqual(result,{ok:true});
    assert.equal(request.url,'https://example.invalid/v1/chat/completions');
    const body=JSON.parse(request.options.body);
    assert.equal(body.model,'free-model');
    assert.equal(request.options.headers.Authorization,'Bearer test-secret');
    assert.equal(body.messages[1].content,'prompt');
  } finally {
    globalThis.fetch=originalFetch;
    for(const [key,value] of Object.entries(previous)){ if(value===undefined)delete process.env[key]; else process.env[key]=value; }
  }
});

test('Ollama provider status times out quickly when local service is unavailable', async () => {
  const previous = { provider:process.env.AI_PROVIDER, host:process.env.OLLAMA_HOST, model:process.env.AI_MODEL };
  process.env.AI_PROVIDER='ollama'; process.env.OLLAMA_HOST='http://127.0.0.1:1'; process.env.AI_MODEL='qwen2.5:7b';
  try {
    const started=Date.now(); const status=await getProviderStatus();
    assert.equal(status.available,false); assert.ok(Date.now()-started<5000);
  } finally { for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;} }
});
