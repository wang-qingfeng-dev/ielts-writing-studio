import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { completeJson, getProviderStatus, getProviderOverride, setProviderOverride, resolveProvider, ProviderError } from '../provider.mjs';
import { analyzeWriting } from '../server.mjs';
import { DEMO_PROMPT, DEMO_ESSAY, DEMO_ANALYSIS } from '../public/demo.js';

function configure(t, values) {
  values = { OLLAMA_MODEL: undefined, OPENAI_MODEL: undefined, ...values };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const previousOverride = getProviderOverride();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  setProviderOverride(values.AI_PROVIDER === 'openai' ? 'openai-compatible' : values.AI_PROVIDER || 'auto');
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    setProviderOverride(previousOverride);
  });
}

async function fakeOllama(t) {
  const state = { models: ['qwen2.5:7b'], requests: [] };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: state.models.map(name => ({ name })) }));
      return;
    }
    if (req.url !== '/api/chat' || req.method !== 'POST') {
      res.writeHead(404); res.end('{}'); return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    state.requests.push(body);
    const isCorrection = Boolean(body.format.properties.corrected);
    const data = isCorrection
      ? { originalScore: DEMO_ANALYSIS.originalScore, corrected: DEMO_ANALYSIS.corrected, issues: DEMO_ANALYSIS.issues, priorities: DEMO_ANALYSIS.priorities, expressions: DEMO_ANALYSIS.expressions.filter(item => item.source === 'corrected') }
      : { model: DEMO_ANALYSIS.model, expressions: DEMO_ANALYSIS.expressions.filter(item => item.source === 'model') };
    res.end(JSON.stringify({ message: { content: JSON.stringify(data) } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { state, url: `http://127.0.0.1:${server.address().port}` };
}

test('OpenAI-compatible provider keeps the API key server-side and parses JSON content', async () => {
  const previous = { AI_PROVIDER:process.env.AI_PROVIDER, AI_BASE_URL:process.env.AI_BASE_URL, AI_API_KEY:process.env.AI_API_KEY, AI_MODEL:process.env.AI_MODEL };
  const originalFetch = globalThis.fetch;
  let request;
  process.env.AI_PROVIDER='openai-compatible'; process.env.AI_BASE_URL='https://example.invalid/v1'; process.env.AI_API_KEY='test-secret'; process.env.AI_MODEL='free-model';
  globalThis.fetch = async (url, options) => { request={url,options}; return new Response(JSON.stringify({choices:[{message:{content:'```json\n{"ok":true}\n```'}}]}),{status:200,headers:{'content-type':'application/json'}}); };
  try {
    const schema = {type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false};
    const result = await completeJson({kind:'compatible',url:'https://example.invalid/v1',model:'free-model'},{system:'system',prompt:'prompt',schema,signal:undefined});
    assert.deepEqual(result,{ok:true});
    assert.equal(request.url,'https://example.invalid/v1/chat/completions');
    const body=JSON.parse(request.options.body);
    assert.equal(body.model,'free-model');
    assert.equal(request.options.headers.Authorization,'Bearer test-secret');
    assert(body.messages[0].content.includes(JSON.stringify(schema)), 'JSON mode must receive the actual schema, not just its name');
    assert(!body.messages[0].content.includes('test-secret'));
    assert.equal(body.messages[1].content,'prompt');
  } finally {
    globalThis.fetch=originalFetch;
    for(const [key,value] of Object.entries(previous)){ if(value===undefined)delete process.env[key]; else process.env[key]=value; }
  }
});

test('Ollama provider status times out quickly when local service is unavailable', async () => {
  const previous = { AI_PROVIDER:process.env.AI_PROVIDER, OLLAMA_HOST:process.env.OLLAMA_HOST, AI_MODEL:process.env.AI_MODEL };
  process.env.AI_PROVIDER='ollama'; process.env.OLLAMA_HOST='http://127.0.0.1:1'; process.env.AI_MODEL='qwen2.5:7b';
  try {
    const started=Date.now(); const status=await getProviderStatus();
    assert.equal(status.available,false); assert.equal(status.provider,'ollama'); assert.ok(Date.now()-started<5000);
  } finally { for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;} }
});

test('switches Ollama to Codex and back while preserving accurate model availability', async t => {
  const { state, url } = await fakeOllama(t);
  configure(t, { AI_PROVIDER: 'auto', OLLAMA_HOST: url, AI_MODEL: 'qwen2.5:7b', AI_BASE_URL: undefined });
  setProviderOverride('ollama');
  let status = await getProviderStatus();
  assert.equal(status.provider, 'ollama'); assert.equal(status.selected, 'ollama'); assert.equal(status.available, true);
  setProviderOverride('codex');
  status = await getProviderStatus();
  assert.equal(status.provider, 'codex'); assert.equal(status.selected, 'codex');
  setProviderOverride('ollama');
  for (const models of [[], ['qwen2.5:3b'], ['qwen2.5:latest']]) {
    state.models = models;
    status = await getProviderStatus();
    assert.equal(status.provider, 'ollama'); assert.equal(status.selected, 'ollama'); assert.equal(status.available, false, JSON.stringify(models));
  }
  state.models = ['qwen2.5:3b', 'qwen2.5:7b'];
  assert.equal((await getProviderStatus()).available, true);
  process.env.AI_MODEL = 'qwen2.5';
  state.models = ['qwen2.5:latest'];
  assert.equal((await getProviderStatus()).available, true, 'an omitted tag means latest');
  state.models = ['qwen2.5:7b'];
  assert.equal((await getProviderStatus()).available, false, 'an explicit size does not satisfy latest');
});

test('real HTTP Ollama analysis completes both jobs and isolates the model essay context', async t => {
  const { state, url } = await fakeOllama(t);
  configure(t, { AI_PROVIDER: 'ollama', OLLAMA_HOST: url, AI_MODEL: 'qwen2.5:7b' });
  const result = await analyzeWriting({ prompt: DEMO_PROMPT, essay: DEMO_ESSAY, targetBand: 7 });
  assert.deepEqual(result.corrected, DEMO_ANALYSIS.corrected);
  assert.deepEqual(result.model, DEMO_ANALYSIS.model);
  assert.deepEqual(result.issues, DEMO_ANALYSIS.issues);
  assert.equal(state.requests.length, 2, 'both jobs should pass their first validation');
  const correction = state.requests.find(body => body.format.properties.corrected);
  const model = state.requests.find(body => body.format.properties.model);
  for (const request of state.requests) {
    assert.equal(request.model, 'qwen2.5:7b');
    assert.equal(request.stream, false);
    assert.equal(request.messages[0].role, 'system');
  }
  const correctionData = JSON.parse(correction.messages[1].content.split('\n').at(-1));
  const modelData = JSON.parse(model.messages[1].content.split('\n').at(-1));
  assert.equal(correctionData.studentEssay, DEMO_ESSAY);
  assert.deepEqual(modelData, { taskPrompt: DEMO_PROMPT, targetBand: 7 });
  assert(!model.messages[1].content.includes(JSON.stringify(DEMO_ESSAY)));
});

test('an already cancelled analysis sends no request to Ollama', async t => {
  const { state, url } = await fakeOllama(t);
  configure(t, { AI_PROVIDER: 'ollama', OLLAMA_HOST: url, AI_MODEL: 'qwen2.5:7b' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(analyzeWriting({ prompt: DEMO_PROMPT, essay: DEMO_ESSAY, targetBand: 7 }, { signal: controller.signal }), error => error.status === 499);
  assert.equal(state.requests.length, 0);
});

test('auto does not silently use a Codex account when Ollama and compatible configuration are absent', async t => {
  configure(t, { AI_PROVIDER: 'auto', OLLAMA_HOST: 'http://127.0.0.1:1', AI_MODEL: undefined, AI_BASE_URL: undefined });
  const provider = await resolveProvider();
  assert.equal(provider.kind, 'ollama');
  assert.equal(provider.model, 'qwen2.5:7b');
  const status = await getProviderStatus();
  assert.equal(status.available, false);
  assert.equal(status.provider, 'ollama');
  assert.equal(status.selected, 'auto');
  setProviderOverride('codex');
  assert.equal((await resolveProvider()).kind, 'codex', 'Codex remains available by explicit selection');
});

test('compatible configuration errors stay actionable and preserve the selected mode', async t => {
  configure(t, { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: undefined, AI_MODEL: undefined });
  let status = await getProviderStatus();
  assert.equal(status.available, false);
  assert.equal(status.selected, 'openai-compatible');
  assert.match(status.message, /AI_BASE_URL/);
  process.env.AI_BASE_URL = 'https://example.invalid/v1';
  status = await getProviderStatus();
  assert.equal(status.available, false);
  assert.match(status.message, /AI_MODEL/);
  process.env.AI_MODEL = 'free-model';
  for (const invalid of ['file:///private/config', 'https://user:secret@example.invalid/v1', 'https://example.invalid/v1?key=secret']) {
    process.env.AI_BASE_URL = invalid;
    status = await getProviderStatus();
    assert.equal(status.available, false);
    assert.match(status.message, /AI_BASE_URL/);
    assert(!status.message.includes('secret'));
  }
  process.env.AI_BASE_URL = 'https://example.invalid/v1/';
  assert.deepEqual(await resolveProvider(), {kind:'compatible', name:'OpenAI 兼容接口', model:'free-model', url:'https://example.invalid/v1'});
});

test('switching between local and compatible providers uses each provider model with legacy fallback', async t => {
  configure(t, {
    AI_PROVIDER:'ollama', OLLAMA_HOST:'http://127.0.0.1:11434', AI_BASE_URL:'https://example.invalid/v1',
    OLLAMA_MODEL:'qwen2.5:3b', OPENAI_MODEL:'cloud-model', AI_MODEL:'legacy-model'
  });
  assert.equal((await resolveProvider()).model, 'qwen2.5:3b');
  setProviderOverride('openai-compatible');
  assert.equal((await resolveProvider()).model, 'cloud-model');
  setProviderOverride('codex');
  assert.equal((await resolveProvider()).kind, 'codex');
  setProviderOverride('ollama');
  assert.equal((await resolveProvider()).model, 'qwen2.5:3b');
  delete process.env.OLLAMA_MODEL;
  assert.equal((await resolveProvider()).model, 'legacy-model');
  setProviderOverride('openai-compatible');
  delete process.env.OPENAI_MODEL;
  assert.equal((await resolveProvider()).model, 'legacy-model');
});

test('startup status reflects the configured environment and rejects misspelled providers', async t => {
  configure(t, { AI_PROVIDER: 'openai', AI_BASE_URL: 'https://example.invalid/v1', AI_MODEL: 'free-model' });
  const fresh = await import('../provider.mjs?environment-selection');
  assert.equal(fresh.getProviderOverride(), 'openai-compatible');
  assert.equal((await fresh.getProviderStatus()).selected, 'openai-compatible');
  process.env.AI_PROVIDER = 'ollamma';
  await assert.rejects(fresh.resolveProvider(), error => error.status === 503 && /AI_PROVIDER/.test(error.message));
});

test('compatible provider retries unsupported JSON mode with the schema intact', async t => {
  configure(t, { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'https://example.invalid/v1', AI_MODEL: 'free-model', AI_API_KEY: undefined });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1
      ? new Response('{}', {status:400})
      : new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}), {status:200});
  };
  const schema = {type:'object',properties:{ok:{type:'boolean'}},required:['ok']};
  const result = await completeJson(await resolveProvider(), {system:'Return JSON.',prompt:'Essay input',schema});
  assert.deepEqual(result, {ok:true});
  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format.type, 'json_object');
  assert.equal(requests[1].response_format, undefined);
  for (const request of requests) assert(request.messages[0].content.includes(JSON.stringify(schema)));
});

test('invalid provider JSON produces a safe 502 for validation retries', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const content of ['Here is {broken-json} with private-provider-details', 'no result']) {
    globalThis.fetch = async () => new Response(JSON.stringify({message:{content}}), {status:200});
    await assert.rejects(
      completeJson({kind:'ollama',url:'http://127.0.0.1:11434',model:'test'}, {system:'system',prompt:'prompt',schema:{type:'object'}}),
      error => error instanceof ProviderError && error.status === 502 && !error.message.includes('private-provider-details')
    );
  }
});

test('cancelling an in-flight provider request aborts the transport without retrying', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const controller = new AbortController();
  let calls = 0, capturedSignal;
  globalThis.fetch = async (_url, {signal}) => {
    calls += 1;
    capturedSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), {once:true}));
  };
  const job = completeJson({kind:'compatible',url:'https://example.invalid/v1',model:'test'}, {system:'system',prompt:'prompt',schema:{type:'object'},signal:controller.signal});
  controller.abort();
  await assert.rejects(job, error => error instanceof ProviderError && error.status === 499);
  assert.equal(capturedSignal.aborted, true);
  assert.equal(calls, 1);
});
