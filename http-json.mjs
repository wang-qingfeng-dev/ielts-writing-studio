import http from 'node:http';
import https from 'node:https';

// Node fetch 的响应头超时可能短于分析预算；这里用一个明确期限覆盖连接、响应头和完整响应体。
export function requestJson(url, { method = 'GET', headers = {}, body, signal, timeoutMs = 600000, maxResponseBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { const error = new Error('Request cancelled.'); error.code = 'ABORT_ERR'; reject(error); return; }
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : target.protocol === 'https:' ? https : null;
    if (!transport) { reject(new Error('Only HTTP(S) endpoints are supported.')); return; }
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const request = transport.request(target, { method, headers, agent: false }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxResponseBytes) {
          const error = new Error('Response exceeds the configured size limit.');
          error.code = 'ERESPONSETOOLARGE';
          finish(error);
          response.destroy(error);
          request.destroy(error);
        } else chunks.push(chunk);
      });
      response.on('error', error => finish(error));
      response.on('end', () => {
        try { finish(null, { status: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch {
          if (response.statusCode >= 400) finish(null, {status:response.statusCode,data:null});
          else { const error = new Error('Endpoint did not return valid JSON.'); error.code = 'EINVALIDJSON'; finish(error); }
        }
      });
    });
    const timer = setTimeout(() => {
      const error = new Error(`Request exceeded its ${timeoutMs} ms deadline.`);
      error.code = 'ETIMEDOUT';
      finish(error);
      request.destroy(error);
    }, timeoutMs);
    const abort = () => {
      const error = new Error('Request cancelled.');
      error.code = 'ABORT_ERR';
      finish(error);
      request.destroy(error);
    };
    signal?.addEventListener('abort', abort, {once:true});
    request.on('error', error => finish(error));
    request.end(body);
  });
}
