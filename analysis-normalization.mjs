import { validateCorrection, validateModel, ValidationError } from './analysis-schema.mjs';

/**
 * 对模型的格式偏差做有限、可审计的修复，不替模型生成评分或教学内容。
 *
 * normalizeCorrection(raw, essay) / normalizeModel(raw) 返回：
 *   { data: 通过现有严格校验的数据, warnings: [{ code, path, message }] }
 * warnings 只包含字段路径和校验原因，不包含作文、凭据或原始模型输出。
 * 核心正文、四项评分、评分依据、改进建议和三项重点不完整时仍抛出
 * ValidationError；只有辅助高亮、表达卡片和范文注释可以被舍弃。
 * 输入不会被修改。可再次严格校验 data，也可安全重复运行归一化。
 */

const CRITERION_ORDER = ['TR', 'CC', 'LR', 'GRA'];
const CRITERION_NAMES = new Map([
  ['tr', 'TR'], ['task response', 'TR'], ['任务回应', 'TR'],
  ['cc', 'CC'], ['coherence and cohesion', 'CC'], ['连贯与衔接', 'CC'],
  ['lr', 'LR'], ['lexical resource', 'LR'], ['词汇资源', 'LR'],
  ['gra', 'GRA'], ['grammatical range and accuracy', 'GRA'], ['grammar range and accuracy', 'GRA'], ['语法多样性与准确性', 'GRA'],
]);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const warn = (warnings, code, path, message) => warnings.push({ code, path, message });

function requireChineseFeedback(value, path) {
  // 中文解释中可以引用英文，但不能把整段英文评语当作中文反馈交付。
  // 这里只检查模型是否提供了汉字，不生成翻译或改写教学内容。
  if (typeof value !== 'string' || !/\p{Script=Han}/u.test(value)) {
    throw new ValidationError(`${path} must contain Simplified Chinese feedback; English source quotes are allowed.`);
  }
}

function validateScoreLanguage(score, path) {
  for (const [index, criterion] of score.criteria.entries()) {
    requireChineseFeedback(criterion.evidence, `${path}.criteria[${index}].evidence`);
    requireChineseFeedback(criterion.action, `${path}.criteria[${index}].action`);
  }
}

function normalizeBand(value, path, warnings) {
  // 只做无损类型转换；6.3、超范围、空字符串均留给严格校验拒绝。
  if (typeof value === 'string' && /^\d(?:\.(?:0+|50*))?$/.test(value.trim())) {
    const number = Number(value.trim());
    if (Number.isFinite(number) && number >= 0 && number <= 9 && Number.isInteger(number * 2)) {
      warn(warnings, 'score_format_normalized', path, '分数字符串已转换为等值数字。');
      return number;
    }
  }
  return value;
}

function normalizeScore(score, path, warnings) {
  if (!isObject(score)) return score;
  score.low = normalizeBand(score.low, `${path}.low`, warnings);
  score.high = normalizeBand(score.high, `${path}.high`, warnings);
  if (!Array.isArray(score.criteria)) return score;
  for (const [index, criterion] of score.criteria.entries()) {
    if (!isObject(criterion)) continue;
    if (typeof criterion.key === 'string') {
      const name = criterion.key.trim().toLowerCase().replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ');
      const canonical = CRITERION_NAMES.get(name);
      if (canonical && canonical !== criterion.key) {
        criterion.key = canonical;
        warn(warnings, 'criterion_name_normalized', `${path}.criteria[${index}].key`, '评分维度名称已转换为标准缩写。');
      }
    }
    criterion.band = normalizeBand(criterion.band, `${path}.criteria[${index}].band`, warnings);
  }
  // 只在四项完全且互不重复时排序，绝不补全缺失维度或消除重复评分。
  const keys = score.criteria.map(item => item?.key);
  if (keys.length === 4 && new Set(keys).size === 4 && keys.every(key => CRITERION_ORDER.includes(key))) {
    if (keys.some((key, index) => key !== CRITERION_ORDER[index])) {
      score.criteria.sort((left, right) => CRITERION_ORDER.indexOf(left.key) - CRITERION_ORDER.indexOf(right.key));
      warn(warnings, 'criterion_order_normalized', `${path}.criteria`, '评分维度已按 TR、CC、LR、GRA 排序。');
    }
  }
  return score;
}

function canonicalText(text) {
  let normalized = '';
  const starts = [], ends = [];
  let offset = 0;
  for (const character of text) {
    const start = offset;
    offset += character.length;
    const value = /\s/u.test(character) ? ' ' : /[\u2018\u2019]/u.test(character) ? "'" : /[\u201c\u201d]/u.test(character) ? '"' : character;
    if (value === ' ' && normalized.endsWith(' ')) {
      ends[ends.length - 1] = offset;
      continue;
    }
    normalized += value;
    // 用 UTF-16 下标映射，和 String.indexOf / slice 保持一致。
    for (let index = 0; index < value.length; index++) { starts.push(start); ends.push(offset); }
  }
  return { text: normalized, starts, ends };
}

function alignQuote(source, quote, maximum, path, warnings) {
  if (typeof quote !== 'string' || !quote.trim() || quote.length > maximum) return quote;
  const first = source.indexOf(quote);
  if (first >= 0) return quote; // 精确匹配有歧义时交由严格校验拒绝，不擅自选取某次出现。
  const canonicalSource = canonicalText(source);
  const canonicalQuote = canonicalText(quote).text.trim();
  const index = canonicalSource.text.indexOf(canonicalQuote);
  if (index < 0 || index !== canonicalSource.text.lastIndexOf(canonicalQuote)) return quote;
  const aligned = source.slice(canonicalSource.starts[index], canonicalSource.ends[index + canonicalQuote.length - 1]);
  if (!aligned || aligned.length > maximum || source.indexOf(aligned) !== source.lastIndexOf(aligned)) return quote;
  warn(warnings, 'quote_format_normalized', path, '已将空白或弯引号差异对齐到唯一的原文片段。');
  return aligned;
}

function normalizeEnum(value, allowed, path, warnings) {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized !== value && allowed.includes(normalized)) {
    warn(warnings, 'annotation_format_normalized', path, '标注类型的大小写或首尾空白已标准化。');
    return normalized;
  }
  return value;
}

function normalizeId(item, ids, prefix, index, path, warnings) {
  if (typeof item.id === 'string' && item.id.trim() && item.id.length <= 100 && !ids.has(item.id)) return;
  let id = `${prefix}-${index + 1}`;
  let suffix = 1;
  while (ids.has(id)) id = `${prefix}-${index + 1}-${suffix++}`;
  item.id = id;
  warn(warnings, 'annotation_id_normalized', `${path}.id`, '缺失或重复的内部标识已重新生成，标注内容不变。');
}

function normalizeItems(items, { path, limit, prepare, validate }, warnings) {
  if (!Array.isArray(items)) {
    warn(warnings, 'annotation_dropped', path, '辅助标注列表缺失或格式无效，已保留正文和评分。');
    return [];
  }
  const accepted = [], ids = new Set();
  for (const [index, raw] of items.entries()) {
    if (accepted.length === limit) {
      warn(warnings, 'annotation_limit', path, `辅助标注超出 ${limit} 项显示上限，已省略剩余项。`);
      break;
    }
    const itemPath = `${path}[${index}]`;
    const itemWarnings = [];
    try {
      if (!isObject(raw)) throw new ValidationError('Annotation must be an object');
      const item = prepare(raw, index, ids, itemPath, itemWarnings);
      validate(item);
      accepted.push(item);
      if (item.id) ids.add(item.id);
      warnings.push(...itemWarnings);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      // 不能精确定位的高亮不得展示；其问题不会让真实正文与有效评分一并消失。
      warn(warnings, 'annotation_dropped', itemPath, `辅助标注未通过校验，已省略：${error.message}`);
    }
  }
  return accepted;
}

function normalizeExpressions(items, { source, text, validate }, warnings) {
  return normalizeItems(items, {
    path: 'expressions', limit: 4,
    prepare(item, index, ids, path, itemWarnings) {
      requireChineseFeedback(item.meaning, `${path}.meaning`);
      requireChineseFeedback(item.usage, `${path}.usage`);
      normalizeId(item, ids, `${source}-expression`, index, path, itemWarnings);
      item.source = normalizeEnum(item.source, ['model', 'corrected'], `${path}.source`, itemWarnings);
      item.text = alignQuote(text, item.text, 600, `${path}.text`, itemWarnings);
      return item;
    },
    validate,
  }, warnings);
}

export function normalizeCorrection(raw, essay) {
  if (!isObject(raw)) { validateCorrection(raw, essay); }
  const data = structuredClone(raw), warnings = [];
  normalizeScore(data.originalScore, 'originalScore', warnings);
  if (isObject(data.corrected)) normalizeScore(data.corrected.score, 'corrected.score', warnings);
  const core = { ...data, issues: [], expressions: [] };
  validateCorrection(core, essay);
  validateScoreLanguage(core.originalScore, 'originalScore');
  validateScoreLanguage(core.corrected.score, 'corrected.score');
  for (const [index, priority] of core.priorities.entries()) {
    requireChineseFeedback(priority.title, `priorities[${index}].title`);
    requireChineseFeedback(priority.description, `priorities[${index}].description`);
  }
  data.issues = normalizeItems(data.issues, {
    path: 'issues', limit: 12,
    prepare(item, index, ids, path, itemWarnings) {
      requireChineseFeedback(item.explanation, `${path}.explanation`);
      normalizeId(item, ids, 'issue', index, path, itemWarnings);
      item.category = normalizeEnum(item.category, ['grammar', 'vocabulary', 'logic', 'spelling'], `${path}.category`, itemWarnings);
      item.priority = normalizeEnum(item.priority, ['essential', 'optional'], `${path}.priority`, itemWarnings);
      item.original = alignQuote(essay, item.original, 2000, `${path}.original`, itemWarnings);
      item.replacement = alignQuote(data.corrected.text, item.replacement, 2000, `${path}.replacement`, itemWarnings);
      return item;
    },
    validate: item => validateCorrection({ ...core, issues: [item] }, essay),
  }, warnings);
  data.expressions = normalizeExpressions(data.expressions, {
    source: 'corrected', text: data.corrected.text,
    validate: item => validateCorrection({ ...core, expressions: [item] }, essay),
  }, warnings);
  validateCorrection(data, essay);
  return { data, warnings };
}

export function normalizeModel(raw) {
  if (!isObject(raw)) { validateModel(raw); }
  const data = structuredClone(raw), warnings = [];
  if (isObject(data.model)) normalizeScore(data.model.score, 'model.score', warnings);
  const core = { ...data, model: { ...data.model, notes: [] }, expressions: [] };
  validateModel(core);
  validateScoreLanguage(core.model.score, 'model.score');
  data.model.notes = normalizeItems(data.model.notes, {
    path: 'model.notes', limit: 8,
    prepare(item, _index, _ids, path, itemWarnings) {
      requireChineseFeedback(item.label, `${path}.label`);
      requireChineseFeedback(item.explanation, `${path}.explanation`);
      item.quote = alignQuote(data.model.text, item.quote, 1800, `${path}.quote`, itemWarnings);
      return item;
    },
    validate: item => validateModel({ ...core, model: { ...core.model, notes: [item] } }),
  }, warnings);
  data.expressions = normalizeExpressions(data.expressions, {
    source: 'model', text: data.model.text,
    validate: item => validateModel({ ...core, expressions: [item] }),
  }, warnings);
  validateModel(data);
  return { data, warnings };
}
