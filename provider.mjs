import { requestJson } from './http-json.mjs';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5:7b';
const configuredTimeout = Number(process.env.AI_TIMEOUT_MS || 600000);
const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(10000, Math.min(configuredTimeout, 900000)) : 600000;
let runtimeProviderOverride = null;

export class ProviderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function selectedProvider() {
  const selected = String(runtimeProviderOverride || process.env.AI_PROVIDER || 'auto').trim().toLowerCase();
  return selected === 'openai' ? 'openai-compatible' : selected;
}
function modelName(kind) {
  const perProvider = kind === 'compatible' ? process.env.OPENAI_MODEL : process.env.OLLAMA_MODEL;
  const configured = perProvider?.trim() || process.env.AI_MODEL?.trim();
  if (kind === 'compatible' && !configured) throw new ProviderError(503, '请配置 OPENAI_MODEL（或 AI_MODEL），填写兼容接口支持的模型名称。');
  return configured || DEFAULT_OLLAMA_MODEL;
}
function providerUrl(value, setting) {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/+$/, '');
  } catch { throw new ProviderError(503, `请将 ${setting} 设置为有效的 HTTP(S) 服务地址，不含密码、查询参数或片段。`); }
}
function ollamaUrl() { return providerUrl(process.env.OLLAMA_HOST || DEFAULT_OLLAMA_URL, 'OLLAMA_HOST'); }
function compatibleUrl() { return providerUrl(process.env.AI_BASE_URL || '', 'AI_BASE_URL'); }
function isConfiguredCompatible() { return Boolean(process.env.AI_BASE_URL?.trim()); }

async function fetchJson(url, options = {}, signal) {
  if (signal?.aborted) throw new ProviderError(499, '本次分析已取消。');
  try {
    const response = await requestJson(url, { ...options, signal, timeoutMs });
    const data = response.data;
    if (response.status < 200 || response.status >= 300) {
      const message = response.status === 401 || response.status === 403
        ? 'AI 接口认证失败，请检查服务端 AI_API_KEY 和模型权限。'
        : response.status === 429
          ? 'AI 接口额度或请求频率受限，请稍后重试。'
          : 'AI 接口请求失败，请检查服务地址、模型名称和配置。';
      throw new ProviderError(response.status, message);
    }
    if (data === null) throw new ProviderError(502, 'AI 接口返回的内容不是有效 JSON。');
    return data;
  } catch (error) {
    if (signal?.aborted) throw new ProviderError(499, '本次分析已取消。');
    if (error instanceof ProviderError) throw error;
    if (error.code === 'ETIMEDOUT') throw new ProviderError(504, 'AI 接口响应超时，请稍后重试或使用更小的本地模型。');
    if (error.code === 'EINVALIDJSON') throw new ProviderError(502, 'AI 接口返回的内容不是有效 JSON。');
    if (error.code === 'ERESPONSETOOLARGE') throw new ProviderError(502, 'AI 接口返回内容超出限制，请缩短作文后重试。');
    throw new ProviderError(503, '无法连接 AI 接口，请检查服务是否启动及网络连接。');
  }
}

async function ollamaAvailable() {
  try { const data = await fetch(`${ollamaUrl()}/api/tags`, { signal:AbortSignal.timeout(2500) }); return data.ok; } catch { return false; }
}

export async function resolveProvider() {
  const selected = selectedProvider();
  const localProvider = () => ({ kind:'ollama', name:'Ollama 本地免费模型', model:modelName('ollama'), url:ollamaUrl() });
  const compatibleProvider = () => ({ kind:'compatible', name:'OpenAI 兼容接口', model:modelName('compatible'), url:compatibleUrl() });
  if (selected === 'ollama') return localProvider();
  if (selected === 'openai-compatible') {
    if (!isConfiguredCompatible()) throw new ProviderError(503, '未配置 AI_BASE_URL。');
    return compatibleProvider();
  }
  if (selected === 'codex') return { kind:'codex', name:'Codex CLI', model:'当前 Codex 模型' };
  if (selected !== 'auto') throw new ProviderError(503, 'AI_PROVIDER 不受支持，请使用 auto、ollama、openai-compatible 或 codex。');
  if (await ollamaAvailable()) return localProvider();
  if (isConfiguredCompatible()) return compatibleProvider();
  // 账户型 Codex 调用必须明确选择；本地服务缺失时不能悄悄把作文提交给其他提供商。
  return localProvider();
}

export function setProviderOverride(provider) {
  const allowed = ['auto','ollama','codex','openai-compatible'];
  if (!allowed.includes(provider)) throw new ProviderError(400, '不支持的 AI 模式。');
  runtimeProviderOverride = provider;
  return runtimeProviderOverride || 'auto';
}
export function getProviderOverride() { return selectedProvider(); }

export async function getProviderStatus() {
  let provider;
  try {
    provider = await resolveProvider();
    if (provider.kind === 'ollama') {
      const tags = await fetchJson(`${provider.url}/api/tags`, {}, AbortSignal.timeout(2500));
      const models = Array.isArray(tags?.models) ? tags.models.map(item=>item?.name).filter(name=>typeof name === 'string') : [];
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
  try { return JSON.parse(cleaned); } catch {
    const start=cleaned.indexOf('{'), end=cleaned.lastIndexOf('}');
    if(start>=0&&end>start) {
      try { return JSON.parse(cleaned.slice(start,end+1)); } catch {}
    }
    throw new ProviderError(502,'AI 返回的 JSON 无法解析。');
  }
}
export async function completeJson(provider, { system, prompt, schema, signal }) {
  if (provider.kind === 'ollama') {
    const body={model:provider.model,stream:false,format:schema,messages:[{role:'system',content:system},{role:'user',content:prompt}],options:{temperature:0.2}};
    return parseJson(extractText(await fetchJson(`${provider.url}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},signal)));
  }
  if (provider.kind === 'compatible') {
    const url=`${provider.url}/chat/completions`;
    // JSON 模式只能保证语法；把完整结构加入提示，兼容不支持严格结构化输出的服务。
    const instructions = `${system}\nReturn exactly one JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`;
    const base={model:provider.model,messages:[{role:'system',content:instructions},{role:'user',content:prompt}],temperature:0.2};
    const headers={'Content-Type':'application/json'}; if(process.env.AI_API_KEY)headers.Authorization=`Bearer ${process.env.AI_API_KEY}`;
    try { return parseJson(extractText(await fetchJson(url,{method:'POST',headers,body:JSON.stringify({...base,response_format:{type:'json_object'}})},signal))); }
    catch(error) { if(error.status===400) return parseJson(extractText(await fetchJson(url,{method:'POST',headers,body:JSON.stringify(base)},signal))); throw error; }
  }
  throw new ProviderError(500,'Unsupported AI provider.');
}
