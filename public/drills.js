// 好词好句 + 句式仿写：材料全部来自这次真实的批改结果，本地判定，不额外调用 AI。
//
// 训练逻辑只有一条：给一个好句式，换三个不同话题各写一句。
// 「认得出」不算会，「换着话题写得出」才算。
import { escapeHtml as e, countWords, makeCardId, normalizeAnswer } from './utils.js';

const STORAGE_KEY = 'jujin.pattern.v1';
const MAX_LAST_MISSED = 12;
const MAX_ITEMS = 9;
const TOPICS_PER_ITEM = 3;

// 高频 IELTS 句式库：识别原句用了哪一套骨架，训练时把这套骨架搬到别的话题上。
const PATTERNS = [
  {
    id: 'make-it-easier',
    name: 'make it easier for sb to do',
    skeleton: '___ makes it easier for ___ to ___ .',
    test: /\bmak(e|es|ing|de)?\s+it\s+(easier|harder|possible|difficult|cheaper)\s+for\b/i,
    tip: '主语 + make it + 形容词 + for 人 + to do。讲“某个措施降低了谁做某事的门槛”，比 it is easy for people to 更有动作感。',
  },
  {
    id: 'not-only-but-also',
    name: 'not only … but also …',
    skeleton: 'Not only does ___ , but it also ___ .',
    test: /\bnot\s+only\b[\s\S]{0,140}?\bbut\s+(also|it\s+also|they\s+also)\b/i,
    tip: '想并列两个理由时用。句首 Not only 要倒装：Not only does 主语 + 动词原形, but it also …。',
  },
  {
    id: 'while-contrast',
    name: 'while / whereas 对比',
    skeleton: 'While ___ , ___ .',
    test: /\b(while|whereas)\b/i,
    tip: '把两种相反的情况塞进一句，比用两句 and 更像 7 分句子。前半句给反面，后半句给自己的立场。',
  },
  {
    id: 'although-concession',
    name: 'although / despite 让步',
    skeleton: 'Although ___ , ___ . / Despite ___ , ___ .',
    test: /\b(although|even though|despite|in spite of)\b/i,
    tip: '先让一步承认对方，再给出自己的判断。注意 although 后面接句子，despite 后面接名词或 doing。',
  },
  {
    id: 'the-more',
    name: 'the more … the more …',
    skeleton: 'The more ___ , the more ___ .',
    test: /\bthe\s+(more|less|fewer|better|worse|higher|lower)\b[\s\S]{0,70}?\bthe\s+(more|less|fewer|better|worse|higher|lower)\b/i,
    tip: '两个变化同步发生：The more + 句子, the more + 句子。用来写趋势和代价特别省力。',
  },
  {
    id: 'cleft',
    name: 'It is … that … 强调句',
    skeleton: 'It is ___ that ___ .',
    test: /\bit\s+(is|was)\s+(not\s+)?[A-Za-z][\w\s'-]{1,40}?\s+that\s+[a-z]/i,
    tip: '把想强调的部分夹在 It is 和 that 中间。注意别和 It is important to do 混用。',
  },
  {
    id: 'there-is-growing',
    name: 'There is a growing …',
    skeleton: 'There is a growing ___ that ___ .',
    test: /\bthere\s+(is|has\s+been)\s+a\s+(growing|increasing|rising|declining)\b/i,
    tip: '描述趋势的开场。后面要给出具体是什么在增长，别停在 there is a growing trend 这种空句。',
  },
  {
    id: 'rather-than',
    name: 'rather than 取舍',
    skeleton: '___ rather than ___ .',
    test: /\b(rather\s+than|instead\s+of)\b/i,
    tip: '把“不要 A 要 B”写得更紧：动词 + B + rather than + A。用来说政策取向很有效。',
  },
  {
    id: 'compared-with',
    name: 'compared with 比较',
    skeleton: 'Compared with ___ , ___ .',
    test: /\b(compared\s+(with|to)|in\s+comparison\s+(with|to))\b/i,
    tip: '比较两句只留一句：Compared with A, B …。后半句一定要有具体差别，别只说 B is better。',
  },
  {
    id: 'play-role',
    name: 'play a … role in',
    skeleton: '___ plays a (crucial|vital|key) role in ___ .',
    test: /\bplay(s|ed|ing)?\s+an?\s+[\w-]+\s+role\s+in\b/i,
    tip: '讲“某因素起什么作用”。role 前面的形容词要准：decisive / limited / supportive，不要一律 crucial。',
  },
  {
    id: 'impact-on',
    name: 'have a … impact on',
    skeleton: '___ has a (significant) impact on ___ .',
    test: /\b(have|has|had|having)\s+an?\s+[\w-]+\s+(impact|effect|influence)\s+on\b/i,
    tip: '影响类句型。想拿 7 分就在后面补一句具体表现，而不是单独一句 has a huge impact。',
  },
  {
    id: 'tend-to',
    name: 'tend to / be likely to',
    skeleton: '___ tend(s) to ___ .',
    test: /\b(tend(s|ed)?\s+to|(is|are)\s+(more\s+)?likely\s+to)\b/i,
    tip: '把绝对化结论变稳妥：people tend to … 比 people always … 更像学术表达。',
  },
  {
    id: 'by-doing',
    name: 'By doing …, 主语 + 动词',
    skeleton: 'By ___-ing , ___ can ___ .',
    test: /(^|[.!?]\s+)by\s+\w+ing\b/i,
    tip: '手段放句首，主句给结果。检查前后主语是否一致，否则会出现垂悬分词。',
  },
  {
    id: 'which-clause',
    name: ', which … 非限定定语从句',
    skeleton: '___ , which ___ .',
    test: /,\s*which\s+(is|are|was|were|has|have|had|can|could|would|makes|make|allows|leads|means|helps|reduces|requires|often|also)\b/i,
    tip: '补充说明前整句，而不是只修饰最后一个词。逗号不能省。',
  },
  {
    id: 'so-that',
    name: 'so … that … 结果',
    skeleton: '___ is so ___ that ___ .',
    test: /\bso\s+[a-z][\w-]*\s+that\b/i,
    tip: 'so + 形容词 + that + 结果。别和 such … that 的搭配混用。',
  },
  {
    id: 'as-as',
    name: 'as … as … 同级比较',
    skeleton: '___ can be as ___ as ___ .',
    test: /\bas\s+[a-z][\w-]*\s+as\b/i,
    tip: '把两个东西放在同一水平上比较。别漏掉第二个 as，也别写成 as more important as。',
  },
  {
    id: 'if-conditional',
    name: 'If …, 主句（条件句）',
    skeleton: 'If ___ , ___ will ___ .',
    test: /(^|[.!?]\s+)if\s|[^a-z]if\s+[^,]{4,70},/i,
    tip: '提出条件下的结果，是 Task 2 给建议最稳的句式。主句别再用 if，两半各写一个完整分句。',
  },
  {
    id: 'predicate-that',
    name: 'Another … is that …（表语从句）',
    skeleton: 'Another ___ is that ___ .',
    test: /\b(is|are|was|were)\s+that\s+[a-z]/i,
    tip: '先说“另一点是”，再用 that 从句展开，段落推进很清楚。注意从句里主语谓语都要齐。',
  },
  {
    id: 'described-as',
    name: 'X, often described as Y（同位补充）',
    skeleton: '___ , often described as ___ , ___ .',
    test: /,\s*(often\s+|usually\s+|sometimes\s+|commonly\s+)?(described|known|called|seen|regarded)\s+as\b/i,
    tip: '在句中插入解释性短语，信息密度高又不加长句子。两个逗号不能省。',
  },
  {
    id: 'condition',
    name: 'unless / as long as 条件',
    skeleton: '___ unless ___ . / As long as ___ , ___ .',
    test: /\b(unless|only\s+if|as\s+long\s+as)\b/i,
    tip: '给方案加条件，能体现论证的严密程度。提出建议时加一句 unless 往往能救回 TR/TA。',
  },
  {
    id: 'as-a-result',
    name: 'as a result / consequently 结果',
    skeleton: '___ . As a result, ___ .',
    test: /\b(as\s+a\s+result|consequently|therefore|thus|hence)\b/i,
    tip: '因果链的第二环。前面必须已经交代了原因，否则 as a result 会显得凭空。',
  },
  {
    id: 'this-is-because',
    name: 'This is because 解释原因',
    skeleton: '___ . This is because ___ .',
    test: /\b(this\s+is\s+because|the\s+reason\s+(is|lies)|which\s+is\s+why)\b/i,
    tip: '先给结论，再用 This is because 补原因。比 because 开头的长句更容易读。',
  },
  {
    id: 'formal-it',
    name: 'It is + adj + to do（形式主语）',
    skeleton: 'It is ___ (for ___ ) to ___ .',
    test: /\bit\s+(is|was|would\s+be)\s+[a-z][\w-]*\s+(for\s+\w+\s+)?to\s+[a-z]/i,
    tip: '把“做某事很……”写成 It is … to do，句子重心后移，读起来更像书面语。',
  },
];

// 换话题用的语境库：训练时必须离开原题，否则只是抄写。
const TOPICS = [
  { zh: '教育：大学扩招与班级规模', en: 'university admission · class size' },
  { zh: '科技：手机与社交媒体的使用', en: 'smartphones · social media' },
  { zh: '环境：城市交通与空气污染', en: 'city transport · air pollution' },
  { zh: '健康：久坐与运动习惯', en: 'sedentary lifestyles · exercise' },
  { zh: '工作：远程办公的利弊', en: 'remote work · productivity' },
  { zh: '政府：公共资金该投向哪里', en: 'public spending · priorities' },
  { zh: '媒体：广告如何影响消费', en: 'advertising · consumer habits' },
  { zh: '家庭：老龄化与照护责任', en: 'ageing population · family care' },
  { zh: '旅游：过度旅游与本地生活', en: 'overtourism · local residents' },
];

const STOP = new Set(('a an the of to in on for with and or that this it is are be as by at from its their his her we they people can could should will would may might must not no more most very much many some any also than such there has have had do does did but if so when while what which who how why all both each into over about after before because between during up down out off again then once here these those was were been being own other same').split(' '));

function tokens(value) {
  return normalizeAnswer(value).match(/[a-z0-9']+/gu) || [];
}

function contentWords(value) {
  const list = tokens(value).filter(token => token.length > 2 && !STOP.has(token));
  return list.length ? list : tokens(value);
}

// 词形变化算命中：reduce / reduced / reducing 视为同一个词。
function sameWord(a, b) {
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (short < 5) return false;
  return a.slice(0, 5) === b.slice(0, 5);
}

function hashOf(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

// 取包含目标短语的完整句子，避免把孤立的词从语境里撕出来。
export function sentenceAround(text, fragment, { max = 320 } = {}) {
  const source = String(text || '');
  const target = String(fragment || '');
  if (!source || !target) return '';
  const index = source.indexOf(target);
  if (index < 0) return '';
  let start = index;
  while (start > 0 && !/[.!?\n]/u.test(source[start - 1])) start--;
  let end = index + target.length;
  while (end < source.length && !/[.!?\n]/u.test(source[end])) end++;
  if (end < source.length && /[.!?]/u.test(source[end])) end++;
  let sentence = source.slice(start, end).replace(/\s+/gu, ' ').trim();
  if (sentence.length > max) {
    const before = sentence.slice(0, sentence.indexOf(target));
    const from = Math.max(0, before.length - 90);
    sentence = `${from > 0 ? '…' : ''}${sentence.slice(from)}`;
    if (sentence.length > max) sentence = `${sentence.slice(0, max - 1)}…`;
  }
  return sentence;
}

function topicsFor(id) {
  const offset = hashOf(id) % TOPICS.length;
  return [0, 1, 2].map(step => TOPICS[(offset + step * 3) % TOPICS.length]);
}

function pickPattern(sentence, used) {
  for (const pattern of PATTERNS) {
    if (used.has(pattern.id)) continue;
    if (pattern.test.test(sentence)) return pattern;
  }
  return null;
}

/**
 * 从一次完整的批改结果里提炼「好词好句 + 可迁移句式」。
 * 顺序：先句式（能举一反三），再表达（能直接搬用）。
 */
export function buildWordbank({ analysis, essay } = {}, { limit = MAX_ITEMS } = {}) {
  if (!analysis) return [];
  const correctedText = analysis.corrected?.text || '';
  const modelText = analysis.model?.text || '';
  const sourceText = item => (item.source === 'model' ? modelText : correctedText);
  const usedPatterns = new Set();
  const patterns = [];
  const expressions = [];
  const seen = new Set();
  const push = (list, item) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    list.push(item);
  };

  for (const [expressionIndex, item] of (analysis.expressions || []).entries()) {
    if (!item?.text) continue;
    const source = sourceText(item);
    if (!source.includes(item.text)) continue;
    const sentence = sentenceAround(source, item.text) || '';
    const pattern = sentence ? pickPattern(sentence, usedPatterns) : null;
    if (pattern) {
      usedPatterns.add(pattern.id);
      push(patterns, {
        id: `pattern-${pattern.id}`,
        patternId: pattern.id,
        expressionIndex,
        kind: 'pattern',
        title: pattern.name,
        text: item.text,
        skeleton: pattern.skeleton,
        tip: pattern.tip,
        meaning: item.meaning,
        usage: item.usage,
        example: item.example,
        sentence,
        source: item.source,
        test: pattern.test,
        keywords: contentWords(item.text),
        topics: topicsFor(`pattern-${pattern.id}`),
      });
      continue;
    }
    push(expressions, {
      id: makeCardId('expression', item.text),
      expressionIndex,
      kind: 'expression',
      title: item.text,
      text: item.text,
      skeleton: '',
      tip: item.usage,
      meaning: item.meaning,
      usage: item.usage,
      example: item.example,
      sentence,
      source: item.source,
      test: null,
      keywords: contentWords(item.text),
      topics: topicsFor(item.text),
    });
  }

  // 范文里的好句也带句式：批改给的理由恰好说明了它为什么好。
  for (const [index, note] of (analysis.model?.notes || []).entries()) {
    if (!note?.quote) continue;
    const pattern = pickPattern(note.quote, usedPatterns);
    if (!pattern) continue;
    usedPatterns.add(pattern.id);
    const match = note.quote.match(pattern.test);
    push(patterns, {
      id: `pattern-${pattern.id}`,
      patternId: pattern.id,
      kind: 'pattern',
      title: pattern.name,
      text: (match?.[0] || note.quote).trim(),
      skeleton: pattern.skeleton,
      tip: pattern.tip,
      meaning: note.label,
      usage: note.explanation,
      example: note.quote,
      sentence: note.quote,
      source: 'model',
      test: pattern.test,
      keywords: contentWords(match?.[0] || note.quote),
      topics: topicsFor(`note-${index}-${pattern.id}`),
    });
    if (patterns.length >= limit) break;
  }

  return [...patterns, ...expressions].slice(0, limit);
}

/**
 * 判一句仿写。三道检查分别对应：用上句式了吗、句子写完整了吗、是不是照抄。
 * 任何一条不通过都给出具体可改的地方，而不是简单判错。
 */
export function gradeDrill(item, answer) {
  const raw = String(answer || '').trim();
  if (!raw) return { status: 'empty', checks: [] };
  const answerTokens = tokens(raw);
  const words = countWords(raw);
  const checks = [];

  let hit = false;
  let matchedText = '';
  if (item.test instanceof RegExp) {
    const match = raw.match(item.test);
    hit = Boolean(match);
    matchedText = match?.[0] || '';
  } else {
    const need = item.keywords?.length ? item.keywords : contentWords(item.text);
    const found = need.filter(word => answerTokens.some(token => sameWord(token, word)));
    hit = need.length ? found.length / need.length >= 0.6 : normalizeAnswer(raw).includes(normalizeAnswer(item.text));
    matchedText = found.join(' ');
  }
  checks.push({
    key: 'pattern',
    label: item.kind === 'pattern' ? '用上了这个句式' : '用上了这个表达',
    pass: hit,
    note: hit
      ? (matchedText ? `已识别：${matchedText.slice(0, 60)}` : '结构已对上。')
      : (item.kind === 'pattern'
        ? `这一段里还没有 ${item.skeleton || '上面的骨架'} 的结构。照着骨架把空位填满。`
        : `这一段里还没出现「${item.text}」。词形可以变，但核心词要留下。`),
  });

  const capital = /^[A-Z"“'(]/.test(raw);
  const punctuated = /[.!?]$/.test(raw);
  const longEnough = words >= 6;
  checks.push({
    key: 'sentence',
    label: '写成一个完整句子',
    pass: longEnough && capital && punctuated,
    note: !longEnough ? `现在 ${words} 个词，至少要 6 个词才能成句。` : !capital ? '句首第一个字母要大写。' : !punctuated ? '句末补上句号。' : `${words} 个词，句首大写、句末有标点。`,
  });

  const originalTokens = tokens(item.sentence || '');
  const overlap = originalTokens.length
    ? answerTokens.filter(token => originalTokens.includes(token)).length / Math.max(answerTokens.length, 1)
    : 0;
  const copied = normalizeAnswer(raw) === normalizeAnswer(item.sentence || '') || (originalTokens.length > 5 && overlap > 0.8);
  checks.push({
    key: 'own',
    label: '换成了自己的内容',
    pass: !copied,
    note: copied ? '这句话和原句几乎一样。换掉主语、宾语和例子，骨架保留就可以。' : '已经把内容换成了新话题。',
  });

  const passed = checks.filter(check => check.pass).length;
  return {
    status: passed === checks.length ? 'correct' : passed ? 'partial' : 'wrong',
    checks,
    words,
    overlap,
  };
}

export function drillStats(store) {
  const answered = Number(store?.answered) || 0;
  const correct = Number(store?.correct) || 0;
  const mastered = Object.values(store?.records && typeof store.records === 'object' ? store.records : {})
    .filter(record => (Number(record?.correct) || 0) >= 2).length;
  return {
    answered,
    correct,
    rate: answered ? Math.round(correct / answered * 100) : 0,
    missed: Array.isArray(store?.lastMissed) ? store.lastMissed.length : 0,
    sessions: Number(store?.sessions) || 0,
    mastered,
  };
}

function loadStore(storage) {
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY));
    if (raw && typeof raw === 'object') {
      return {
        version: 1,
        answered: Number(raw.answered) || 0,
        correct: Number(raw.correct) || 0,
        sessions: Number(raw.sessions) || 0,
        lastAt: Number(raw.lastAt) || 0,
        lastMissed: Array.isArray(raw.lastMissed) ? raw.lastMissed.filter(item => item && typeof item.id === 'string').slice(0, MAX_LAST_MISSED) : [],
        records: raw.records && typeof raw.records === 'object' ? raw.records : {},
      };
    }
  } catch { /* 损坏的训练记录不应阻止写作，重置为空即可。 */ }
  return { version: 1, answered: 0, correct: 0, sessions: 0, lastAt: 0, lastMissed: [], records: {} };
}

const SOURCE_LABEL = { corrected: '来自精修版本', model: '来自高分范文' };

function checkIcon(pass) {
  return pass
    ? '<span class="drill-check-icon is-pass" aria-hidden="true">✓</span>'
    : '<span class="drill-check-icon is-fail" aria-hidden="true">✕</span>';
}

/**
 * 好词好句区块：既是阅读区（本次值得拿走的表达），也是训练入口。
 * 卡片的「照着写一句」直接进单句式训练，不必先读完整篇。
 */
export function initWordbank(options = {}) {
  const section = document.querySelector('#wordbank-section');
  if (!section) return { render: () => {}, start: () => {}, train: () => {} };
  const storage = options.storage || window.localStorage;
  let store = loadStore(storage);
  let session = null;

  const persist = () => {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(store)); }
    catch { /* 存不下时训练仍可继续，只是不累计统计。 */ }
  };

  const currentItems = () => {
    const state = options.getState?.() || {};
    return buildWordbank({ analysis: state.analysis, essay: state.essay });
  };

  function render() {
    const state = options.getState?.() || {};
    const items = currentItems();
    const stats = drillStats(store);
    const busy = Boolean(state.busy);
    if (!items.length) {
      section.innerHTML = `<div class="section-heading">
        <div><p class="eyebrow">WORDS &amp; PATTERNS</p><h2>本篇好词好句</h2>
        <p class="section-description">分析完成后，这里会列出这篇里真正值得带走的句式和表达，并给出换话题仿写。</p></div>
      </div>
      <div class="wordbank-empty">
        <p>先完成一次分析，好词好句会从你自己的作文里抽出来。</p>
        <span>每一条都能点开仿写：一个句式，换三个话题各写一句。</span>
      </div>`;
      return;
    }
    const patternCount = items.filter(item => item.kind === 'pattern').length;
    section.innerHTML = `<div class="section-heading">
      <div>
        <p class="eyebrow">WORDS &amp; PATTERNS</p>
        <h2>本篇好词好句</h2>
        <p class="section-description">${items.length} 处值得带走：${patternCount} 个可迁移句式，${items.length - patternCount} 个现成表达。点「照着写一句」，换三个话题各写一遍。</p>
      </div>
      <div class="section-actions">
        <button class="btn btn-primary btn-small" type="button" data-drill-action="start" ${busy ? 'disabled' : ''}>开始仿写 · ${Math.min(items.length, 3)} 个</button>
        <button class="btn btn-secondary btn-small" type="button" data-drill-action="retry-missed" ${busy || !stats.missed ? 'disabled' : ''}>练上次没写对的</button>
      </div>
    </div>
    <div class="wordbank-grid">
      ${items.map((item, index) => wordCard(item, index, stats)).join('')}
    </div>
    <div class="wordbank-foot">
      <span>${stats.answered ? `累计仿写 ${stats.answered} 句 · 一次达标 ${stats.rate}% · 已掌握 ${stats.mastered} 个句式` : '还没开始仿写。第一句最难写，写完就顺了。'}</span>
      <span class="wordbank-foot-note">判定在本地完成：只看句式是否用上、句子是否完整、是否换了自己的内容。</span>
    </div>`;
  }

  function wordCard(item, index, stats) {
    const record = store.records[item.id];
    const isPattern = item.kind === 'pattern';
    const bookmark = options.bookmark && Number.isInteger(item.expressionIndex)
      ? options.bookmark(item.expressionIndex)
      : '';
    const done = record?.correct ? '<span class="word-done" title="已经写过">写过</span>' : '';
    // 句式卡以「骨架」为主角，表达卡以「这个词组」为主角；两者都带原句，避免脱离语境背诵。
    const head = isPattern
      ? `<h3 class="word-text is-pattern-name">${e(item.title)}</h3>
         ${item.skeleton ? `<p class="word-skeleton" lang="en">${e(item.skeleton)}</p>` : ''}
         ${item.sentence ? `<p class="word-sentence" lang="en">${highlight(item.sentence, item.text)}</p>` : ''}
         <p class="word-tagline">本篇用到 <b lang="en">${e(item.text)}</b>${item.meaning ? ` · ${e(item.meaning)}` : ''}</p>`
      : `<h3 class="word-text" lang="en">${e(item.text)}</h3>
         <p class="word-meaning">${e(item.meaning || '')}</p>
         ${item.sentence ? `<p class="word-sentence" lang="en">${highlight(item.sentence, item.text)}</p>` : ''}
         ${item.usage ? `<p class="word-usage">${e(item.usage)}</p>` : ''}`;
    return `<article class="word-card${isPattern ? ' is-pattern' : ''}">
      <div class="word-card-top">
        <span class="card-tag ${isPattern ? 'pattern' : 'expression'}">${isPattern ? '句式' : '表达'}</span>
        <span class="word-source">${e(SOURCE_LABEL[item.source] || '本篇')}</span>
        ${done}
        ${bookmark}
      </div>
      ${head}
      <button class="mini-btn" type="button" data-drill-item="${index}" ${options.getState?.()?.busy ? 'disabled' : ''}>照着写一句 →</button>
    </article>`;
  }

  function highlight(sentence, fragment) {
    if (!fragment) return e(sentence);
    const at = sentence.indexOf(fragment);
    if (at < 0) return e(sentence);
    return `${e(sentence.slice(0, at))}<mark>${e(fragment)}</mark>${e(sentence.slice(at + fragment.length))}`;
  }

  function start(items, { review = false, title = '' } = {}) {
    if (!items?.length) { options.toast?.('还没有可仿写的句子，先完成一次分析。'); return; }
    session = { items, itemIndex: 0, topicIndex: 0, attempt: null, done: [], review };
    options.openModal?.(title || (review ? '再练上次没写对的' : '句式仿写 · 换三个话题各写一句'), '<div id="drill-stage"></div>');
    paint();
  }

  const totalSteps = () => (session ? session.items.length * TOPICS_PER_ITEM : 0);
  const stepIndex = () => (session ? session.itemIndex * TOPICS_PER_ITEM + session.topicIndex : 0);

  function paint() {
    const stage = document.querySelector('#drill-stage');
    if (!stage || !session) return;
    const item = session.items[session.itemIndex];
    const topic = item.topics[session.topicIndex] || TOPICS[0];
    const progress = Math.round(stepIndex() / Math.max(totalSteps(), 1) * 100);
    const result = session.attempt?.result;
    const answer = session.attempt?.answer || '';
    stage.innerHTML = `<div class="drill-session">
      <div class="drill-session-top">
        <span>第 ${session.itemIndex + 1} / ${session.items.length} 个 · 话题 ${session.topicIndex + 1} / ${TOPICS_PER_ITEM}</span>
        <span class="card-tag ${item.kind === 'pattern' ? 'pattern' : 'expression'}">${item.kind === 'pattern' ? '句式' : '表达'} · ${e(SOURCE_LABEL[item.source] || '本篇')}</span>
      </div>
      <div class="drill-progress" aria-hidden="true"><span style="width:${progress}%"></span></div>
      <h3 class="drill-pattern-name" lang="en">${e(item.title)}</h3>
      ${item.skeleton ? `<p class="drill-skeleton" lang="en">${e(item.skeleton)}</p>` : ''}
      ${item.kind === 'pattern' ? '' : `<p class="drill-hint">原意：${e(item.meaning || '')}</p>`}
      ${item.sentence ? `<p class="drill-origin" lang="en">原句：${highlight(item.sentence, item.text)}</p>` : ''}
      ${item.tip ? `<p class="drill-hint">${e(item.tip)}</p>` : ''}
      <div class="drill-topic">
        <span class="drill-topic-label">这次写这个话题</span>
        <strong>${e(topic.zh)}</strong>
        <span lang="en">${e(topic.en)}</span>
      </div>
      <label class="sr-only" for="drill-answer">用这个句式写一句英文</label>
      <textarea id="drill-answer" class="drill-input" lang="en" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="400" placeholder="用这个句式，写一句和上面话题有关的英文…" ${result ? 'readonly' : ''}>${e(answer)}</textarea>
      <div class="drill-session-actions">${result
        ? `${session.topicIndex + 1 < TOPICS_PER_ITEM
          ? '<button class="btn btn-primary btn-small" type="button" data-drill-action="next-topic">换个话题再写一句</button>'
          : (session.itemIndex + 1 < session.items.length
            ? '<button class="btn btn-primary btn-small" type="button" data-drill-action="next-item">下一个句式</button>'
            : '<button class="btn btn-primary btn-small" type="button" data-drill-action="finish">看这次结果</button>')}
          <button class="btn btn-ghost btn-small" type="button" data-drill-action="retry">再写一版</button>`
        : `<button class="btn btn-primary btn-small" type="button" data-drill-action="check">检查这一句</button>
           <button class="btn btn-ghost btn-small" type="button" data-drill-action="reveal">看示范句</button>`}
      </div>
      <div class="drill-feedback ${result ? `is-${result.status}` : 'hidden'}" role="status" aria-live="polite">${result ? feedbackMarkup(item, result) : ''}</div>
    </div>`;
    const input = stage.querySelector('#drill-answer');
    if (input && !result) input.focus();
  }

  function feedbackMarkup(item, result) {
    if (result.status === 'revealed') {
      return `<p class="drill-verdict">示范句只是参考。看完之后，照着骨架自己写一句，才算真的会用。</p>
        ${item.kind === 'pattern' ? `<p class="drill-example-label">原句就是这个句式</p><p class="drill-example" lang="en">${highlight(item.sentence || '', item.text)}</p>` : `<p class="drill-example" lang="en">${e(item.example || item.sentence || '')}</p>`}
        <p class="score-note">看答案不计入成绩，之后还会再抽到。</p>`;
    }
    const checks = result.checks.map(check => `<li class="${check.pass ? 'is-pass' : 'is-fail'}">${checkIcon(check.pass)}<span><strong>${e(check.label)}</strong>${check.note ? `<em>${e(check.note)}</em>` : ''}</span></li>`).join('');
    const verdict = result.status === 'correct'
      ? '这句和原句一样的地方是骨架，不一样的地方是你的内容——这就是举一反三。'
      : result.status === 'partial'
        ? '结构已经在路上了，把上面没通过的一条改掉再交一次。'
        : '先别急，照着骨架把空格填满，主谓宾齐全就算成句。';
    // 句式卡的「原句」在上方已经展示过，这里不再重复；表达卡补一个例句。
    const sample = item.kind === 'pattern'
      ? ''
      : (item.example ? `<p class="drill-example-label">这个表达的例句</p><p class="drill-example" lang="en">${e(item.example)}</p>` : '');
    return `<p class="drill-verdict">${verdict}</p>
      <ul class="drill-checks">${checks}</ul>
      ${sample}`;
  }

  function record(item, passed) {
    const entry = store.records[item.id] || { seen: 0, correct: 0, lastAt: 0 };
    store.records[item.id] = { seen: (entry.seen || 0) + 1, correct: (entry.correct || 0) + (passed ? 1 : 0), lastAt: Date.now() };
    store.answered += 1;
    if (passed) store.correct += 1;
  }

  function submit({ reveal = false } = {}) {
    if (!session || session.attempt?.result) return;
    const item = session.items[session.itemIndex];
    const input = document.querySelector('#drill-answer');
    const answer = input?.value || '';
    if (!reveal && !answer.trim()) { input?.focus(); return; }
    const result = reveal ? { status: 'revealed', checks: [] } : gradeDrill(item, answer);
    session.attempt = { answer, result };
    if (!reveal) {
      record(item, result.status === 'correct');
      if (result.status === 'correct') {
        const key = `${item.id}:${session.topicIndex}`;
        if (!session.done.includes(key)) session.done.push(key);
      }
      persist();
      render();
    }
    paint();
  }

  function advance(step) {
    if (!session) return;
    session.attempt = null;
    if (step === 'topic') session.topicIndex += 1;
    else if (step === 'item') { session.itemIndex += 1; session.topicIndex = 0; }
    if (session.itemIndex >= session.items.length) { finish(); return; }
    paint();
  }

  function finish() {
    if (!session) return;
    const total = session.items.length;
    const mastered = new Set(session.done.map(key => key.split(':')[0]));
    store.sessions += 1;
    store.lastAt = Date.now();
    store.lastMissed = session.items.filter(item => !mastered.has(item.id)).slice(0, MAX_LAST_MISSED);
    persist();
    const patterns = session.items.filter(item => item.kind === 'pattern').length;
    session = null;
    const stage = document.querySelector('#drill-stage');
    if (!stage) return;
    const rate = total ? Math.round(mastered.size / total * 100) : 0;
    stage.innerHTML = `<div class="drill-summary">
      <p class="eyebrow">PATTERN PRACTICE</p>
      <h3>${mastered.size} / ${total} 个句式换着话题写出来了</h3>
      <div class="drill-progress" aria-hidden="true"><span style="width:${rate}%"></span></div>
      <p>${rate >= 70
        ? (total > 1 ? '这些句式已经是你的了。下一篇作文里主动用其中两个，才算真正固定下来。' : '这个句式已经是你的了。下一篇作文里主动用一次，才算真正固定下来。')
        : rate >= 40
          ? '骨架记住了，但还不够熟。把没通过的再写一遍，比看十遍讲解有用。'
          : '现在还是“看得懂但写不出”。挑一个句式换三个话题各写一遍，就能明显不一样。'}</p>
      <p class="score-note">本轮的 ${total * TOPICS_PER_ITEM} 次仿写里，${patterns ? `有 ${patterns} 个是可迁移句式` : '以现成表达为主'}，换到下个题目照样能用。</p>
      <div class="drill-session-actions">
        ${store.lastMissed.length ? `<button class="btn btn-primary btn-small" type="button" data-drill-action="retry-missed">再练没写出的 ${store.lastMissed.length} 个</button>` : ''}
        <button class="btn btn-secondary btn-small" type="button" data-drill-action="close">回到作文</button>
      </div>
    </div>`;
    render();
  }

  // 上一次的错题会经过 JSON 存储，正则和骨架必须重新挂回题目上才能再判分。
  function rehydrate(item) {
    if (!item) return null;
    if (item.kind === 'pattern') {
      const pattern = PATTERNS.find(entry => entry.id === item.patternId);
      if (pattern) return { ...item, test: pattern.test, skeleton: item.skeleton || pattern.skeleton, tip: item.tip || pattern.tip };
    }
    return { ...item };
  }

  function retryMissed() {
    const items = Array.isArray(store.lastMissed) ? store.lastMissed.map(rehydrate).filter(Boolean) : [];
    if (!items.length) { options.toast?.('上次的句式都写出来了，直接开始新的一轮吧。'); return; }
    start(items, { review: true });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-drill-action], [data-drill-item]');
    if (!button || button.disabled) return;
    if (button.dataset.drillItem !== undefined) {
      const items = currentItems();
      const item = items[Number(button.dataset.drillItem)];
      if (!item) return;
      start([item]);
      return;
    }
    const action = button.dataset.drillAction;
    if (action === 'start') start(currentItems().slice(0, 3));
    else if (action === 'retry-missed') retryMissed();
    else if (action === 'check') submit();
    else if (action === 'reveal') submit({ reveal: true });
    else if (action === 'retry') { if (session) { session.attempt = null; paint(); } }
    else if (action === 'next-topic') advance('topic');
    else if (action === 'next-item') advance('item');
    else if (action === 'finish') finish();
    else if (action === 'close') options.closeModal?.();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (!event.target.matches?.('#drill-answer')) return;
    // 仿写常常要写多句；只有 Ctrl/Cmd + Enter 才提交，避免把换行当成交卷。
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (!session) return;
    if (session.attempt?.result) advance(session.topicIndex + 1 < TOPICS_PER_ITEM ? 'topic' : 'item');
    else submit();
  });

  render();
  return { render, start, train: (items) => start(items || currentItems().slice(0, 3)) };
}
