import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDrills, drillStats, gradeDrill, sentenceAround } from '../public/drills.js';
import { DEMO_ANALYSIS, DEMO_ESSAY } from '../public/demo.js';

const demoDrills = buildDrills({ analysis: DEMO_ANALYSIS, essay: DEMO_ESSAY });

test('sentence extraction keeps the phrase inside a complete sentence', () => {
  const text = 'Roads are useful. Induced demand is a real effect. Cities keep building.';
  assert.equal(sentenceAround(text, 'Induced demand'), 'Induced demand is a real effect.');
  assert.equal(sentenceAround(text, 'missing phrase'), '');
  assert.equal(sentenceAround('First line\nSecond line with target', 'target'), 'Second line with target');
});

test('drills are built from the real phrases and errors of this essay', () => {
  assert.ok(demoDrills.length >= 8, '示例作文应当能生成一组完整的训练题');
  const types = new Set(demoDrills.map(item => item.type));
  assert.deepEqual([...types].sort(), ['cloze', 'fix', 'recall']);
  assert.equal(new Set(demoDrills.map(item => item.id)).size, demoDrills.length, '题目标识必须唯一');
  for (const item of demoDrills) {
    assert.ok(item.prompt && item.answer, `${item.type} 需要题干和答案`);
    assert.ok(!item.prompt.includes(item.answer), `题干不能直接泄露答案：${item.answer}`);
  }
  // 顺序为先认得出、再写得出、最后改得对。
  const order = demoDrills.map(item => item.type);
  assert.ok(order.lastIndexOf('cloze') < order.indexOf('recall'), '填空题应排在中译英之前');
  assert.ok(order.lastIndexOf('recall') < order.indexOf('fix'), '改错题应排在最后');
});

test('drills never quote a phrase that is not in the essay', () => {
  const analysis = structuredClone(DEMO_ANALYSIS);
  analysis.expressions = [...analysis.expressions, { id: 'ghost', text: 'a phrase that was never written', meaning: '不存在的表达', example: 'x', source: 'corrected', usage: 'x' }];
  const drills = buildDrills({ analysis, essay: DEMO_ESSAY });
  assert.ok(!drills.some(item => item.answer === 'a phrase that was never written'));
});

test('an essay without analysis has nothing to practise yet', () => {
  assert.deepEqual(buildDrills({ analysis: null, essay: DEMO_ESSAY }), []);
});

test('grading accepts the exact phrase, flags near misses and rejects unrelated answers', () => {
  const item = demoDrills.find(entry => entry.type === 'recall');
  assert.equal(gradeDrill(item, item.answer).status, 'correct');
  assert.equal(gradeDrill(item, `  ${item.answer.toUpperCase()} .`).status, 'correct', '大小写和句末标点不影响判定');
  assert.equal(gradeDrill(item, '').status, 'empty');
  assert.equal(gradeDrill(item, 'something completely different').status, 'wrong');
  const partial = item.answer.split(' ').slice(0, 1).join(' ');
  assert.notEqual(gradeDrill(item, partial).status, 'correct', '只写一个词不能算答对');
});

test('statistics stay honest before and after the first answer', () => {
  assert.deepEqual(drillStats(null), { answered: 0, correct: 0, rate: 0, missed: 0, sessions: 0 });
  const stats = drillStats({ answered: 8, correct: 6, sessions: 2, lastMissed: [{ answer: 'x' }] });
  assert.equal(stats.rate, 75);
  assert.equal(stats.missed, 1);
});
