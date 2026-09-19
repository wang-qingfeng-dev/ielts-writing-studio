import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateAnalysis } from '../analysis-schema.mjs';
import { requestJson } from '../http-json.mjs';

const base = process.env.IELTS_TEST_URL || 'http://127.0.0.1:4318';
const input = {
  prompt: 'Some people think that governments should make public transport free for everyone. Others believe that passengers should pay for these services. Discuss both views and give your own opinion.',
  targetBand: 7,
  essay: `Whether public transport should be free is a subject that many cities need to consider. Some people believe that government should pay all the costs, while others think passengers must buy tickets. I believe a low price with support for poorer people is a better solution than completely free travel.

There are several reason why free public transport can benefit a city. Firstly, it make daily life easier for people who earn little money. A cleaner who live far from her workplace may spend a large part of her salary on bus tickets. If buses are free, she can save these money for food and rent. Secondly, drivers might leave their cars at home because they do not need to pay for a bus. This can reduce traffic and air pollutions. However, price is not the only reason people choose cars. A slow bus will still be unattractive even if it costs nothing.

On the other hand, charging passengers give transport companies money to improve their service. They need to repair vehicles, pay drivers and add routes to new neighbourhoods. If the government pay everything, less money may be available for hospitals and schools. Moreover, free buses can become too crowded at busy times. For example, students may take a bus for a very short distance instead of walking, which mean that other passengers cannot find a seat.

In conclusion, I think public transport should be affordable but not always free. Governments should offer free travel to low-income residents and charge a reasonable fare to other users. This approach can help those in need while keeping enough money to provide a reliable service.`
};
const started = Date.now();
const statusResponse = await requestJson(`${base}/api/status`, {timeoutMs:15000});
assert.equal(statusResponse.status, 200, 'Engine status request must succeed');
const status = statusResponse.data;
assert.equal(status.available, true, 'Real engine must be available');
console.log(`Testing real ${status.provider || 'AI'} analysis; deadline: 10 minutes.`);
const progress = setInterval(() => console.log(`Analysis still running (${Math.round((Date.now() - started) / 1000)} seconds elapsed).`), 60000);
let response;
try {
  response = await requestJson(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(input), timeoutMs:10 * 60 * 1000 });
} finally { clearInterval(progress); }
const result = response.data;
// 实测失败也保留本机报告，方便定位模型返回问题；此文件由 .gitignore 排除。
const report = { testedAt: new Date().toISOString(), durationSeconds: Math.round((Date.now() - started) / 1000), input, result };
await writeFile(fileURLToPath(new URL('./live-result.json', import.meta.url)), JSON.stringify(report, null, 2), 'utf8');
assert.equal(response.status, 200, result.error || 'Analysis failed');
validateAnalysis(result, input.essay);
assert(result.issues.length >= 3, 'Known grammar issues should be detected');
assert.notEqual(result.corrected.text, input.essay, 'Corrections must change known errors');
assert(result.model.text.split(/\s+/).length >= 250, 'Model should meet Task 2 length');
assert(result.model.text.toLowerCase().includes('transport'), 'Model must answer the new prompt');
assert(result.model.notes.length >= 3, 'Model needs useful annotations');
assert(result.priorities.some(item => /语法|主谓|单复数|搭配|准确/.test(item.title + item.description)), 'Priorities should identify the language problem');
console.log(JSON.stringify({ success: true, durationSeconds: report.durationSeconds, originalBand: result.originalScore, correctedBand: result.corrected.score, modelBand: result.model.score, issues: result.issues.length, expressions: result.expressions.length, modelWords: result.model.text.split(/\s+/).length }, null, 2));
