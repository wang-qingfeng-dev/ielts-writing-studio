// 手动实测：node tests/live-task1.mjs cloud|local
// 仅使用自编测试题；结果保存到已忽略的 tmp/，不打印密钥。
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCloudSettingsStore } from '../cloud-settings.mjs';
import { createLocalAIManager } from '../local-ai.mjs';
import { setCloudConfig, setProviderOverride } from '../provider.mjs';
import { analyzeWriting } from '../server.mjs';
import { validateAnalysis, validateTaskScores } from '../analysis-schema.mjs';
import { academicInput, generalInput } from './task1-fixtures.mjs';
import { countWords } from '../public/utils.js';

const mode=process.argv[2]||'cloud';
let manager;
const results=[];
try {
  if(mode==='cloud') {
    const config=await createCloudSettingsStore().load();
    assert(config?.apiKey,'未配置在线 AI 密钥，无法进行真实云端测试。');
    setCloudConfig(config);setProviderOverride('openai-compatible');
    console.log(`真实在线测试：${config.provider} / ${config.model}`);
  } else if(mode==='local') {
    manager=createLocalAIManager();await manager.restore();
    const config=manager.getProviderConfig();assert(config,'本地模型未准备好。');
    process.env.OLLAMA_HOST=config.url;process.env.OLLAMA_MODEL=config.model;
    setProviderOverride('ollama');
    console.log(`真实本地测试：${config.model}`);
  } else throw new Error('请选择 cloud 或 local。');
  for(const input of [academicInput,generalInput].filter(input=>!process.argv[3]||input.taskType===process.argv[3])) {
    const start=Date.now();console.log(`开始 ${input.taskType}`);
    const result=await analyzeWriting(input);
    validateAnalysis(result,input.essay);validateTaskScores(result,input.taskType);
    assert(countWords(result.model.text)>=150);
    assert.notEqual(result.corrected.text,input.essay,'已知语法错误应得到修正');
    const report={mode,taskType:input.taskType,seconds:Math.round((Date.now()-start)/1000),modelWords:countWords(result.model.text),issues:result.issues.length,criteria:result.originalScore.criteria.map(x=>x.key),result};
    results.push(report);
    console.log(JSON.stringify({...report,result:undefined}));
    await mkdir(new URL('../tmp/',import.meta.url),{recursive:true});
    await writeFile(new URL(`../tmp/task1-live-${mode}${process.argv[3]?'-'+process.argv[3]:''}.json`,import.meta.url),JSON.stringify(results,null,2));
  }
} finally { await manager?.close(); }
