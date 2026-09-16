import test from 'node:test';
import assert from 'node:assert/strict';
import { annotate, issueAnnotation, countWords, normalizeAnswer, nextReview, makeCardId } from '../public/utils.js';
import { DEMO_ANALYSIS, DEMO_ESSAY } from '../public/demo.js';
import { validateAnalysis } from '../analysis-schema.mjs';

test('essay markup and annotation attributes cannot inject executable HTML', () => {
  const raw = 'Text <img src=x onerror=alert(1)> & "quotes"';
  const rendered = annotate(raw, [{text:'Text',id:'" onclick="alert(1)',kind:'issue',category:'unknown',label:'<bad>'}]);
  assert.ok(!rendered.includes('<img'));
  assert.ok(rendered.includes('&lt;img'));
  assert.ok(rendered.includes('&quot; onclick=&quot;'));
  assert.ok(!rendered.includes('class="annotation unknown"'));
});
test('annotations retain paragraph breaks and choose disjoint occurrences', () => {
  const rendered = annotate('one two one\n\nNext paragraph.', [
    {text:'one two',id:'a',kind:'issue',category:'grammar',label:'a'},
    {text:'one',id:'b',kind:'expression',category:'expression',label:'b'},
    {text:'not here',id:'c',kind:'issue',category:'grammar',label:'c'},
  ]);
  assert.equal((rendered.match(/<button/g)||[]).length, 2);
  assert.ok(rendered.includes('</p><p>Next paragraph.'));
  assert.equal(rendered.replace(/<[^>]+>/g,''), 'one two oneNext paragraph.');
});
test('word counter handles hyphenated forms, apostrophes and Chinese helper text', () => {
  assert.equal(countWords("It's a well-designed plan. 中文提示"),4);
  assert.equal(countWords(''),0);
  assert.equal(countWords('250 words\nnew paragraph'),4);
});
test('a phrase inside a model sentence keeps both teaching annotations accessible', () => {
  const sentence='A practical alternative can reduce congestion.';
  const rendered=annotate(sentence,[
    {id:'phrase',kind:'expression',text:'practical alternative',category:'expression',label:'搭配'},
    {id:'note',kind:'note',text:sentence,category:'logic',label:'论证'},
  ]);
  assert.equal((rendered.match(/data-annotation="note"/g)||[]).length,2);
  assert.equal((rendered.match(/data-annotation="phrase"/g)||[]).length,1);
  assert.ok(!/<button[^>]*>[^<]*<button/.test(rendered));
  assert.equal(rendered.replace(/<[^>]+>/g,''),sentence);
});
test('practice checking ignores whitespace, sentence punctuation and smart apostrophes', () => {
  assert.equal(normalizeAnswer("  It’s   fine. "), normalizeAnswer("it's fine"));
  assert.notEqual(normalizeAnswer('believes'),normalizeAnswer('believe'));
});
test('context anchors put a changed verb in the correct repeated sentence', () => {
  const issue={id:'i',category:'grammar',original:'Buses can brings opportunities.',replacement:'Buses can bring opportunities.'};
  const text='I can bring books. Buses can bring opportunities.';
  const entry=issueAnnotation(text,issue,'corrected');
  assert.equal(entry.text,'bring');
  assert.equal(entry.position,text.lastIndexOf('bring'));
  const rendered=annotate(text,[entry]);
  assert.ok(rendered.startsWith('<p>I can bring books. Buses can <button'));
});
test('a deleted word retains a visible nearby correction anchor', () => {
  const issue={id:'i',category:'grammar',original:'more cheaper than',replacement:'cheaper than'};
  assert.equal(issueAnnotation('more cheaper than',issue,'original').text,'more');
  assert.equal(issueAnnotation('cheaper than',issue,'corrected').text,'cheaper');
});
test('multiline annotation context does not put paragraph tags inside buttons', () => {
  const text='First paragraph.\n\nSecond paragraph.';
  const rendered=annotate(text,[{id:'i',kind:'note',category:'logic',text,label:'example'}]);
  assert.ok(rendered.includes('</button></p><p><button'));
});
test('spaced review progresses by 1, 3, 7, 14, 30 days and resets on forgotten cards', () => {
  const now = 1000000;
  let card = {level:0,id:'card'};
  for (const days of [1,3,7,14,30,30]) {
    card=nextReview(card,true,now);
    assert.equal(card.due,now+days*86400000);
  }
  card=nextReview(card,false,now);
  assert.equal(card.level,0);
  assert.equal(card.due,now+600000);
});
test('review card identifiers deduplicate the same learning point across essays', () => {
  assert.equal(makeCardId('issue','depend of'), makeCardId('issue','depend of'));
  assert.notEqual(makeCardId('expression','depend on'), makeCardId('issue','depend on'));
});
test('demo data passes the same evidence and scoring checks as a live result', () => {
  validateAnalysis(DEMO_ANALYSIS,DEMO_ESSAY);
  const transformed=DEMO_ANALYSIS.issues.reduce((text,issue)=>text.replace(issue.original,issue.replacement),DEMO_ESSAY);
  assert.equal(transformed,DEMO_ANALYSIS.corrected.text);
  assert.equal(DEMO_ANALYSIS.priorities.length,3);
  assert.ok(countWords(DEMO_ANALYSIS.model.text)>=250);
  assert.ok(DEMO_ANALYSIS.issues.filter(issue=>issue.category==='spelling').every(issue=>issue.priority==='essential'));
});
