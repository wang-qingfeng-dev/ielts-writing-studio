import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { requestJson } from '../http-json.mjs';

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('live client allows delayed headers and preserves error status with JSON', async t => {
  const base = await serve(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.origin, base);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks)), { essay: 'test' });
    setTimeout(() => { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"Not ready"}'); }, 50);
  });
  const result = await requestJson(base, { method:'POST', headers:{Origin:base,'Content-Type':'application/json'}, body:'{"essay":"test"}', timeoutMs:1000 });
  assert.deepEqual(result, { status:503, data:{error:'Not ready'} });
});

test('live client deadline terminates stalled headers and stalled response bodies', async t => {
  for (const startedBody of [false, true]) {
    const base = await serve(t, (_req, res) => {
      if (startedBody) { res.writeHead(200, {'Content-Type':'application/json'}); res.write('{'); }
    });
    await assert.rejects(requestJson(base, {timeoutMs:50}), error => error.code === 'ETIMEDOUT');
  }
});

test('live client rejects oversized responses and invalid JSON', async t => {
  const base = await serve(t, (req, res) => { res.end(req.url === '/invalid' ? 'not json' : JSON.stringify({data:'x'.repeat(1000)})); });
  await assert.rejects(requestJson(`${base}/invalid`), /valid JSON/);
  await assert.rejects(requestJson(`${base}/large`, {maxResponseBytes:100}), /size limit/);
});
