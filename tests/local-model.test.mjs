import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLocalModel } from '../local-model.mjs';
import { ProviderError } from '../provider.mjs';
import { validateModel } from '../analysis-schema.mjs';
import { DEMO_ANALYSIS, DEMO_PROMPT } from '../public/demo.js';

const provider = { kind: 'ollama', model: 'test-model', url: 'http://127.0.0.1:11435' };
const input = { provider, prompt: DEMO_PROMPT, targetBand: 7 };
const paragraphs = () => DEMO_ANALYSIS.model.text.split('\n\n');
const review = () => ({ score: structuredClone(DEMO_ANALYSIS.model.score), notes: structuredClone(DEMO_ANALYSIS.model.notes), expressions: structuredClone(DEMO_ANALYSIS.expressions.filter(item => item.source === 'model')) });

test('staged local generation freezes four paragraphs before reviewing and never receives student draft', async () => {
  const calls = [];
  const result = await generateLocalModel({ ...input, essay: 'SECRET STUDENT DRAFT', complete: async (actualProvider, options) => {
    assert.equal(actualProvider, provider);
    calls.push(options);
    if (calls.length === 1) return { paragraphs: paragraphs() };
    const response = review(); response.model = { text: 'A replacement essay that must never be used.' };
    return response;
  } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].schema.properties.paragraphs.minItems, 4);
  assert.equal(calls[0].schema.properties.paragraphs.maxItems, 4);
  assert(!JSON.stringify(calls).includes('SECRET STUDENT DRAFT'));
  assert(calls[1].prompt.includes(JSON.stringify(DEMO_ANALYSIS.model.text)));
  assert.equal(result.data.model.text, DEMO_ANALYSIS.model.text);
  assert.deepEqual(result.data.model.score, DEMO_ANALYSIS.model.score);
  validateModel(result.data);
});

test('short essay triggers a precise word-count retry before any score request', async () => {
  const calls = [];
  const short = ['Public transport matters.', 'Buses can serve workers.', 'Trains can help students.', 'Governments should invest wisely.'];
  const result = await generateLocalModel({ ...input, complete: async (_provider, options) => {
    calls.push(options);
    if (calls.length === 1) return { paragraphs: short };
    if (calls.length === 2) return { paragraphs: paragraphs() };
    return review();
  } });
  assert.equal(calls.length, 3);
  assert(calls[1].prompt.includes('15 English words (paragraph counts: 3, 4, 4, 4)'));
  assert(calls[1].schema.properties.paragraphs);
  assert(calls[2].schema.properties.score);
  validateModel(result.data);
});

test('does not pad, duplicate, or silently accept a persistently short local essay', async () => {
  let calls = 0;
  await assert.rejects(generateLocalModel({ ...input, complete: async () => { calls++; return { paragraphs: ['First short paragraph.', 'Second short paragraph.', 'Third short paragraph.', 'Fourth short paragraph.'] }; } }), error => error instanceof ProviderError && error.status === 502);
  assert.equal(calls, 2);
});

test('repeated paragraphs and malformed paragraph layouts are rejected before review', async () => {
  for (const invalid of [
    { paragraphs: Array(4).fill(paragraphs()[1]) },
    { paragraphs: [DEMO_ANALYSIS.model.text] },
    { paragraphs: [paragraphs()[0] + '\n\n' + paragraphs()[1], ...paragraphs().slice(1)] },
    { paragraphs: [null, ...paragraphs().slice(1)] },
    { paragraphs: ['中文段落', ...paragraphs().slice(1)] },
  ]) {
    let calls = 0;
    await assert.rejects(generateLocalModel({ ...input, complete: async () => { calls++; return invalid; } }), error => error instanceof ProviderError && error.status === 502);
    assert.equal(calls, 2);
  }
});

test('invalid core score retries only the review stage and never invents missing criteria', async () => {
  const calls = [];
  const result = await generateLocalModel({ ...input, complete: async (_provider, options) => {
    calls.push(options);
    if (calls.length === 1) return { paragraphs: paragraphs() };
    const result = review(); if (calls.length === 2) result.score.criteria.pop();
    return result;
  } });
  assert.equal(calls.length, 3);
  assert(calls[2].prompt.includes('Exactly four score criteria required'));
  assert(calls[1].prompt.includes(JSON.stringify(result.data.model.text)));
  assert(calls[2].prompt.includes(JSON.stringify(result.data.model.text)));
  assert.deepEqual(result.data.model.score, DEMO_ANALYSIS.model.score);
  let invalidCalls = 0;
  await assert.rejects(generateLocalModel({ ...input, complete: async () => {
    invalidCalls++; if (invalidCalls === 1) return { paragraphs: paragraphs() };
    const result = review(); result.score.criteria[0].band = 8.25; return result;
  } }), error => error instanceof ProviderError && error.status === 502);
  assert.equal(invalidCalls, 3);
});

test('optional annotation failure becomes a warning without rewriting the accepted model essay', async () => {
  let calls = 0;
  const result = await generateLocalModel({ ...input, complete: async () => {
    calls++; if (calls === 1) return { paragraphs: paragraphs() };
    const value = review(); value.notes[0].quote = 'This quote is not in the essay.'; return value;
  } });
  assert.equal(calls, 2);
  assert.equal(result.data.model.text, DEMO_ANALYSIS.model.text);
  assert(result.warnings.some(item => item.code === 'annotation_dropped'));
  validateModel(result.data);
});

test('already cancelled and cancellation between stages prevent any further model request', async () => {
  let calls = 0;
  await assert.rejects(generateLocalModel({ ...input, signal: AbortSignal.abort(), complete: async () => { calls++; } }), error => error.status === 499);
  assert.equal(calls, 0);
  const controller = new AbortController();
  await assert.rejects(generateLocalModel({ ...input, signal: controller.signal, complete: async (_provider, options) => {
    calls++; assert.equal(options.signal, controller.signal); controller.abort(); return { paragraphs: paragraphs() };
  } }), error => error.status === 499);
  assert.equal(calls, 1);
});

test('provider authentication and transport errors are never turned into content retries', async () => {
  for (const status of [401, 429, 503, 504]) {
    let calls = 0;
    await assert.rejects(generateLocalModel({ ...input, complete: async () => { calls++; throw new ProviderError(status, 'provider unavailable'); } }), error => error.status === status);
    assert.equal(calls, 1);
  }
});
