import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';

// 预设只包含公开地址和说明，软件不内置任何共享密钥或他人的额度。
export const CLOUD_PRESETS = Object.freeze([
  Object.freeze({ id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', signupUrl: 'https://platform.deepseek.com/api_keys', pricingNote: '按用量计费，需要自己的 API 密钥和可用余额；以官方当前价格为准。' }),
  Object.freeze({ id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: '', signupUrl: 'https://cloud.siliconflow.cn/account/ak', pricingNote: '模型、免费额度及限流以官方控制台为准；请填写自己账号可用的模型名称。' }),
  Object.freeze({ id: 'openrouter', label: 'OpenRouter 免费模型路由', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', signupUrl: 'https://openrouter.ai/keys', pricingNote: '需要自己的 API 密钥。免费模型有次数和频率限制，可用性与输出质量会变化。' }),
  Object.freeze({ id: 'custom', label: '其他兼容接口', baseUrl: '', model: '', signupUrl: '', pricingNote: '填写你信任的服务商信息，费用与数据处理由该服务商决定。' })
]);

export class CloudSettingsError extends Error {
  constructor(status, message) { super(message); this.name = 'CloudSettingsError'; this.status = status; }
}

function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function validateSelectedProvider(provider) {
  if (!['auto', 'ollama', 'codex', 'openai-compatible'].includes(provider)) throw new CloudSettingsError(400, '不支持的 AI 模式。');
  return provider;
}
function trimString(value, label, max = 2048) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new CloudSettingsError(400, `${label}格式无效。`);
  }
  return value.trim();
}
function normalizeUrl(value) {
  const raw = trimString(value, '服务地址');
  try {
    const url = new URL(raw);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || !url.hostname ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new Error();
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new CloudSettingsError(400, '线上服务必须使用 HTTPS 地址，不含密码、查询参数或片段；仅本机 localhost、127.0.0.1 和 ::1 可使用 HTTP。');
  }
}

// 空密钥可表示保留原密钥，但绝不把旧密钥自动转发到另一个服务地址。
export function validateCloudSettings(input, { current = null } = {}) {
  if (!isObject(input)) throw new CloudSettingsError(400, 'AI 设置必须是对象。');
  const provider = trimString(input.provider ?? input.preset ?? '', '服务商', 50);
  const preset = CLOUD_PRESETS.find(item => item.id === provider);
  if (!preset) throw new CloudSettingsError(400, '请选择支持的服务商，或选择其他兼容接口。');
  const baseUrl = normalizeUrl(input.baseUrl || preset.baseUrl);
  if (provider !== 'custom' && baseUrl !== preset.baseUrl) {
    throw new CloudSettingsError(400, '预设服务商的地址不能修改；自定义地址请使用其他兼容接口。');
  }
  const model = trimString(input.model || preset.model, '模型名称', 200);
  if (!model || /\s/u.test(model)) throw new CloudSettingsError(400, '请填写有效的模型名称，不含空格或换行。');
  let apiKey = trimString(input.apiKey ?? '', 'API 密钥', 4096);
  const sameProvider = current && (current.provider ?? current.preset) === provider && current.baseUrl === baseUrl;
  if (!apiKey && sameProvider) apiKey = trimString(current.apiKey ?? '', 'API 密钥', 4096);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname);
  if (!apiKey && !(provider === 'custom' && loopback)) throw new CloudSettingsError(400, '请粘贴你自己的 API 密钥。软件不提供共享密钥。');
  return { provider, baseUrl, model, apiKey };
}

// 所有网页接口都应调用此函数，不能把 load()/save() 的私有结果直接返回。
export function publicCloudSettings(config) {
  return {
    provider: config?.provider ?? '',
    baseUrl: config?.baseUrl ?? '',
    model: config?.model ?? '',
    keyConfigured: Boolean(config?.apiKey),
    providers: CLOUD_PRESETS.map(item => ({ ...item })),
    configured: Boolean(config?.provider && config?.baseUrl && config?.model),
    tested: config?.tested === true,
    selectedProvider: config ? config.selectedProvider ?? 'openai-compatible' : 'auto'
  };
}

export function cloudSettingsDirectory({ env = process.env, platform = process.platform, homeDir = os.homedir() } = {}) {
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'JujinWritingStudio', 'settings');
  if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'JujinWritingStudio', 'settings');
  return path.join(env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'JujinWritingStudio', 'settings');
}

export function createCloudSettingsStore(options = {}) {
  const directory = path.resolve(options.rootDir || cloudSettingsDirectory(options));
  const filename = path.join(directory, 'cloud-ai.json');
  let queue = Promise.resolve();
  const enqueue = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };

  async function read() {
    let content;
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error();
      content = await fs.readFile(filename, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new CloudSettingsError(500, '无法读取本机 AI 设置，请在 AI 设置中重新保存。');
    }
    try {
      const data = JSON.parse(content);
      if (!isObject(data) || data.version !== 1) throw new Error();
      return { ...validateCloudSettings(data), tested: data.tested === true, selectedProvider: validateSelectedProvider(data.selectedProvider ?? 'openai-compatible') };
    } catch {
      throw new CloudSettingsError(500, '本机 AI 设置已损坏或格式不兼容，请重新保存。');
    }
  }

  async function persist(config) {
    const temporary = path.join(directory, `.cloud-ai-${crypto.randomUUID()}.tmp`);
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
      await fs.writeFile(temporary, `${JSON.stringify({ version: 1, ...config }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, filename);
      if (process.platform !== 'win32') await fs.chmod(filename, 0o600);
      return { ...config };
    } catch {
      throw new CloudSettingsError(500, '无法保存本机 AI 设置。请检查当前用户目录的写入权限。');
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  return {
    load: () => enqueue(read),
    getPublic: () => enqueue(async () => publicCloudSettings(await read())),
    save: (input, { tested = false } = {}) => enqueue(async () => {
      let previous = null;
      try { previous = await read(); } catch { /* 输入完整配置时允许覆盖损坏的设置。 */ }
      return persist({ ...validateCloudSettings(input, { current: previous }), tested: tested === true, selectedProvider: 'openai-compatible' });
    }),
    setSelectedProvider: provider => enqueue(async () => {
      const selectedProvider = validateSelectedProvider(provider);
      const config = await read();
      // 仅本次使用或未配置在线 AI 时，不为了偏好保存任何密钥。
      if (!config) return null;
      return persist({ ...config, selectedProvider });
    }),
    clear: () => enqueue(async () => {
      try { await fs.rm(filename, { force: true }); }
      catch { throw new CloudSettingsError(500, '无法删除本机 AI 设置，请检查当前用户目录权限。'); }
      return publicCloudSettings(null);
    })
  };
}
