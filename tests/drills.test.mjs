import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWordbank, drillStats, gradeDrill, sentenceAround } from '../public/drills.js';
import { DEMO_ANALYSIS, DEMO_ESSAY } from '../public/demo.js';

const bank = buildWordbank({ analysis: DEMO_ANALYSIS, essay: DEMO_ESSAY });

// 构造一份最小的批改结果，只用来验证句式识别。
function analysisWith(expressions, notes = []) {
  const text = expressions.map(item => item.example).join(' ');
  return {
    corrected: { text, score: { criteria: [] } },
    model: { text, score: { criteria: [] }, notes },
    expressions,
    issues: [],
  };
}

test('sentence extraction keeps the phrase inside a complete sentence', () => {
  const text = 'Roads are useful. Induced demand is a real effect. Cities keep building.';
  assert.equal(sentenceAround(text, 'Induced demand'), 'Induced demand is a real effect.');
  assert.equal(sentenceAround(text, 'missing phrase'), '');
  assert.equal(sentenceAround('First line\nSecond line with target', 'target'), 'Second line with target');
});

test('the wordbank takes real material out of this essay and nothing else', () => {
  assert.ok(bank.length >= 4, '示例作文应当能生成一组可仿写的句子');
  assert.equal(new Set(bank.map(item => item.id)).size, bank.length, '每张卡片必须有唯一标识');
  assert.ok(bank.some(item => item.kind === 'pattern'), '示例里至少识别出一个可迁移句式');
  for (const item of bank) {
    assert.ok(item.text && item.meaning, '卡片要有英文原文和中文释义');
    assert.ok(item.sentence.includes(item.text), `原句必须包含要教的片段：${item.text}`);
    assert.ok(['corrected', 'model'].includes(item.source));
    assert.equal(item.topics.length, 3, '每个句式要准备三个可替换的话题');
    assert.equal(new Set(item.topics.map(topic => topic.zh)).size, 3, '三个话题必须互不相同');
  }
});

test('the wordbank never quotes a phrase that is not in the essay', () => {
  const analysis = structuredClone(DEMO_ANALYSIS);
  analysis.expressions = [...analysis.expressions, { id: 'ghost', text: 'a phrase that was never written', meaning: '不存在的表达', example: 'x', source: 'corrected', usage: 'x' }];
  const items = buildWordbank({ analysis, essay: DEMO_ESSAY });
  assert.ok(!items.some(item => item.text === 'a phrase that was never written'));
});

test('an essay without analysis has nothing to practise yet', () => {
  assert.deepEqual(buildWordbank({ analysis: null, essay: DEMO_ESSAY }), []);
});

const EASIER = {
  id: 'e1', text: 'Frequent buses', meaning: '班次密集的公交车',
  example: 'Frequent buses make it easier for commuters to leave their cars at home.',
  usage: '用于交通服务。', source: 'corrected',
};
const easierItem = buildWordbank({ analysis: analysisWith([EASIER]) })[0];

test('a recognised sentence pattern becomes a transferable skeleton', () => {
  assert.ok(easierItem, '含 make it easier for 的句子应当被识别为句式');
  assert.equal(easierItem.kind, 'pattern');
  assert.equal(easierItem.patternId, 'make-it-easier');
  assert.match(easierItem.skeleton, /makes it easier for/);
  assert.ok(easierItem.test instanceof RegExp);
  assert.equal(easierItem.text, 'Frequent buses', '卡片仍然指向原文里真实存在的表达');
});

test('softer patterns are also recognised: not only … but also, while, the more', () => {
  const cases = [
    ['Not only do bikes reduce pollution, but they also keep riders fit.', 'not-only-but-also'],
    ['While remote work saves commuting time, it blurs the line between work and rest.', 'while-contrast'],
    ['The more students a class has, the less attention each of them receives.', 'the-more'],
  ];
  for (const [example, expected] of cases) {
    const items = buildWordbank({
      analysis: analysisWith([{ id: expected, text: example.split(' ').slice(0, 3).join(' '), meaning: '示例', example, usage: '示例', source: 'corrected' }]),
    });
    assert.equal(items[0]?.patternId, expected, `未识别出句式：${example}`);
  }
});

test('grading accepts a new sentence built on the same skeleton', () => {
  const answer = 'Online booking systems make it easier for patients to see a doctor quickly.';
  const result = gradeDrill(easierItem, answer);
  assert.equal(result.status, 'correct', JSON.stringify(result.checks));
  assert.equal(result.checks.length, 3);
});

test('grading explains exactly what is missing instead of a plain 对/错', () => {
  const item = easierItem;
  const short = gradeDrill(item, 'Cities are busy.');
  assert.notEqual(short.status, 'correct');
  assert.equal(short.checks.find(check => check.key === 'sentence').pass, false);
  assert.match(short.checks.find(check => check.key === 'sentence').note, /至少|句首|句末/);

  const unrelated = gradeDrill(item, 'I like apples and oranges very much today.');
  assert.equal(unrelated.checks.find(check => check.key === 'pattern').pass, false);

  const copied = gradeDrill(item, item.sentence);
  assert.equal(copied.checks.find(check => check.key === 'own').pass, false);
});

test('empty answers and word-form changes are handled honestly', () => {
  assert.equal(gradeDrill(easierItem, '   ').status, 'empty');
  const expression = buildWordbank({
    analysis: analysisWith([{
      id: 'e2', text: 'limited incomes', meaning: '收入有限的',
      example: 'Affordable fares matter for families with limited incomes.',
      usage: '放在名词后补充说明。', source: 'corrected',
    }]),
  })[0];
  assert.equal(expression.kind, 'expression');
  // 词形变化（income → incomes 之外的单复数变化）仍然算用上了表达。
  const answer = 'Many families with limited income struggle to pay rent every month.';
  assert.equal(gradeDrill(expression, answer).checks.find(check => check.key === 'pattern').pass, true);
  const unrelated = 'The weather in this city changes very quickly in spring.';
  assert.equal(gradeDrill(expression, unrelated).checks.find(check => check.key === 'pattern').pass, false);
});

test('a stored item loses its RegExp but still grades without throwing', () => {
  const stored = JSON.parse(JSON.stringify(easierItem));
  const result = gradeDrill(stored, 'Universities are now more careful about class size.');
  assert.ok(['correct', 'partial', 'wrong'].includes(result.status));
});

test('statistics stay honest before and after the first answer', () => {
  assert.deepEqual(drillStats(null), { answered: 0, correct: 0, rate: 0, missed: 0, sessions: 0, mastered: 0 });
  const stats = drillStats({
    answered: 8, correct: 6, sessions: 2, lastMissed: [{ id: 'x' }],
    records: { a: { correct: 2 }, b: { correct: 1 } },
  });
  assert.equal(stats.rate, 75);
  assert.equal(stats.missed, 1);
  assert.equal(stats.mastered, 1, '同一个句式写对两次才算掌握');
});
