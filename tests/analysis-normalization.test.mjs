import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCorrection, normalizeModel } from '../analysis-normalization.mjs';
import { validateCorrection, validateModel, ValidationError } from '../analysis-schema.mjs';

const essay = 'There are several reason to improve buses. It make travel easier for residents.';
const score = () => ({ low: 5.5, high: 6.5, criteria: ['TR', 'CC', 'LR', 'GRA'].map(key => ({ key, band: 6, evidence: '观点清楚，但具体解释不足。', action: '为主要观点补充一个具体例子。' })) });
const expression = (source, text) => ({ id: 'e1', source, text, meaning: '改善公共交通', example: 'Cities can improve public transport.', usage: '用于讨论城市交通政策。' });
function correction() {
  return {
    originalScore: score(),
    corrected: { text: 'There are several reasons to improve buses. It makes travel easier for residents.', score: score() },
    issues: [{ id: 'g1', category: 'grammar', priority: 'essential', original: 'several reason', replacement: 'several reasons', explanation: 'several 后的可数名词需要复数。', practice: { question: 'Correct: several option', answer: 'several options' } }],
    expressions: [expression('corrected', 'improve buses')],
    priorities: [1, 2, 3].map(index => ({ title: `行动 ${index}`, description: '为论点补充具体解释。' })),
  };
}
function model() {
  return { model: { text: 'Public transport can reduce traffic. Cities should invest in reliable buses.', score: score(), notes: [{ quote: 'reduce traffic', label: '结果表达', explanation: '说明改善公共交通的效果。' }] }, expressions: [expression('model', 'reliable buses')] };
}

test('normalization keeps already valid data and IDs unchanged without mutating input', () => {
  for (const [raw, normalize] of [[correction(), value => normalizeCorrection(value, essay)], [model(), normalizeModel]]) {
    const original = structuredClone(raw);
    const result = normalize(raw);
    assert.deepEqual(result, { data: original, warnings: [] });
    assert.deepEqual(raw, original);
    assert.notEqual(raw, result.data);
  }
});

test('aligns whitespace and curly quotes only to a unique exact source slice', () => {
  const raw = correction();
  const source = 'I don’t\r\n  has a car. Public transport matters.';
  raw.corrected.text = 'I don’t\n have a car. Public transport matters.';
  raw.issues[0].original = "don't has a car";
  raw.issues[0].replacement = "don't have a car";
  raw.expressions[0].text = 'Public\ttransport matters';
  const result = normalizeCorrection(raw, source);
  assert.equal(result.data.issues[0].original, 'don’t\r\n  has a car');
  assert.equal(result.data.issues[0].replacement, 'don’t\n have a car');
  assert.equal(result.data.expressions[0].text, 'Public transport matters');
  assert.equal(result.data.corrected.text, raw.corrected.text);
  assert.equal(result.warnings.filter(item => item.code === 'quote_format_normalized').length, 3);
  validateCorrection(result.data, source);
});

test('UTF-16 source mapping remains correct around emoji and non-breaking spaces', () => {
  const raw = model();
  raw.model.text = 'A student says “🙂 buses\u00a0matter” in this example.';
  raw.model.notes[0].quote = '"🙂 buses matter"';
  raw.expressions = [];
  const result = normalizeModel(raw);
  assert.equal(result.data.model.notes[0].quote, '“🙂 buses\u00a0matter”');
  validateModel(result.data);
});

test('normalizes known criterion aliases, order and lossless numeric formatting', () => {
  const raw = correction();
  raw.originalScore.low = '5.5'; raw.originalScore.high = ' 6.50 ';
  raw.originalScore.criteria = [
    { ...score().criteria[3], key: 'grammatical range & accuracy', band: '6.0' },
    { ...score().criteria[2], key: 'Lexical Resource' },
    { ...score().criteria[0], key: 'task response' },
    { ...score().criteria[1], key: '连贯与衔接' },
  ];
  const result = normalizeCorrection(raw, essay);
  assert.deepEqual(result.data.originalScore, score());
  assert(result.warnings.some(item => item.code === 'criterion_order_normalized'));
  assert.deepEqual(normalizeCorrection(result.data, essay), { data: result.data, warnings: [] });
});

test('never fills missing criteria, clamps bands, rounds quarter bands or invents evidence', () => {
  const invalid = [
    data => { data.originalScore.criteria.pop(); },
    data => { data.originalScore.criteria[1].key = 'TR'; },
    data => { data.originalScore.criteria[0].key = 'Task Achievement'; },
    data => { data.originalScore.criteria[0].band = 6.25; },
    data => { data.originalScore.criteria[0].band = '6.25'; },
    data => { data.originalScore.criteria[0].band = '6.0000000000000001'; },
    data => { data.originalScore.criteria[0].band = '10'; },
    data => { data.originalScore.criteria[0].band = null; },
    data => { data.originalScore.criteria[0].band = ''; },
    data => { data.originalScore.low = 8; data.originalScore.high = 6; },
    data => { data.originalScore.criteria[0].evidence = ''; },
    data => { data.originalScore.criteria[0].action = ''; },
    data => { data.corrected.text = ''; },
    data => { data.priorities.pop(); },
  ];
  for (const mutate of invalid) { const raw = correction(); mutate(raw); assert.throws(() => normalizeCorrection(raw, essay), ValidationError); }
  const raw = model(); raw.model.score.criteria[0].band = 9.5;
  assert.throws(() => normalizeModel(raw), ValidationError);
  for (const value of [null, undefined, [], 'not a result']) {
    assert.throws(() => normalizeCorrection(value, essay), ValidationError);
    assert.throws(() => normalizeModel(value), ValidationError);
  }
});

test('drops an unanchored essential annotation while retaining real scores and correction text', () => {
  const raw = correction();
  raw.issues.push({ ...structuredClone(raw.issues[0]), id: 'g2', original: 'invented quote', replacement: 'invented replacement' });
  const result = normalizeCorrection(raw, essay);
  assert.deepEqual(result.data.issues, [raw.issues[0]]);
  assert.deepEqual(result.data.originalScore, raw.originalScore);
  assert.deepEqual(result.data.corrected, raw.corrected);
  assert.equal(result.warnings[0].path, 'issues[1]');
  assert.equal(result.warnings[0].code, 'annotation_dropped');
  assert(!JSON.stringify(result.warnings).includes('invented quote'));
  validateCorrection(result.data, essay);
});

test('does not guess case changes, paraphrases or ambiguous repeated source fragments', () => {
  for (const quote of ['Several reason', 'many reasons', 'several reason']) {
    const raw = correction(); raw.issues[0].original = quote;
    const result = normalizeCorrection(raw, essay + ' There are several reason to build parks.');
    assert.equal(result.data.issues.length, 0);
    assert(result.warnings.some(item => item.code === 'annotation_dropped'));
  }
  const raw = model(); raw.model.text = 'Reliable\n buses are needed. Reliable  buses are useful.';
  raw.model.notes[0].quote = 'Reliable buses'; raw.expressions = [];
  assert.equal(normalizeModel(raw).data.model.notes.length, 0);
});

test('drops broken optional cards and notes instead of discarding an otherwise valid essay', () => {
  const raw = model();
  raw.model.notes.push({ quote: 'not in the text', label: 'example', explanation: 'example' });
  raw.expressions.push({ ...raw.expressions[0], id: 'wrong-source', source: 'corrected' });
  raw.expressions.push({ ...raw.expressions[0], id: 'missing-explanation', meaning: '' });
  const result = normalizeModel(raw);
  assert.equal(result.data.model.notes.length, 1);
  assert.equal(result.data.expressions.length, 1);
  assert.equal(result.warnings.filter(item => item.code === 'annotation_dropped').length, 3);
  assert.deepEqual(result.data.model.score, raw.model.score);
  validateModel(result.data);
});

test('missing auxiliary arrays are empty with warnings while required priorities stay required', () => {
  const raw = correction(); delete raw.issues; raw.expressions = null;
  const result = normalizeCorrection(raw, essay);
  assert.deepEqual(result.data.issues, []); assert.deepEqual(result.data.expressions, []);
  assert.equal(result.warnings.length, 2);
  const independent = model(); delete independent.model.notes; delete independent.expressions;
  assert.equal(normalizeModel(independent).warnings.length, 2);
  delete raw.priorities;
  assert.throws(() => normalizeCorrection(raw, essay), ValidationError);
});

test('missing or duplicate opaque IDs are regenerated and valid IDs survive', () => {
  const raw = correction();
  raw.issues.push({ ...structuredClone(raw.issues[0]), original: 'It make', replacement: 'It makes' });
  delete raw.expressions[0].id;
  const result = normalizeCorrection(raw, essay);
  assert.equal(result.data.issues[0].id, 'g1');
  assert.notEqual(result.data.issues[1].id, 'g1');
  assert.equal(result.data.issues.length, 2);
  assert.equal(typeof result.data.expressions[0].id, 'string');
  validateCorrection(result.data, essay);
});

test('oversized optional arrays are bounded with a visible warning', () => {
  const raw = model();
  raw.model.notes = Array.from({ length: 12 }, () => structuredClone(raw.model.notes[0]));
  const result = normalizeModel(raw);
  assert.equal(result.data.model.notes.length, 8);
  assert(result.warnings.some(item => item.code === 'annotation_limit'));
  validateModel(result.data);
});

test('rejects English-only core feedback with the precise field and Simplified Chinese retry instruction', () => {
  const cases = [
    ['originalScore.criteria[0].evidence', value => { value.originalScore.criteria[0].evidence = 'The position is clear.'; }, correction, value => normalizeCorrection(value, essay)],
    ['originalScore.criteria[1].action', value => { value.originalScore.criteria[1].action = 'Add a supporting example.'; }, correction, value => normalizeCorrection(value, essay)],
    ['corrected.score.criteria[2].evidence', value => { value.corrected.score.criteria[2].evidence = 'The vocabulary is adequate.'; }, correction, value => normalizeCorrection(value, essay)],
    ['corrected.score.criteria[3].action', value => { value.corrected.score.criteria[3].action = 'Use more complex clauses.'; }, correction, value => normalizeCorrection(value, essay)],
    ['priorities[0].title', value => { value.priorities[0].title = 'Develop the argument'; }, correction, value => normalizeCorrection(value, essay)],
    ['priorities[1].description', value => { value.priorities[1].description = 'Explain the cause and provide an example.'; }, correction, value => normalizeCorrection(value, essay)],
    ['model.score.criteria[0].evidence', value => { value.model.score.criteria[0].evidence = 'The response covers the task.'; }, model, normalizeModel],
    ['model.score.criteria[1].action', value => { value.model.score.criteria[1].action = 'Improve the transitions.'; }, model, normalizeModel],
  ];
  for (const [field, mutate, make, normalize] of cases) {
    const raw = make(); mutate(raw);
    const unchanged = structuredClone(raw);
    assert.throws(() => normalize(raw), error => error instanceof ValidationError && error.message.includes(field) && error.message.includes('Simplified Chinese'));
    assert.deepEqual(raw, unchanged, '校验失败不能合成或替换中文反馈');
  }
});

test('Chinese feedback may quote English phrases without translation or alteration', () => {
  const raw = correction();
  raw.originalScore.criteria[0].evidence = '原文的 "improve buses" 观点明确，但缺少展开。';
  raw.corrected.score.criteria[1].action = '在 "It makes travel easier" 后补充原因。';
  raw.priorities[0] = { title: '补充 supporting example', description: '用 for example 引出一个具体场景。' };
  raw.issues[0].explanation = 'several 后应使用复数 reasons。';
  raw.expressions[0].meaning = 'improve 表示改善';
  raw.expressions[0].usage = '用于 public transport 相关话题。';
  assert.deepEqual(normalizeCorrection(raw, essay), { data: raw, warnings: [] });
  const independent = model();
  independent.model.notes[0].label = '结果表达 result';
  independent.model.notes[0].explanation = '用 reduce traffic 表达具体结果。';
  assert.deepEqual(normalizeModel(independent), { data: independent, warnings: [] });
});

test('English-only auxiliary explanations are visibly dropped while valid core feedback survives', () => {
  const cases = [
    ['issues[0].explanation', value => { value.issues[0].explanation = 'Use a plural noun after several.'; }, correction, value => normalizeCorrection(value, essay), result => result.data.issues],
    ['expressions[0].meaning', value => { value.expressions[0].meaning = 'Make the bus service better.'; }, correction, value => normalizeCorrection(value, essay), result => result.data.expressions],
    ['expressions[0].usage', value => { value.expressions[0].usage = 'Use this for public transport.'; }, correction, value => normalizeCorrection(value, essay), result => result.data.expressions],
    ['model.notes[0].label', value => { value.model.notes[0].label = 'Result'; }, model, normalizeModel, result => result.data.model.notes],
    ['model.notes[0].explanation', value => { value.model.notes[0].explanation = 'Explain the outcome of this policy.'; }, model, normalizeModel, result => result.data.model.notes],
    ['expressions[0].meaning', value => { value.expressions[0].meaning = 'Buses that operate consistently.'; }, model, normalizeModel, result => result.data.expressions],
    ['expressions[0].usage', value => { value.expressions[0].usage = 'Use this in a transport discussion.'; }, model, normalizeModel, result => result.data.expressions],
  ];
  for (const [field, mutate, make, normalize, items] of cases) {
    const raw = make(); mutate(raw);
    const result = normalize(raw);
    assert.equal(items(result).length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'annotation_dropped');
    assert.ok(result.warnings[0].message.includes(field));
    assert.ok(result.warnings[0].message.includes('Simplified Chinese'));
    if (raw.model) assert.deepEqual(result.data.model.score, raw.model.score);
    else assert.deepEqual(result.data.originalScore, raw.originalScore);
  }
});

test('the base validators still accept English historical feedback', () => {
  const oldCorrection = correction(), oldModel = model();
  for (const score of [oldCorrection.originalScore, oldCorrection.corrected.score, oldModel.model.score]) {
    for (const criterion of score.criteria) { criterion.evidence = 'Historical English evidence.'; criterion.action = 'Historical English recommendation.'; }
  }
  for (const priority of oldCorrection.priorities) { priority.title = 'Historical title'; priority.description = 'Historical description'; }
  assert.equal(validateCorrection(oldCorrection, essay), oldCorrection);
  assert.equal(validateModel(oldModel), oldModel);
  assert.throws(() => normalizeCorrection(oldCorrection, essay), /Simplified Chinese/);
  assert.throws(() => normalizeModel(oldModel), /Simplified Chinese/);
});
