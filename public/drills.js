// 好词好句训练：全部题目在本地由已完成的批改结果生成，不额外调用 AI，
// 因此离线、免费，且和这次作文里的真实表达一一对应。
import { escapeHtml as e, makeCardId, normalizeAnswer } from './utils.js';

export const DRILL_TYPES = {
  cloze: { label: '原文填空', instruction: '把空格补成原文里的表达。', tone: 'expression' },
  recall: { label: '看中文写英文', instruction: '根据中文释义，写出作文里的那个表达。', tone: 'expression' },
  fix: { label: '改错回炉', instruction: '按提示把这句话改成正确的写法。', tone: 'grammar' },
};

const STORAGE_KEY = 'jujin.drill.v1';
const MAX_LAST_MISSED = 12;
const FIX_HINTS = {
  grammar: '语法题：注意主谓一致、时态、冠词和介词搭配。',
  spelling: '拼写题：这句话里有一个拼错的单词。',
  vocabulary: '搭配题：这里有一个不自然或错误的词，想想更常见的搭配。',
  logic: '逻辑题：这句话的论证或衔接有问题，想想它和前后文的关系。',
};

function tokens(value) {
  return normalizeAnswer(value).match(/[a-z0-9']+/gu) || [];
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

/**
 * 从一份完整分析结果生成本次训练题。
 * 顺序刻意安排为「先认得出 → 再写得出 → 最后改得对」。
 */
export function buildDrills({ analysis, essay } = {}, { expressions = 4, issues = 3 } = {}) {
  if (!analysis) return [];
  const correctedText = analysis.corrected?.text || '';
  const modelText = analysis.model?.text || '';
  const sourceText = item => item.source === 'model' ? modelText : correctedText;
  const list = [];
  const seen = new Set();
  const push = item => { if (!seen.has(item.id)) { seen.add(item.id); list.push(item); } };

  const usable = (analysis.expressions || []).filter(item => item?.text && sourceText(item).includes(item.text));
  for (const item of usable.slice(0, expressions)) {
    const sentence = sentenceAround(sourceText(item), item.text);
    if (!sentence || !sentence.includes(item.text)) continue;
    push({
      id: makeCardId('cloze', item.text), type: 'cloze',
      prompt: sentence.replace(item.text, '________'),
      answer: item.text,
      hint: `释义：${item.meaning}`,
      detail: item.usage,
      context: sentence,
      tag: item.source === 'model' ? '来自范文' : '来自精修版本',
    });
  }
  for (const item of usable.slice(0, expressions)) {
    push({
      id: makeCardId('recall', item.text), type: 'recall',
      prompt: item.meaning,
      answer: item.text,
      hint: `用法：${item.usage}`,
      detail: `原句：${sentenceAround(sourceText(item), item.text) || item.text}`,
      context: sentenceAround(sourceText(item), item.text),
      tag: item.source === 'model' ? '来自范文' : '来自精修版本',
    });
  }
  const fixable = (analysis.issues || []).filter(issue => issue?.replacement && issue.replacement !== issue.original);
  for (const issue of fixable.slice(0, issues)) {
    const sentence = sentenceAround(essay, issue.original) || issue.original;
    // 只挖掉错误片段，避免整句重写；提示只给规则方向，答案留到判分后再看。
    const prompt = sentence.includes(issue.original) ? sentence.replace(issue.original, '________') : sentence;
    const corrected = sentenceAround(correctedText, issue.replacement);
    push({
      id: makeCardId('fix', issue.original), type: 'fix',
      prompt,
      answer: issue.replacement,
      hint: FIX_HINTS[issue.category] || FIX_HINTS.grammar,
      detail: `原句：${sentence}${corrected && corrected !== sentence ? `　改后：${corrected}` : ''}`,
      context: sentence,
      tag: issue.priority === 'essential' ? '必须改' : '可优化',
      category: issue.category,
      explanation: issue.explanation,
    });
  }
  return list;
}

export function gradeDrill(item, answer) {
  const given = normalizeAnswer(answer);
  if (!given) return { status: 'empty' };
  const expected = normalizeAnswer(item.answer);
  if (given === expected) return { status: 'correct' };
  if (given.includes(expected) && expected.length >= 4) return { status: 'correct', via: 'contains' };
  const expectedTokens = tokens(item.answer);
  const givenTokens = tokens(answer);
  let matched = 0;
  for (let i = 0; i < expectedTokens.length; i++) if (givenTokens[i] === expectedTokens[i]) matched++;
  const ratio = expectedTokens.length ? matched / expectedTokens.length : 0;
  // 只差一两处拼写或虚词时，不要简单判错：提示“接近”并给出标准答案。
  return { status: ratio >= 0.6 ? 'close' : 'wrong', ratio };
}

export function drillStats(store) {
  const answered = Number(store?.answered) || 0;
  const correct = Number(store?.correct) || 0;
  return {
    answered,
    correct,
    rate: answered ? Math.round(correct / answered * 100) : 0,
    missed: Array.isArray(store?.lastMissed) ? store.lastMissed.length : 0,
    sessions: Number(store?.sessions) || 0,
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
        lastMissed: Array.isArray(raw.lastMissed) ? raw.lastMissed.filter(item => item && typeof item.answer === 'string').slice(0, MAX_LAST_MISSED) : [],
        records: raw.records && typeof raw.records === 'object' ? raw.records : {},
      };
    }
  } catch { /* 损坏的训练记录不应阻止写作，重置为空即可。 */ }
  return { version: 1, answered: 0, correct: 0, sessions: 0, lastAt: 0, lastMissed: [], records: {} };
}

export function initDrill(options = {}) {
  const section = document.querySelector('#drill-section');
  if (!section) return { render: () => {}, start: () => {} };
  const storage = options.storage || window.localStorage;
  let store = loadStore(storage);
  let session = null;

  const persist = () => {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(store)); }
    catch { /* 存不下时训练仍可继续，只是不累计统计。 */ }
  };

  function render() {
    const state = options.getState?.() || {};
    const drills = buildDrills({ analysis: state.analysis, essay: state.essay });
    const stats = drillStats(store);
    const disabled = !drills.length || state.busy;
    section.innerHTML = `<div class="drill-card">
      <div class="drill-copy">
        <p class="eyebrow">WRITE IT, THEN OWN IT</p>
        <h2 id="drill-heading">好词好句训练</h2>
        <p>${drills.length
          ? `从这篇的精修稿和范文里取 ${drills.length} 个真实好表达，做成填空、中译英和改错。做完再回自己的作文里用一次，才算真的学会。`
          : '完成一次分析后，这里会用你这篇作文里的好词好句出题：先填空，再看中文写英文，最后改错。题目只从你自己的作文里提取，不额外调用 AI。'}</p>
      </div>
      <div class="drill-metrics">
        <div><strong>${stats.answered}</strong><span>累计作答</span></div>
        <div><strong>${stats.answered ? `${stats.rate}%` : '—'}</strong><span>一次答对率</span></div>
        <div><strong>${stats.missed}</strong><span>上次错题</span></div>
      </div>
      <div class="drill-actions">
        <button class="btn btn-primary" type="button" data-drill-action="start" ${disabled ? 'disabled' : ''}>开始训练${drills.length ? ` · ${drills.length} 题` : ''}</button>
        <button class="btn btn-secondary" type="button" data-drill-action="retry-missed" ${state.busy || !stats.missed ? 'disabled' : ''}>再练上次错的</button>
      </div>
      ${drills.length ? '' : '<p class="drill-empty">还没有可训练的题目。先粘贴作文并完成一次分析。</p>'}
    </div>`;
  }

  function currentDrills() {
    const state = options.getState?.() || {};
    return buildDrills({ analysis: state.analysis, essay: state.essay });
  }

  function start(items, { review = false } = {}) {
    if (!items?.length) { options.toast?.('还没有可用于训练的题目，先完成一次分析。'); return; }
    session = { items, index: 0, answered: false, results: [], review };
    options.openModal?.(review ? '再练上次错的题' : '好词好句训练', '<div id="drill-stage"></div>');
    paint();
  }

  function paint() {
    const stage = document.querySelector('#drill-stage');
    if (!stage || !session) return;
    const item = session.items[session.index];
    const meta = DRILL_TYPES[item.type] || DRILL_TYPES.cloze;
    const result = session.results[session.index];
    const total = session.items.length;
    const progress = Math.round((session.index + (result ? 1 : 0)) / total * 100);
    const saved = session.answers?.[session.index] || '';
    stage.innerHTML = `<div class="drill-session">
      <div class="drill-session-top"><span>第 ${session.index + 1} / ${total} 题</span><span class="card-tag ${meta.tone}">${e(meta.label)} · ${e(item.tag || '本篇')}</span></div>
      <div class="drill-progress" aria-hidden="true"><span style="width:${progress}%"></span></div>
      <p class="drill-instruction">${e(meta.instruction)}</p>
      <blockquote class="drill-sentence" lang="en">${e(item.prompt)}</blockquote>
      <p class="drill-hint">${e(item.hint || '')}</p>
      <label class="sr-only" for="drill-answer">你的答案</label>
      <input id="drill-answer" class="drill-input" lang="en" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="400" placeholder="在这里写下你的答案…" value="${e(saved)}" ${result ? 'readonly' : ''}>
      <div class="drill-session-actions">${result
        ? `<button class="btn btn-primary btn-small" type="button" data-drill-action="next">${session.index + 1 === total ? '看本次结果' : '下一题'}</button>`
        : `<button class="btn btn-primary btn-small" type="button" data-drill-action="check">检查答案</button><button class="btn btn-ghost btn-small" type="button" data-drill-action="reveal">不确定，看答案</button>`}
      </div>
      <div class="drill-feedback ${result ? `is-${result.status}` : 'hidden'}" role="status" aria-live="polite">${result ? feedbackMarkup(item, result) : ''}</div>
    </div>`;
    const input = stage.querySelector('#drill-answer');
    if (input && !result) input.focus();
  }

  function feedbackMarkup(item, result) {
    const explanation = item.explanation ? `<p class="drill-detail">${e(item.explanation)}</p>` : '';
    if (result.status === 'correct') {
      return `<strong>${result.via === 'contains' ? '用上了这个表达。' : '答对了。'}</strong><p lang="en">${e(item.answer)}</p>${item.detail ? `<p class="drill-detail" lang="en">${e(item.detail)}</p>` : ''}${explanation}`;
    }
    if (result.status === 'revealed') {
      return `<strong>参考答案</strong><p lang="en">${e(item.answer)}</p>${item.detail ? `<p class="drill-detail" lang="en">${e(item.detail)}</p>` : ''}${explanation}<span class="score-note">看过答案也算一次作答，之后还会再抽到。</span>`;
    }
    if (result.status === 'close') {
      return `<strong>差一点，注意拼写或词形。</strong><p lang="en">${e(item.answer)}</p>${explanation}<span class="score-note">这次记为未答对；下一篇作文里主动用一次，会记得更牢。</span>`;
    }
    return `<strong>参考答案</strong><p lang="en">${e(item.answer)}</p>${item.detail ? `<p class="drill-detail" lang="en">${e(item.detail)}</p>` : ''}${explanation}`;
  }

  function submit({ reveal = false } = {}) {
    if (!session || session.results[session.index]) return;
    const item = session.items[session.index];
    const input = document.querySelector('#drill-answer');
    const answer = input?.value || '';
    if (!reveal && !answer.trim()) { input?.focus(); return; }
    session.answers = session.answers || {};
    session.answers[session.index] = answer;
    const result = reveal ? { status: 'revealed' } : gradeDrill(item, answer);
    session.results[session.index] = result;
    store.answered += 1;
    const passed = result.status === 'correct';
    if (passed) store.correct += 1;
    store.records[item.id] = { seen: (store.records[item.id]?.seen || 0) + 1, correct: (store.records[item.id]?.correct || 0) + (passed ? 1 : 0), lastAt: Date.now() };
    persist();
    paint();
    render();
  }

  function next() {
    if (!session) return;
    if (session.index + 1 >= session.items.length) { finish(); return; }
    session.index += 1;
    paint();
  }

  function finish() {
    if (!session) return;
    const total = session.items.length;
    const correct = session.results.filter(item => item?.status === 'correct').length;
    const missed = session.items.filter((_, index) => session.results[index]?.status !== 'correct');
    store.sessions += 1;
    store.lastAt = Date.now();
    store.lastMissed = missed.slice(0, MAX_LAST_MISSED);
    persist();
    session = null;
    const stage = document.querySelector('#drill-stage');
    if (!stage) return;
    const rate = total ? Math.round(correct / total * 100) : 0;
    stage.innerHTML = `<div class="drill-summary">
      <p class="eyebrow">SESSION COMPLETE</p>
      <h3>${correct} / ${total} 题一次答对</h3>
      <div class="drill-progress" aria-hidden="true"><span style="width:${rate}%"></span></div>
      <p>${rate >= 80 ? '这些表达已经能认出来、写出来了。下一篇作文里主动用 2 个，才算真正掌握。' : rate >= 50 ? '认识了一半，剩下的一半正是下次作文最容易卡住的地方。' : '先别急，错题会留在这里，再练一遍比看十遍有用。'}</p>
      ${missed.length ? `<div class="drill-missed"><h4>需要再看一眼</h4>${missed.map(item => `<div class="drill-missed-item"><span class="card-tag ${DRILL_TYPES[item.type]?.tone || 'expression'}">${e(DRILL_TYPES[item.type]?.label || '表达')}</span><p lang="en">${e(item.answer)}</p></div>`).join('')}</div>` : ''}
      <div class="drill-session-actions">
        ${missed.length ? `<button class="btn btn-primary btn-small" type="button" data-drill-action="retry-missed">再练这 ${missed.length} 题</button>` : ''}
        <button class="btn btn-secondary btn-small" type="button" data-drill-action="close">回到作文</button>
      </div>
    </div>`;
    render();
  }

  function retryMissed() {
    const items = Array.isArray(store.lastMissed) ? store.lastMissed : [];
    if (!items.length) { options.toast?.('上一次全部答对了，直接开始新的一轮吧。'); return; }
    start(items.map(item => ({ ...item })), { review: true });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-drill-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.drillAction;
    if (action === 'start') start(currentDrills());
    else if (action === 'retry-missed') retryMissed();
    else if (action === 'check') submit();
    else if (action === 'reveal') submit({ reveal: true });
    else if (action === 'next') next();
    else if (action === 'close') options.closeModal?.();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (!event.target.matches?.('#drill-answer')) return;
    event.preventDefault();
    if (!session) return;
    if (session.results[session.index]) next();
    else submit();
  });

  render();
  return { render, start };
}
