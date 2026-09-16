const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const array = items => ({ type: 'array', items });
const enumeration = values => ({ type: 'string', enum: values });

export const scoreSchema = object({
  low: { type: 'number' }, high: { type: 'number' },
  criteria: array(object({ key: enumeration(['TR', 'CC', 'LR', 'GRA']), band: { type: 'number' }, evidence: string, action: string }))
});
const expressionSchema = object({ id: string, text: string, meaning: string, example: string, source: enumeration(['corrected', 'model']), usage: string });
export const correctionSchema = object({
  originalScore: scoreSchema,
  corrected: object({ text: string, score: scoreSchema }),
  issues: array(object({ id: string, category: enumeration(['grammar', 'vocabulary', 'logic', 'spelling']), original: string, replacement: string, explanation: string, priority: enumeration(['essential', 'optional']), practice: object({ question: string, answer: string }) })),
  expressions: array(expressionSchema),
  priorities: array(object({ title: string, description: string }))
});
export const modelSchema = object({
  model: object({ text: string, score: scoreSchema, notes: array(object({ quote: string, label: string, explanation: string })) }),
  expressions: array(expressionSchema)
});

export class ValidationError extends Error {}
const assert = (condition, message) => { if (!condition) throw new ValidationError(message); };
function text(value, name, max = 12000) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${name} must be a non-empty string up to ${max} characters`);
}
const band = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 9 && Number.isInteger(value * 2);
function uniqueQuote(source, quote, name) {
  const first = source.indexOf(quote);
  assert(first >= 0, `${name} not found in source`);
  assert(first === source.lastIndexOf(quote), `${name} must be unique in its source; include more surrounding context`);
}
export function validateScore(score) {
  assert(score && band(score.low) && band(score.high) && score.low <= score.high, 'Invalid score range');
  assert(Array.isArray(score.criteria) && score.criteria.length === 4, 'Exactly four score criteria required');
  const keys = new Set();
  for (const criterion of score.criteria) {
    assert(criterion && ['TR', 'CC', 'LR', 'GRA'].includes(criterion.key) && !keys.has(criterion.key), 'Invalid or duplicate criterion');
    keys.add(criterion.key);
    assert(band(criterion.band), 'Invalid criterion band');
    text(criterion.evidence, 'evidence', 2000); text(criterion.action, 'action', 2000);
  }
}
function validateExpressions(expressions, source, sourceText, maximum) {
  assert(Array.isArray(expressions) && expressions.length <= maximum, 'Too many expressions');
  const ids = new Set();
  for (const expression of expressions) {
    text(expression?.id, 'expression id', 100);
    assert(!ids.has(expression.id), 'Duplicate expression id'); ids.add(expression.id);
    text(expression.text, 'expression text', 600);
    assert(expression.source === source, 'Invalid expression source');
    uniqueQuote(sourceText, expression.text, 'Expression');
    text(expression.meaning, 'meaning', 1000); text(expression.example, 'example', 2000); text(expression.usage, 'usage', 1500);
  }
}
export function validateCorrection(result, essay) {
  assert(result && typeof result === 'object', 'Missing correction');
  validateScore(result.originalScore);
  text(result.corrected?.text, 'corrected text', 16000); validateScore(result.corrected.score);
  assert(Array.isArray(result.issues) && result.issues.length <= 12, 'At most twelve issues required');
  const ids = new Set();
  for (const issue of result.issues) {
    text(issue?.id, 'issue id', 100); assert(!ids.has(issue.id), 'Duplicate issue id'); ids.add(issue.id);
    assert(['grammar', 'vocabulary', 'logic', 'spelling'].includes(issue.category), 'Invalid issue category');
    assert(['essential', 'optional'].includes(issue.priority), 'Invalid issue priority');
    text(issue.original, 'original fragment', 2000); text(issue.replacement, 'replacement fragment', 2000);
    uniqueQuote(essay, issue.original, 'Original issue');
    uniqueQuote(result.corrected.text, issue.replacement, 'Replacement');
    text(issue.explanation, 'explanation', 2000); text(issue.practice?.question, 'practice question', 1500); text(issue.practice.answer, 'practice answer', 1500);
  }
  assert(Array.isArray(result.priorities) && result.priorities.length === 3, 'Exactly three priorities required');
  for (const item of result.priorities) { text(item?.title, 'priority title', 200); text(item.description, 'priority description', 2000); }
  validateExpressions(result.expressions, 'corrected', result.corrected.text, 4);
  return result;
}
export function validateModel(result) {
  assert(result && typeof result === 'object', 'Missing model essay');
  text(result.model?.text, 'model text', 10000); validateScore(result.model.score);
  assert(Array.isArray(result.model.notes) && result.model.notes.length <= 8, 'Too many model notes');
  for (const note of result.model.notes) {
    text(note?.quote, 'model quote', 1800); uniqueQuote(result.model.text, note.quote, 'Model note');
    text(note.label, 'note label', 200); text(note.explanation, 'note explanation', 1800);
  }
  validateExpressions(result.expressions, 'model', result.model.text, 4);
  return result;
}
export function validateAnalysis(result, essay) {
  assert(result && Array.isArray(result.expressions) && result.expressions.length <= 8, 'At most eight expressions required');
  assert(result.expressions.every(item => ['model', 'corrected'].includes(item.source)), 'Invalid expression source');
  assert(new Set(result.expressions.map(item => item.id)).size === result.expressions.length, 'Duplicate expression id');
  validateCorrection({ ...result, expressions: result.expressions.filter(item => item.source === 'corrected') }, essay);
  validateModel({ model: result.model, expressions: result.expressions.filter(item => item.source === 'model') });
  return result;
}

export function validateRequest(body) {
  assert(body && typeof body === 'object' && !Array.isArray(body), '请提交有效的题目和作文。');
  assert(typeof body.prompt === 'string' && body.prompt.trim().length >= 10 && body.prompt.length <= 5000, '题目需要 10–5000 个字符。');
  assert(typeof body.essay === 'string' && body.essay.trim().length >= 30 && body.essay.length <= 16000, '作文需要 30–16000 个字符。');
  assert(typeof body.targetBand === 'number' && body.targetBand >= 4 && body.targetBand <= 9 && Number.isInteger(body.targetBand * 2), '目标分数应为 4–9 分，每 0.5 分一档。');
  return { prompt: body.prompt.trim(), essay: body.essay.trim(), targetBand: body.targetBand };
}
