// WorkBuddy 命令行的 --model 取值（来自 `codebuddy --help` 的 model 列表）。
// 这里只做一件事：把用户看不懂的模型 ID 换成能选的中文条目。
// 官方新增模型时，把 ID 加进来即可；未知 ID 仍然允许作为自定义模型使用。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cloudSettingsDirectory } from './cloud-settings.mjs';

export const DEFAULT_WORKBUDDY_MODEL = 'balanced-model';

export const WORKBUDDY_MODELS = [
  { id: 'balanced-model', label: '标准模型', note: '日常批改的默认选择，速度和细致程度比较平衡', group: 'recommended' },
  { id: 'fast-model', label: '快速模型', note: '出结果最快，适合先粗看一遍', group: 'recommended' },
  { id: 'deep-model', label: '深度模型', note: '分析更细致，等待时间也更长', group: 'recommended' },

  { id: 'glm-5.3', label: '智谱 GLM-5.3', note: '中文理解强，改语法和搭配比较稳', group: 'popular' },
  { id: 'glm-5.3-flash', label: '智谱 GLM-5.3 Flash', note: 'GLM 的轻量版，响应快', group: 'popular' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', note: '论证和逻辑分析见长', group: 'popular' },
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', note: 'DeepSeek 的快速版本', group: 'popular' },
  { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro', note: '长文本处理稳定', group: 'popular' },
  { id: 'hy3', label: '腾讯混元 3', note: '中文表达自然', group: 'popular' },
  { id: 'minimax-m3.1-flash', label: 'MiniMax M3.1 Flash', note: '轻量快速', group: 'popular' },
  { id: 'mimo-v2.6-pro', label: 'MiMo V2.6 Pro', note: '综合能力均衡', group: 'popular' },
  { id: 'step-5-preview', label: 'Step-5 Preview', note: '预览版模型', group: 'popular' },

  { id: 'hy4-preview', label: '腾讯混元 4（预览）', note: '混元新一代预览版', group: 'more' },
  { id: 'hy3-x', label: '腾讯混元 3-X', note: '混元 3 的加强版', group: 'more' },
  { id: 'glm-5.3-flashx', label: '智谱 GLM-5.3 FlashX', note: 'GLM 高速版', group: 'more' },
  { id: 'glm-5.2', label: '智谱 GLM-5.2', note: '上一代旗舰', group: 'more' },
  { id: 'glm-5.1', label: '智谱 GLM-5.1', note: '上一代旗舰', group: 'more' },
  { id: 'glm-5v-turbo', label: '智谱 GLM-5V Turbo', note: '偏多模态', group: 'more' },
  { id: 'space-bunny', label: 'Space Bunny', note: '轻量实验模型', group: 'more' },
  { id: 'minimax-m3-pay', label: 'MiniMax M3 Pay', note: '按量计费版本', group: 'more' },
  { id: 'kimi-k3.1-pro-highspeed', label: 'Kimi K3.1 Pro 高速版', note: 'Kimi 的加速通道', group: 'more' },
  { id: 'kimi-k3-2', label: 'Kimi K3-2', note: '', group: 'more' },
  { id: 'kimi-k2.8-preview', label: 'Kimi K2.8（预览）', note: '', group: 'more' },
];

const KNOWN_IDS = new Set(WORKBUDDY_MODELS.map(item => item.id));

export function isKnownWorkbuddyModel(model) {
  return KNOWN_IDS.has(String(model || '').trim());
}

export function workbuddyModelLabel(model) {
  const id = String(model || '').trim() || DEFAULT_WORKBUDDY_MODEL;
  const found = WORKBUDDY_MODELS.find(item => item.id === id);
  return found ? found.label : id;
}

// 只接受字母数字和 . _ - : ，长度限制在 64，避免把奇怪的值拼进命令行。
export function normalizeWorkbuddyModel(value) {
  const model = String(value ?? '').trim();
  if (!model) return DEFAULT_WORKBUDDY_MODEL;
  if (model.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(model)) return '';
  return model;
}

export function workbuddyModelPayload(current) {
  const model = normalizeWorkbuddyModel(current) || DEFAULT_WORKBUDDY_MODEL;
  return {
    model,
    label: workbuddyModelLabel(model),
    known: isKnownWorkbuddyModel(model),
    models: WORKBUDDY_MODELS,
  };
}

export function createWorkbuddyModelStore(options = {}) {
  const directory = path.resolve(options.rootDir || cloudSettingsDirectory(options));
  const filename = path.join(directory, 'workbuddy.json');

  async function read() {
    try {
      const parsed = JSON.parse(await readFile(filename, 'utf8'));
      const model = normalizeWorkbuddyModel(parsed?.model);
      return model || DEFAULT_WORKBUDDY_MODEL;
    } catch {
      // 文件不存在或者内容坏了，都回到默认模型，不影响使用。
      return DEFAULT_WORKBUDDY_MODEL;
    }
  }

  async function write(value) {
    const model = normalizeWorkbuddyModel(value);
    if (!model) throw new Error('模型名称不合法。');
    await mkdir(directory, { recursive: true });
    await writeFile(filename, `${JSON.stringify({ model }, null, 2)}\n`, 'utf8');
    return model;
  }

  return { read, write, filename };
}
