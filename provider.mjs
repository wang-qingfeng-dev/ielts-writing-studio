import { requestJson } from './http-json.mjs';
import { DEFAULT_WORKBUDDY_MODEL, normalizeWorkbuddyModel, workbuddyModelLabel as labelWorkbuddyModel } from './workbuddy-models.mjs';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen3.5:4b';
const configuredTimeout = Number(process.env.AI_TIMEOUT_MS || 600000);
const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(10000, Math.min(configuredTimeout, 900000)) : 600000;
let runtimeProviderOverride = null;
let runtimeCloudConfig = null;
let runtimeWorkbuddyModel = '';

// 网页设置只存储在服务端，密钥不会进入页面或模型提示。
export function setCloudConfig(config) { runtimeCloudConfig = config ? { ...config } : null; }

export class ProviderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// 服务商返回的错误正文只用于告诉用户真正的原因（余额、模型名、权限），
// 截断并清除控制字符，避免把长响应或多余内容整段抛给页面。
function upstreamDetail(data) {
  const raw = data?.error?.message ?? data?.error?.code
    ?? (typeof data?.error === 'string' ? data.error : undefined)
    ?? data?.message ?? data?.msg;
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const text = String(raw).replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text) return '';
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}
function hostOf(url) { try { return new URL(String(url)).hostname; } catch { return ''; } }
// 不同的 HTTP 状态码对应完全不同的处理动作；原来的统一文案让用户无从下手。
function httpFailureMessage(status, data, { url = '' } = {}) {
  const detail = upstreamDetail(data);
  const seen = detail ? `（服务商返回：${detail}）` : '';
  const host = hostOf(url);
  const isDeepSeek = host.endsWith('deepseek.com');
  switch (status) {
    case 400:
    case 422:
      return `服务商拒绝了这次请求（HTTP ${status}）：通常是模型名称不被该接口支持，或某个参数不被接受${seen}。请展开“模型与接口地址”，核对模型名称是否与服务商控制台一致。`;
    case 401:
      return `API 密钥无效、已过期或已被删除（HTTP 401）。请在“设置在线 AI”中重新粘贴密钥；用 .env 配置的用户请核对 AI_API_KEY${seen}。`;
    case 402:
      return isDeepSeek
        ? `DeepSeek 账户余额不足（HTTP 402）。请登录 platform.deepseek.com 的“充值”页面充值后再试；新账户若从未充值，所有 API 请求都会被拒绝${seen}。`
        : `服务商账户余额不足（HTTP 402），请先在服务商控制台充值后再试${seen}。`;
    case 403:
      return `密钥没有访问该模型的权限，或账户未完成实名/开通（HTTP 403）。请到服务商控制台确认模型权限与账户状态${seen}。`;
    case 404:
      return `接口地址或模型不存在（HTTP 404）。请检查 API 地址是否缺少 /v1 结尾，以及模型名称是否拼写正确${seen}。`;
    case 429:
      return `服务商限流或免费额度已用尽（HTTP 429），请稍后重试或充值升级额度${seen}。`;
    default:
      return status >= 500
        ? `服务商暂时故障（HTTP ${status}），请稍后重试${seen}。`
        : `服务商返回了 HTTP ${status}${seen}。`;
  }
}

function selectedProvider() {
  const selected = String(runtimeProviderOverride || process.env.AI_PROVIDER || 'auto').trim().toLowerCase();
  return selected === 'openai' ? 'openai-compatible' : selected;
}
function modelName(kind) {
  const perProvider = kind === 'compatible' ? runtimeCloudConfig?.model || process.env.OPENAI_MODEL : process.env.OLLAMA_MODEL;
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
function compatibleUrl() { return providerUrl(runtimeCloudConfig?.baseUrl || process.env.AI_BASE_URL || '', 'AI_BASE_URL'); }
function isConfiguredCompatible() { return Boolean(runtimeCloudConfig?.baseUrl || process.env.AI_BASE_URL?.trim()); }
function compatibleProviderName() {
  const labels = { deepseek:'DeepSeek', doubao:'豆包模型 · 火山方舟', glm:'智谱 GLM', siliconflow:'硅基流动', hunyuan:'腾讯混元 API', openrouter:'OpenRouter 免费模型路由', custom:'自定义在线接口' };
  return labels[runtimeCloudConfig?.provider] || 'OpenAI 兼容接口';
}

// WorkBuddy 桌面版自带 codebuddy 命令行，可以用已登录的账号额度完成分析。
// 模型由用户在页面上选，选择结果存在本机；没选过就用环境变量或默认值。
export function workbuddyModel() {
  if (runtimeWorkbuddyModel) return runtimeWorkbuddyModel;
  const configured = process.env.WORKBUDDY_MODEL?.trim() || process.env.IELTS_WORKBUDDY_MODEL?.trim();
  return normalizeWorkbuddyModel(configured) || DEFAULT_WORKBUDDY_MODEL;
}
export function setWorkbuddyModel(model) {
  runtimeWorkbuddyModel = normalizeWorkbuddyModel(model);
  return workbuddyModel();
}
export function workbuddyModelLabel(model = workbuddyModel()) {
  return labelWorkbuddyModel(model);
}

async function fetchJson(url, options = {}, signal) {
  if (signal?.aborted) {
    if (signal.reason?.name === 'TimeoutError') throw new ProviderError(504, 'AI 连接检测或请求超时，请检查网络、模型名称或稍后重试。');
    throw new ProviderError(499, '本次分析已取消。');
  }
  try {
    const response = await requestJson(url, { ...options, signal, timeoutMs });
    const data = response.data;
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError(response.status, httpFailureMessage(response.status, response.data, { url }));
    }
    if (data === null) throw new ProviderError(502, 'AI 接口返回的内容不是有效 JSON。');
    return data;
  } catch (error) {
    if (signal?.aborted) {
      if (signal.reason?.name === 'TimeoutError') throw new ProviderError(504, 'AI 连接检测或请求超时，请检查网络、模型名称或稍后重试。');
      throw new ProviderError(499, '本次分析已取消。');
    }
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

function modelTag(name) { return String(name).includes(':') ? String(name) : `${name}:latest`; }

// 分析前先确认本地 Ollama 真的有这个模型。否则用户只会看到笼统的 HTTP 404，
// 不知道是自己装的 Ollama 没下载模型，还是模型名不对。
export async function assertOllamaModel(provider, signal) {
  if (provider?.kind !== 'ollama') return [];
  const deadline = signal && AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000);
  let models = [];
  try {
    const data = await fetchJson(`${provider.url}/api/tags`, {}, deadline);
    models = Array.isArray(data?.models) ? data.models.map(item => typeof item?.name === 'string' ? item.name : '').filter(Boolean) : [];
  } catch (error) {
    if (error?.status === 499) throw error;
    throw new ProviderError(503, `没有检测到本地 Ollama（${provider.url}）。请先启动电脑上的 Ollama；如果想由软件管理，请点击页面上的“一键准备本地 AI”，它会安装 Ollama 并下载模型。`);
  }
  if (!models.some(name => modelTag(name) === modelTag(provider.model))) {
    const installed = models.length
      ? `这台电脑已安装：${models.slice(0, 6).join('、')}${models.length > 6 ? ' 等' : ''}。`
      : '这台电脑还没有下载任何本地模型。';
    throw new ProviderError(503, `本地 Ollama 里没有 ${provider.model} 模型。${installed}请在终端运行 ollama pull ${provider.model} 后重试，或点击“一键准备本地 AI”自动下载。`);
  }
  return models;
}

export async function resolveProvider() {
  const selected = selectedProvider();
  const localProvider = () => ({ kind:'ollama', name:'Ollama 本地免费模型', model:modelName('ollama'), url:ollamaUrl() });
  const compatibleProvider = () => ({ kind:'compatible', name:compatibleProviderName(), model:modelName('compatible'), url:compatibleUrl() });
  if (selected === 'ollama') return localProvider();
  if (selected === 'openai-compatible') {
    if (!isConfiguredCompatible()) throw new ProviderError(503, '未配置 AI_BASE_URL。');
    return compatibleProvider();
  }
  if (selected === 'codex') return { kind:'codex', name:'Codex CLI', model:'当前 Codex 模型' };
  if (selected === 'workbuddy') return { kind:'workbuddy', name:'WorkBuddy CLI', model:workbuddyModel(), modelLabel:workbuddyModelLabel() };
  if (selected !== 'auto') throw new ProviderError(503, 'AI_PROVIDER 不受支持，请使用 auto、ollama、workbuddy、codex 或 openai-compatible。');
  if (await ollamaAvailable()) return localProvider();
  if (isConfiguredCompatible()) return compatibleProvider();
  // 账户型 Codex 调用必须明确选择；本地服务缺失时不能悄悄把作文提交给其他提供商。
  return localProvider();
}

export function setProviderOverride(provider) {
  const allowed = ['auto','ollama','codex','workbuddy','openai-compatible'];
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
      const hasModel = models.some(name => modelTag(name) === modelTag(provider.model));
      const installed = models.length ? `已安装：${models.slice(0, 6).join('、')}${models.length > 6 ? ' 等' : ''}。` : '还没有下载任何模型。';
      return {
        available:hasModel, provider:provider.kind, selected:getProviderOverride(), engine:`${provider.name} · ${provider.model}`,
        installedModels:models,
        message:hasModel
          ? '本地模型已连接；批改速度取决于电脑性能，评分仅供练习参考。'
          : `本地 Ollama 里没有 ${provider.model}。${installed}请运行 ollama pull ${provider.model}，或点击“一键准备本地 AI”自动下载。`
      };
    }
    if (provider.kind === 'compatible') return { available:true, provider:provider.kind, selected:getProviderOverride(), engine:`${provider.name} · ${provider.model}`, message:'已配置 OpenAI 兼容接口。密钥只在服务端读取。' };
    if (provider.kind === 'workbuddy') return { available:false, provider:provider.kind, selected:getProviderOverride(), engine:`${provider.name} · ${provider.modelLabel}`, message:'WorkBuddy CLI 需要通过应用内的状态检查连接。' };
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
function parseCompatibleCompletion(data) {
  // 长度截断时即使正文碰巧能解析，也不能把不完整的批改当作成功结果。
  if (data?.choices?.[0]?.finish_reason === 'length') {
    throw new ProviderError(502, '云端模型输出达到长度上限，请重试或选择输出额度更高的模型。');
  }
  return parseJson(extractText(data));
}
export async function completeJson(provider, { system, prompt, schema, signal, maxTokens = 6144 }) {
  if (provider.kind === 'ollama') {
    // 默认 4K 上下文不足以同时容纳题目、完整评语和三栏标注，必须明确预留输出空间。
    const instructions = `${system}\nReturn one JSON object matching this schema. Copy source quotes exactly; do not invent missing quotes.\n${JSON.stringify(schema)}`;
    const body={model:provider.model,stream:false,format:schema,messages:[{role:'system',content:instructions},{role:'user',content:prompt}],options:{temperature:0.15,num_ctx:16384,num_predict:maxTokens}};
    if (/^qwen3(?:[.:]|$)/i.test(provider.model)) body.think = false;
    const data = await fetchJson(`${provider.url}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},signal);
    if (data.done_reason === 'length') throw new ProviderError(502, '本地模型输出达到长度上限，正在准备重新生成较精简的结果。');
    return parseJson(extractText(data));
  }
  if (provider.kind === 'compatible') {
    const url=`${provider.url}/chat/completions`;
    // JSON 模式只能保证语法；把完整结构加入提示，兼容不支持严格结构化输出的服务。
    const instructions = `${system}\nReturn exactly one JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`;
    const base={model:provider.model,messages:[{role:'system',content:instructions},{role:'user',content:prompt}],temperature:0.2,max_tokens:maxTokens};
    // DeepSeek 现行 API 默认思考模式开启，短连接测试会耗尽预算而没有正文。
    // 只向官方主机传其专用参数，不影响其他兼容服务。
    if (['api.deepseek.com', 'ark.cn-beijing.volces.com', 'open.bigmodel.cn'].includes(new URL(provider.url).hostname)) base.thinking = { type:'disabled' };
    if (new URL(provider.url).hostname === 'openrouter.ai') base.reasoning = { enabled:false };
    const headers={'Content-Type':'application/json'};
    // 凭据只可发送至它绑定的地址，不能让另一个兼容接口继承当前密钥。
    const runtimeMatches = runtimeCloudConfig?.baseUrl === provider.url;
    let environmentMatches = false;
    try { environmentMatches = providerUrl(process.env.AI_BASE_URL || '', 'AI_BASE_URL') === provider.url; } catch { /* 未配置环境接口。 */ }
    const key = Object.hasOwn(provider,'apiKey') ? provider.apiKey : runtimeMatches ? runtimeCloudConfig.apiKey : environmentMatches ? process.env.AI_API_KEY : undefined;
    if(key)headers.Authorization=`Bearer ${key}`;
    try { return parseCompatibleCompletion(await fetchJson(url,{method:'POST',headers,body:JSON.stringify({...base,response_format:{type:'json_object'}})},signal)); }
    catch(error) { if(error.status===400) return parseCompatibleCompletion(await fetchJson(url,{method:'POST',headers,body:JSON.stringify(base)},signal)); throw error; }
  }
  throw new ProviderError(500,'Unsupported AI provider.');
}

// Task 1 图片只用于提取图表/流程/地图的文字材料；视觉模型的原始输出仍由后端校验，不能直接进入评分请求。
export async function completeVisionJson(provider, { system, prompt, imageData, mimeType = 'image/png', schema, signal, maxTokens = 3000 }) {
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData || '')) throw new ProviderError(400, '图片格式无效，请选择 PNG、JPG 或 WebP 图片。');
  if (provider.kind === 'compatible') {
    const url = `${provider.url}/chat/completions`;
    const instructions = `${system}\nReturn exactly one JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`;
    const base = { model: provider.model, messages: [{ role:'system', content:instructions }, { role:'user', content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:imageData}}] }], temperature:0.1, max_tokens:maxTokens };
    if (['api.deepseek.com','ark.cn-beijing.volces.com','open.bigmodel.cn'].includes(new URL(provider.url).hostname)) base.thinking={type:'disabled'};
    if (new URL(provider.url).hostname === 'openrouter.ai') base.reasoning={enabled:false};
    const headers={'Content-Type':'application/json'};
    const runtimeMatches = runtimeCloudConfig?.baseUrl === provider.url;
    let environmentMatches = false;
    try { environmentMatches = providerUrl(process.env.AI_BASE_URL || '', 'AI_BASE_URL') === provider.url; } catch {}
    const key = runtimeMatches ? runtimeCloudConfig.apiKey : environmentMatches ? process.env.AI_API_KEY : undefined;
    if (key) headers.Authorization=`Bearer ${key}`;
    try { return parseCompatibleCompletion(await fetchJson(url,{method:'POST',headers,body:JSON.stringify({...base,response_format:{type:'json_object'}})},signal)); }
    catch(error) { if(error.status===400) return parseCompatibleCompletion(await fetchJson(url,{method:'POST',headers,body:JSON.stringify(base)},signal)); throw error; }
  }
  if (provider.kind === 'ollama') {
    const raw = imageData.split(',',2)[1];
    const instructions = `${system}\nReturn one JSON object matching this schema:\n${JSON.stringify(schema)}`;
    const body={model:provider.model,stream:false,messages:[{role:'system',content:instructions},{role:'user',content:prompt,images:[raw]}],options:{temperature:0.1,num_ctx:8192,num_predict:maxTokens}};
    const data=await fetchJson(`${provider.url}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},signal);
    return parseJson(extractText(data));
  }
  throw new ProviderError(503, '当前 AI 模式不支持图片识别，请切换到支持视觉输入的在线模型或本地视觉模型。');
}
