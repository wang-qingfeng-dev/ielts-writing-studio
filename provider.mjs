const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5:7b';
const configuredTimeout = Number(process.env.AI_TIMEOUT_MS || 600000);
const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(10000, Math.min(configuredTimeout, 900000)) : 600000;
let runtimeProviderOverride = null;

export class ProviderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function selectedProvider() {
  return String(runtimeProviderOverride || process.env.AI_PROVIDER || 'auto').toLowerCase();
}
function modelName() {
  return process.env.AI_MODEL || (selectedProvider() === 'codex' ? '当前 Codex 模型' : DEFAULT_OLLAMA_MODEL);
}
function ollamaUrl() { return (process.env.OLLAMA_HOST || DEFAULT_OLLAMA_URL).replace(/\/$/, ''); }
function compatibleUrl() { return (process.env.AI_BASE_URL || '').replace(/\/$/, ''); }
function isConfiguredCompatible() { return Boolean(process.env.AI_BASE_URL); }

async function fetchJson(url, options = {}, signal) {
  if (signal?.aborted) throw new ProviderError(499, '本次分析已取消。');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let data = null; try { data = await response.json(); } catch {}
    if (!response.ok) throw new ProviderError(response.status, 'AI provider request failed');
    return data;
  } catch (error) {
    if (signal?.aborted) throw new ProviderError(499, '本次分析已取消。');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(503, 'AI provider is unavailable');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

async function ollamaAvailable() {
  try { const data = await fetch(`${ollamaUrl()}/api/tags`, { signal:AbortSignal.timeout(2500) }); return data.ok; } catch { return false; }
}

export async function resolveProvider() {
  const selected = selectedProvider();
  if (selected === 'ollama') return { kind:'ollama', name:'Ollama 本地免费模型', model:modelName(), url:ollamaUrl() };
  if (selected === 'openai-compatible' || selected === 'openai') {
    if (!isConfiguredCompatible()) throw new ProviderError(503, '未配置 AI_BASE_URL。');
    return { kind:'compatible', name:'OpenAI 兼容接口', model:modelName(), url:compatibleUrl() };
  }
  if (selected === 'codex') return { kind:'codex', name:'Codex CLI', model:'当前 Codex 模型' };
  if (await ollamaAvailable()) return { kind:'ollama', name:'Ollama 本地免费模型', model:modelName(), url:ollamaUrl() };
  if (isConfiguredCompatible()) return { kind:'compatible', name:'OpenAI 兼容接口', model:modelName(), url:compatibleUrl() };
  return { kind:'codex', name:'Codex CLI（兼容旧配置）', model:'当前 Codex 模型' };
}

export function setProviderOverride(provider) {
  const allowed = ['auto','ollama','codex','openai-compatible'];
  if (!allowed.includes(provider)) throw new ProviderError(400, '不支持的 AI 模式。');
  runtimeProviderOverride = provider;
  return runtimeProviderOverride || 'auto';
}
export function getProviderOverride() { return runtimeProviderOverride || 'auto'; }

export async function getProviderStatus() {
  let provider;
  try {
    provider = await resolveProvider();
    if (provider.kind === 'ollama') {
      const tags = await fetchJson(`${provider.url}/api/tags`, {}, AbortSignal.timeout(2500));
      const models = Array.isArray(tags.models) ? tags.models.map(item=>item.name) : [];
      const expected = provider.model.includes(':') ? provider.model : `${provider.model}:latest`;
      const hasModel = models.some(name => (name.includes(':') ? name : `${name}:latest`) === expected);
      return { available:hasModel, provider:provider.kind, selected:getProviderOverride(), engine:`${provider.name} · ${provider.model}`, message:hasModel?'已连接本机 Ollama，可以免费分析。':`请先运行 ollama pull ${provider.model}。` };
    }
    if (provider.kind === 'compatible') return { available:true, provider:provider.kind, selected:getProviderOverride(), engine:`${provider.name} · ${provider.model}`, message:'已配置 OpenAI 兼容接口。密钥只在服务端读取。' };
    return { available:false, provider:provider.kind, selected:getProviderOverride(), engine:provider.name, message:'未配置免费本地模型。安装 Ollama 并运行 pull 命令，或设置 AI_BASE_URL。' };
  } catch (error) {
    return { available:false, provider:provider?.kind || 'unknown', selected:getProviderOverride(), engine:provider ? `${provider.name} · ${provider.model}` : 'AI provider', message:provider?.kind === 'ollama' ? `未连接到 Ollama。请启动本地 Ollama，并运行 ollama pull ${provider.model} 下载模型。` : error.message || 'AI 服务不可用。' };
  }
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content ?? data?.message?.content;
  if (Array.isArray(content)) return content.map(part=>part.text || '').join('');
  if (typeof content === 'string') return content;
  throw new ProviderError(502, 'AI 返回内容为空。');
}
function parseJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try { return JSON.parse(cleaned); } catch { const start=cleaned.indexOf('{'), end=cleaned.lastIndexOf('}'); if(start>=0&&end>start)return JSON.parse(cleaned.slice(start,end+1)); throw new ProviderError(502,'AI 返回的 JSON 无法解析。'); }
}
export async function completeJson(provider, { system, prompt, schema, signal }) {
  if (provider.kind === 'ollama') {
    const body={model:provider.model,stream:false,format:schema,messages:[{role:'system',content:system},{role:'user',content:prompt}],options:{temperature:0.2}};
    return parseJson(extractText(await fetchJson(`${provider.url}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},signal)));
  }
  if (provider.kind === 'compatible') {
    const url=`${provider.url}/chat/completions`;
    const base={model:provider.model,messages:[{role:'system',content:system},{role:'user',content:prompt}],temperature:0.2};
    const headers={'Content-Type':'application/json'}; if(process.env.AI_API_KEY)headers.Authorization=`Bearer ${process.env.AI_API_KEY}`;
    try { return parseJson(extractText(await fetchJson(url,{method:'POST',headers,body:JSON.stringify({...base,response_format:{type:'json_object'}})},signal))); }
    catch(error) { if(error.status===400) return parseJson(extractText(await fetchJson(url,{method:'POST',headers,body:JSON.stringify(base)},signal))); throw error; }
  }
  throw new ProviderError(500,'Unsupported AI provider.');
}
