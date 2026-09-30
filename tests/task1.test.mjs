import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { validateRequest, schemasForTask, validateTaskScores, validateAnalysis } from '../analysis-schema.mjs';
import { normalizeCorrection, normalizeModel } from '../analysis-normalization.mjs';
import { buildCorrectionPrompt, buildLocalCorrectionPrompt, buildModelPrompt, analyzeWriting } from '../server.mjs';
import { generateLocalModel } from '../local-model.mjs';
import { getProviderOverride, setProviderOverride, setCloudConfig } from '../provider.mjs';
import { DEMO_ANALYSIS } from '../public/demo.js';
import { academicInput, generalInput } from './task1-fixtures.mjs';
import { countWords } from '../public/utils.js';

const score = () => { const s=structuredClone(DEMO_ANALYSIS.model.score); s.criteria[0].key='TA'; return s; };
const correction = input => ({originalScore:score(),corrected:{text:input.essay,score:score()},issues:[],expressions:[],priorities:structuredClone(DEMO_ANALYSIS.priorities)});
const model = input => ({model:{text:input.essay,score:score(),notes:[]},expressions:[]});

test('Task 1 requests require a known subtype and independent chart material',()=>{
  assert.equal(validateRequest(academicInput).taskType,'task1-academic');
  assert.equal(validateRequest(generalInput).taskType,'task1-general');
  for (const taskData of ['', 'short', null, 42]) assert.throws(()=>validateRequest({...academicInput,taskData}));
  assert.throws(()=>validateRequest({...generalInput,taskType:'task1'}));
  assert.equal(validateRequest({...generalInput,taskData:'irrelevant chart data'}).taskData,'');
  assert.throws(()=>validateRequest({...academicInput,taskData:'a'.repeat(10001)}));
});

test('Task 1 uses TA without mutating Task 2 schemas; mixed or incorrect criteria fail',()=>{
  const ta=schemasForTask('task1-academic');
  assert.deepEqual(ta.score.properties.criteria.items.properties.key.enum,['TA','CC','LR','GRA']);
  assert.deepEqual(schemasForTask().score.properties.criteria.items.properties.key.enum,['TR','CC','LR','GRA']);
  const raw=correction(academicInput);
  raw.originalScore.criteria[0].key='Task Achievement';
  assert.equal(normalizeCorrection(raw,academicInput.essay,'task1-academic').data.originalScore.criteria[0].key,'TA');
  assert.throws(()=>normalizeCorrection(raw,academicInput.essay));
  const wrong=model(academicInput); wrong.model.score.criteria[0].key='TR';
  assert.throws(()=>normalizeModel(wrong,'task1-academic'),/TA/);
  assert.throws(()=>validateTaskScores({originalScore:DEMO_ANALYSIS.originalScore},'task1-general'),/TA/);
});

test('chart data reaches correction and independent model while student draft stays isolated',()=>{
  const input={...academicInput,essay:'PRIVATE_DRAFT_MARKER'};
  for (const fn of [buildCorrectionPrompt,buildLocalCorrectionPrompt]) {
    const prompt=fn(input); assert(prompt.includes(input.taskData)); assert(prompt.includes(input.essay)); assert(prompt.includes('TA, CC, LR, GRA')); assert(!prompt.includes('250'));
  }
  const independent=buildModelPrompt(input);
  assert(independent.includes(input.taskData)); assert(!independent.includes(input.essay));
  assert(independent.includes('170–220')); assert(independent.includes('No fabricated chart data'));
  assert(buildModelPrompt(generalInput).includes('salutation and closing'));
  assert.equal(buildLocalCorrectionPrompt(academicInput),buildCorrectionPrompt(academicInput));
  assert(buildLocalCorrectionPrompt(generalInput).includes('所有 evidence、action'));
});

test('local academic writing gets no letter instructions or scoring schema in its writing prompt',async()=>{
  const calls=[];
  await generateLocalModel({...academicInput,provider:{kind:'ollama'},complete:async(_p,o)=>{
    calls.push(o);return calls.length===1?{paragraphs:academicInput.essay.split('\n\n')}:{score:score(),notes:[],expressions:[]};
  }});
  assert(!calls[0].prompt.includes('Dear'));
  assert(!calls[0].prompt.includes('criteria'));
  assert(!calls[0].prompt.includes('General Training'));
  assert(calls[0].prompt.includes('Each array item is one distinct complete paragraph'));
  assert(!calls[0].prompt.includes('简体中文'));
});

for (const input of [academicInput,generalInput]) {
  test(`${input.taskType}: local stages accept 150+ words and retry wrong TR without rewriting`,async()=>{
    const calls=[];
    const result=await generateLocalModel({...input,provider:{kind:'ollama'},essay:'PRIVATE_DRAFT_MARKER',complete:async(_p,options)=>{
      calls.push(options);
      if(calls.length===1) return input.taskType==='task1-general'?{text:input.essay}:{paragraphs:input.essay.split('\n\n')};
      const s=score(); if(calls.length===2) s.criteria[0].key='TR';
      return {score:s,notes:[],expressions:[]};
    }});
    assert.equal(calls.length,3); assert(countWords(result.data.model.text)>=150); assert(countWords(result.data.model.text)<250);
    assert(!JSON.stringify(calls).includes('PRIVATE_DRAFT_MARKER'));
    assert.equal(result.data.model.text,input.essay);
    assert.deepEqual(calls[1].schema.properties.score.properties.criteria.items.properties.key.enum,['TA','CC','LR','GRA']);
    assert(calls[2].prompt.includes('TA'));
  });
}

test('compatible HTTP pipeline returns Task 1 results and retries wrong task scoring',async t=>{
  const calls=[];
  const input=academicInput;
  let correctionCalls=0;
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));calls.push(body);
    const isCorrection=body.messages[1].content.includes('studentEssay');
    const data=isCorrection?correction(input):model(input);
    if(isCorrection && ++correctionCalls===1)data.originalScore.criteria[0].key='TR';
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}]}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const selected=getProviderOverride();
  t.after(()=>{setCloudConfig(null);setProviderOverride(selected);server.closeAllConnections();return new Promise(r=>server.close(r));});
  setCloudConfig({baseUrl:`http://127.0.0.1:${server.address().port}`,model:'test',apiKey:'synthetic-key'});setProviderOverride('openai-compatible');
  const result=await analyzeWriting(input);
  validateAnalysis(result,input.essay);validateTaskScores(result,input.taskType);
  assert.equal(correctionCalls,2);assert.equal(calls.length,3);
  const independent=calls.find(c=>!c.messages[1].content.includes('studentEssay'));
  assert(!independent.messages[1].content.includes(input.essay));assert(independent.messages[1].content.includes(input.taskData));
});

test('local letters reject short, Chinese, repeated or unstructured output without padding',async()=>{
  const block=generalInput.essay.split('\n\n')[1];
  for(const text of ['Dear Sam, Sorry. Bye.',generalInput.essay+'中文',Array(4).fill(block).join('\n\n'),generalInput.essay.replaceAll('\n',' ')]) {
    let calls=0;
    await assert.rejects(generateLocalModel({...generalInput,provider:{kind:'ollama'},complete:async()=>{calls++;return {text};}}),e=>e.status===502);
    assert.equal(calls,2);
  }
});
