import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { completeJson, getProviderStatus, getProviderOverride, setProviderOverride, setCloudConfig, resolveProvider, ProviderError } from '../provider.mjs';
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
    const data = body.format.properties.paragraphs ? {paragraphs:DEMO_ANALYSIS.model.text.split('\n\n')} : body.format.properties.score ? {score:DEMO_ANALYSIS.model.score,notes:DEMO_ANALYSIS.model.notes,expressions:DEMO_ANALYSIS.expressions.filter(item=>item.source==='model')} : isCorrection
      ? { originalScore: DEMO_ANALYSIS.originalScore, corrected: DEMO_ANALYSIS.corrected, issues: DEMO_ANALYSIS.issues, priorities: DEMO_ANALYSIS.priorities, expressions: DEMO_ANALYSIS.expressions.filter(item => item.source === 'corrected') }
      : { model: DEMO_ANALYSIS.model, expressions: DEMO_ANALYSIS.expressions.filter(item => item.source === 'model') };
    res.end(JSON.stringify({ message: { content: JSON.stringify(data) } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { state, url: `http://127.0.0.1:${server.address().port}` };
}

async function serveJson(t, handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    await handler(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('OpenAI-compatible provider keeps the API key server-side and parses JSON content', async t => {
  let request;
  const base = await serveJson(t, (req, res, body) => {
    request = {url:req.url,headers:req.headers,body};
    res.end(JSON.stringify({choices:[{message:{content:'```json\n{"ok":true}\n```'}}]}));
  });
  configure(t, {AI_PROVIDER:'openai-compatible',AI_BASE_URL:`${base}/v1`,AI_API_KEY:'test-secret',AI_MODEL:'free-model'});
  const schema = {type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false};
  const result = await completeJson(await resolveProvider(), {system:'system',prompt:'prompt',schema});
  assert.deepEqual(result,{ok:true});
  assert.equal(request.url,'/v1/chat/completions');
  const body=request.body;
  assert.equal(body.model,'free-model');
  assert.equal(request.headers.authorization,'Bearer test-secret');
  assert(body.messages[0].content.includes(JSON.stringify(schema)), 'JSON mode must receive the actual schema, not just its name');
  assert(!body.messages[0].content.includes('test-secret'));
  assert.equal(body.messages[1].content,'prompt');
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
  assert.equal(state.requests.length, 3, 'correction, full essay, then frozen-essay review should each pass on first attempt');
  const correction = state.requests.find(body => body.format.properties.corrected);
  const model = state.requests.find(body => body.format.properties.paragraphs);
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
  assert.equal(provider.model, 'qwen3.5:4b');
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
  const requests = [];
  const base = await serveJson(t, (_req, res, body) => {
    requests.push(body);
    if (requests.length === 1) { res.writeHead(400); res.end('{}'); }
    else res.end(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}));
  });
  configure(t, { AI_PROVIDER: 'openai-compatible', AI_BASE_URL:base, AI_MODEL: 'free-model', AI_API_KEY: undefined });
  const schema = {type:'object',properties:{ok:{type:'boolean'}},required:['ok']};
  const result = await completeJson(await resolveProvider(), {system:'Return JSON.',prompt:'Essay input',schema});
  assert.deepEqual(result, {ok:true});
  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format.type, 'json_object');
  assert.equal(requests[1].response_format, undefined);
  for (const request of requests) assert(request.messages[0].content.includes(JSON.stringify(schema)));
});

test('invalid provider JSON produces a safe 502 for validation retries', async t => {
  let responseContent;
  const base = await serveJson(t, (_req, res) => res.end(JSON.stringify({message:{content:responseContent}})));
  for (const content of ['Here is {broken-json} with private-provider-details', 'no result']) {
    responseContent = content;
    await assert.rejects(
      completeJson({kind:'ollama',url:base,model:'test'}, {system:'system',prompt:'prompt',schema:{type:'object'}}),
      error => error instanceof ProviderError && error.status === 502 && !error.message.includes('private-provider-details')
    );
  }
});

test('cancelling an in-flight provider request aborts the transport without retrying', async t => {
  const controller = new AbortController();
  let calls = 0, requestStarted, connectionClosed;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const closed = new Promise(resolve => { connectionClosed = resolve; });
  const base = await serveJson(t, (_req, res) => {
    calls += 1;
    res.on('close', connectionClosed);
    requestStarted();
  });
  const job = completeJson({kind:'compatible',url:base,model:'test'}, {system:'system',prompt:'prompt',schema:{type:'object'},signal:controller.signal});
  await started;
  controller.abort();
  await assert.rejects(job, error => error instanceof ProviderError && error.status === 499);
  await closed;
  assert.equal(calls, 1);
});

test('non-JSON authentication errors retain their status without exposing provider details', async t => {
  const base = await serveJson(t, (_req, res) => { res.writeHead(401); res.end('private-provider-details'); });
  await assert.rejects(
    completeJson({kind:'compatible',url:base,model:'test'}, {system:'system',prompt:'prompt',schema:{type:'object'}}),
    error => error.status === 401 && /AI_API_KEY/.test(error.message) && !error.message.includes('private-provider-details')
  );
});

test('Ollama rejects length-truncated responses even when their partial content is valid JSON', async t => {
  let content;
  const requests = [];
  const base = await serveJson(t, (_req, res, body) => {
    requests.push(body);
    res.end(JSON.stringify({ done: true, done_reason: 'length', message: { content } }));
  });
  for (content of ['{"partial":true}', '{"partial":']) {
    await assert.rejects(
      completeJson({ kind: 'ollama', url: base, model: 'qwen2.5:7b' }, { system: 'system', prompt: 'prompt', schema: { type: 'object' }, maxTokens: 3072 }),
      error => error instanceof ProviderError && error.status === 502 && /长度上限/.test(error.message)
    );
  }
  assert.equal(requests.length, 2, '截断响应应交给上层重试，提供商层不能将其作为成功返回');
  for (const request of requests) {
    assert.equal(request.options.num_predict, 3072);
    assert.equal(request.options.num_ctx, 16384);
  }
});

test('Qwen3 Ollama requests disable thinking without adding the option to other model families', async t => {
  const requests = [];
  const base = await serveJson(t, (_req, res, body) => {
    requests.push(body);
    res.end(JSON.stringify({ done_reason: 'stop', message: { content: '{"ok":true}' } }));
  });
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  for (const model of ['qwen3:8b', 'Qwen3:4b', 'qwen3', 'qwen3.5:4b', 'qwen2.5:7b']) {
    assert.deepEqual(await completeJson({ kind: 'ollama', url: base, model }, { system: 'system', prompt: 'prompt', schema }), { ok: true });
  }
  for (const request of requests.slice(0, 4)) assert.equal(request.think, false, request.model);
  assert.equal(Object.hasOwn(requests.at(-1), 'think'), false);
  for (const request of requests) {
    assert.deepEqual(request.format, schema);
    assert.ok(request.messages[0].content.includes(JSON.stringify(schema)));
    assert.equal(request.options.num_predict, 6144);
  }
});

test('compatible providers reject length truncation before attempting JSON parsing', async t => {
  let content;
  const requests = [];
  const base = await serveJson(t, (_req, res, body) => {
    requests.push(body);
    res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content } }] }));
  });
  for (content of ['{"partial":true}', '{"partial":', null]) {
    await assert.rejects(
      completeJson({ kind: 'compatible', url: base, model: 'test' }, { system: 'system', prompt: 'prompt', schema: { type: 'object' }, maxTokens: 2048 }),
      error => error instanceof ProviderError && error.status === 502 && /长度上限/.test(error.message)
    );
  }
  assert.equal(requests.length, 3, '输出截断不应触发不带 JSON 格式的回退请求');
  for (const request of requests) assert.equal(request.max_tokens, 2048);
});

test('the compatible plain-format fallback also rejects a length-truncated response', async t => {
  const requests = [];
  const base = await serveJson(t, (_req, res, body) => {
    requests.push(body);
    if (requests.length === 1) { res.writeHead(400); res.end('{}'); }
    else res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"ok":true}' } }] }));
  });
  await assert.rejects(
    completeJson({ kind: 'compatible', url: base, model: 'test' }, { system: 'system', prompt: 'prompt', schema: { type: 'object' } }),
    error => error instanceof ProviderError && error.status === 502 && /长度上限/.test(error.message)
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format.type, 'json_object');
  assert.equal(Object.hasOwn(requests[1], 'response_format'), false);
});

test('runtime and environment API keys are sent only to their own configured base URLs', async t => {
  const requests = [];
  const respond = (req, res, body) => {
    requests.push({ url: req.url, authorization: req.headers.authorization, body });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }));
  };
  const base = await serveJson(t, respond);
  const otherBase = await serveJson(t, respond);
  configure(t, { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: `${base}/environment/`, AI_MODEL: 'test', AI_API_KEY: 'synthetic-environment-secret' });
  setCloudConfig({ baseUrl: `${base}/runtime`, model: 'runtime-model', apiKey: 'synthetic-runtime-secret' });
  t.after(() => setCloudConfig(null));
  const cases = [
    { url: `${base}/runtime`, expected: 'Bearer synthetic-runtime-secret' },
    { url: `${base}/environment`, expected: 'Bearer synthetic-environment-secret' },
    { url: `${base}/unrelated`, expected: undefined },
    { url: `${base}/runtime-other`, expected: undefined },
    { url: `${otherBase}/runtime`, expected: undefined },
    { url: `${base}/runtime`, apiKey: '', expected: undefined },
    { url: `${otherBase}/probe`, apiKey: 'synthetic-explicit-secret', expected: 'Bearer synthetic-explicit-secret' }
  ];
  for (const { expected, ...provider } of cases) {
    await completeJson({ kind: 'compatible', model: 'test', ...provider }, { system: 'system', prompt: 'prompt', schema: { type: 'object' } });
    assert.equal(requests.at(-1).authorization, expected, provider.url);
    assert.ok(!JSON.stringify(requests.at(-1).body).includes('secret'), '密钥不得进入提示或请求正文');
  }
  assert.equal(requests.length, cases.length);
});

test('an expired connection probe reports a timeout and sends no request', async t => {
  let calls = 0;
  const base = await serveJson(t, (_req, res) => { calls++; res.end('{}'); });
  const timeoutSignal = AbortSignal.timeout(1);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(timeoutSignal.aborted, true);
  const cancelled = new AbortController();
  cancelled.abort();
  for (const [signal, expectedStatus] of [[timeoutSignal, 504], [cancelled.signal, 499]]) {
    await assert.rejects(
      completeJson({ kind: 'compatible', url: base, model: 'test' }, { system: 'system', prompt: 'prompt', schema: { type: 'object' }, signal }),
      error => error instanceof ProviderError && error.status === expectedStatus && (expectedStatus === 504 ? /超时/.test(error.message) : /取消/.test(error.message))
    );
  }
  assert.equal(calls, 0);
});

test('an in-flight connection probe timeout aborts the transport and stays distinct from user cancellation', async t => {
  let calls = 0, requestStarted, connectionClosed;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const closed = new Promise(resolve => { connectionClosed = resolve; });
  const base = await serveJson(t, (_req, res) => {
    calls++;
    res.on('close', connectionClosed);
    requestStarted();
  });
  const timeoutController = new AbortController();
  const job = completeJson({ kind: 'compatible', url: base, model: 'test' }, { system: 'system', prompt: 'prompt', schema: { type: 'object' }, signal: timeoutController.signal });
  await started;
  timeoutController.abort(new DOMException('Synthetic probe deadline', 'TimeoutError'));
  await assert.rejects(job, error => error instanceof ProviderError && error.status === 504 && /超时/.test(error.message) && !/取消/.test(error.message));
  await closed;
  assert.equal(calls, 1);
});
