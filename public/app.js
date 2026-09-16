import { DEMO_PROMPT, DEMO_ESSAY, DEMO_ANALYSIS } from './demo.js';
import { escapeHtml as e, countWords, formatBand, formatRange, annotate, issueAnnotation, normalizeAnswer, makeCardId, nextReview } from './utils.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const KEYS = { draft:'jujin.draft.v1', history:'jujin.history.v1', library:'jujin.library.v1' };
const CRITERIA = { TR:'任务回应', CC:'连贯与衔接', LR:'词汇资源', GRA:'语法多样性与准确性' };
const CATEGORIES = { grammar:'语法', spelling:'拼写', vocabulary:'词汇 / 搭配', logic:'论证 / 衔接' };
const ICONS = {
  history:'<path d="M3 11a9 9 0 1 1 2.7 7.2M3 4v7h7"/><path d="M12 7v5l3 2"/>',
  bookmark:'<path d="M6 4h12v17l-6-4-6 4z"/>',
  spark:'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4zM20 3v4M18 5h4"/>',
  file:'<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  pen:'<path d="m16 3 5 5-12 12-6 1 1-6zM13 6l5 5"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  link:'<path d="m10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/>',
  lightbulb:'<path d="M8 17v-2a7 7 0 1 1 8 0v2M8 17h8M9 21h6M12 10v7"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  book:'<path d="M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1z"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.book}</svg>`;
$$('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });

let storageWarning = false;
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { if (!storageWarning) { storageWarning = true; toast('本机存储空间不足，请导出学习笔记，避免关闭后丢失。'); } return false; }
}
let history = read(KEYS.history, []);
let library = read(KEYS.library, []);
if (!Array.isArray(history)) history = [];
if (!Array.isArray(library)) library = [];
const draft = read(KEYS.draft, null);
const validDraft = draft && typeof draft.prompt === 'string' && typeof draft.essay === 'string';
const state = validDraft ? { ...draft } : {
  id: crypto.randomUUID(), prompt:DEMO_PROMPT, essay:DEMO_ESSAY, targetBand:7,
  analysis: structuredClone(DEMO_ANALYSIS), mode:'demo', modelOpen:true,
};
state.busy = false;
state.createdAt ||= state.date || Date.now();
state.analyzedAt ||= state.analysis && state.mode !== 'demo' ? state.date || state.createdAt : null;
state.originalView = state.analysis ? 'review' : 'edit';
state.activeTab = 'original';
let controller;
let analysisBackup = null;
let saveTimer;
let progressTimer;
let toastTimer;
let modalReturnFocus;
let libraryView = { all:false, index:0, revealed:false };
let practiceAnswers = new Map();
let connection = { available:false, checked:false };

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.remove('hidden');
  toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 4200);
}
function saveDraft() {
  clearTimeout(saveTimer);
  const current = { id:state.id,prompt:state.prompt,essay:state.essay,targetBand:state.targetBand,analysis:state.analysis,mode:state.mode,modelOpen:state.modelOpen,createdAt:state.createdAt,analyzedAt:state.analyzedAt };
  // Reloading during a retry must retain the last completed result.
  const saved = write(KEYS.draft, state.busy && analysisBackup ? { ...current, ...analysisBackup } : current);
  $('#save-state').textContent = saved ? '已自动保存到本机' : '未能保存，请导出笔记';
}
function scheduleSave() { $('#save-state').textContent = '正在保存…'; clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 450); }
function saveHistory() {
  if (state.mode === 'demo' || !state.essay.trim()) return;
  const previousRecord = history.find(item => item.id === state.id);
  if (!state.analysis && previousRecord?.analysis) return;
  const record = { id:state.id,prompt:state.prompt,essay:state.essay,targetBand:state.targetBand,analysis:state.analysis,date:state.analyzedAt || state.createdAt,createdAt:state.createdAt,analyzedAt:state.analyzedAt,mode:'real' };
  history = [record, ...history.filter(item => item.id !== state.id)].sort((a,b)=>b.date-a.date).slice(0, 30);
  write(KEYS.history, history);
  updateCounters();
}
function updateCounters() {
  $('#history-count').textContent = history.length;
  $('#library-count').textContent = library.length;
}
function updateWordCount() {
  const words = countWords(state.essay);
  $('#word-count').textContent = `${words} words`;
  $('#word-hint').textContent = words === 0 ? '写下你的第一个观点' : words < 250 ? `距离 250 词还差 ${250 - words} 词` : words > 350 ? '检查是否可以更简洁' : '字数达标，关注论证质量';
  $('#word-hint').classList.toggle('word-warning', words > 0 && words < 250);
}
function scoreMarkup(score) {
  if (!score) return `<div class="score-heading"><span>预估 Band</span><span class="score-value score-placeholder">—</span></div><p class="score-note">完成分析后，查看四项评分与具体依据</p><div class="criteria-grid">${Object.entries(CRITERIA).map(([key,name])=>`<div class="criterion"><div class="criterion-top"><span class="criterion-code">${key}</span><span class="criterion-name">${name}</span><span class="criterion-band">—</span></div><div class="criterion-track"><span style="width:0%"></span></div></div>`).join('')}</div>`;
  return `<div class="score-heading"><div><span>预估 Band</span><p class="score-note">单篇作文 · AI 参考区间</p></div><span class="score-value">${e(formatRange(score))}</span></div><div class="criteria-grid">${score.criteria.map(item=>`<div class="criterion"><div class="criterion-top"><span class="criterion-code">${e(item.key)}</span><span class="criterion-name">${e(CRITERIA[item.key])}</span><span class="criterion-band">${e(formatBand(item.band))}</span></div><div class="criterion-track"><span style="width:${Math.max(0,Math.min(100,item.band / 9 * 100))}%"></span></div></div>`).join('')}</div><details class="score-details"><summary>评分依据与提升建议 <span>＋</span></summary>${score.criteria.map(item=>`<div class="criterion-detail"><strong>${e(item.key)} · ${e(CRITERIA[item.key])} <span>${e(formatBand(item.band))}</span></strong><p>${e(item.evidence)}</p><p class="criterion-action"><span>下一步</span>${e(item.action)}</p></div>`).join('')}</details>`;
}
function emptyPanel(kind) {
  return `<div class="empty-state"><span class="empty-icon">${icon(kind === 'corrected' ? 'pen' : 'book')}</span><h3>${kind === 'corrected' ? '你的想法，更准确的表达' : '看见另一种好思路'}</h3><p>${kind === 'corrected' ? '提交原文后，在这里逐句查看语法、拼写与搭配的必要修改。' : '根据题目独立创作，并拆解段落逻辑与可复用的表达。'}</p><span class="empty-state-caption">${kind === 'corrected' ? '保留你的观点和写作风格' : '先自己修改，再对照学习'}</span></div>`;
}
function loadingPanel(kind) {
  return `<div class="loading-state"><div class="loading-title"><span class="spinner"></span><strong>${kind === 'corrected' ? '正在逐句诊断你的作文' : '正在独立审题与构思'}</strong></div><p>${kind === 'corrected' ? '核对四项标准，提取真正影响分数的问题。' : '范文只依据题目生成，不读取你的作文。'}</p><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line medium"></div><p class="loading-elapsed">已等待 <span data-elapsed>0</span> 秒 · 深度分析通常需要数分钟</p></div>`;
}
function renderOriginal() {
  const hasAnalysis = !!state.analysis;
  const reviewing = hasAnalysis && state.originalView === 'review';
  $('#essay-input').classList.toggle('hidden', reviewing);
  $('#original-prose').classList.toggle('hidden', !reviewing);
  $$('[data-original-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.originalView === (reviewing ? 'review' : 'edit'));
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    button.disabled = state.busy || (button.dataset.originalView === 'review' && !hasAnalysis);
  });
  $('#issue-count').textContent = hasAnalysis ? ` ${state.analysis.issues.length}` : '';
  if (hasAnalysis) $('#original-prose').innerHTML = annotate(state.essay, state.analysis.issues.map(issue=>({ ...issueAnnotation(state.essay,issue,'original'),label:`${CATEGORIES[issue.category]} · 查看修改` })));
}
function renderAnalysis() {
  const a = state.analysis;
  renderOriginal();
  $('#mode-label').textContent = state.busy ? '正在深度分析' : state.mode === 'demo' ? '示例体验' : a ? '本次分析已完成' : '开始一篇新练习';
  const notice = $('#notice');
  notice.classList.toggle('hidden', state.mode !== 'demo');
  notice.innerHTML = state.mode === 'demo' ? `${icon('spark')}<span>这是一份预设的学习示例。点击「新练习」，粘贴你的题目和作文，获得真实 AI 分析。</span>` : '';
  $('#original-score').innerHTML = scoreMarkup(a?.originalScore);
  $('#corrected-score').innerHTML = scoreMarkup(a?.corrected.score);
  $('#model-score').innerHTML = scoreMarkup(a?.model.score);
  $('#corrected-body').innerHTML = state.busy ? loadingPanel('corrected') : !a ? emptyPanel('corrected') : `<div class="essay-prose" lang="en">${annotate(a.corrected.text, [
    ...a.issues.filter(issue=>issue.replacement).map(issue=>({...issueAnnotation(a.corrected.text,issue,'corrected'),label:`${CATEGORIES[issue.category]} · 查看原因`})),
    ...a.expressions.filter(item=>item.source==='corrected').map(item=>({id:item.id,kind:'expression',text:item.text,category:'expression',label:'可复用表达'})),
  ])}</div>`;
  renderModel();
  $('#corrected-word-count').textContent = a ? `${countWords(a.corrected.text)} words` : '等待你的原文';
  $('#model-word-count').textContent = a ? `${countWords(a.model.text)} words` : '另一种思路，同一道题';
  ['copy-corrected','copy-model','rewrite'].forEach(action => $(`[data-action="${action}"]`).disabled = !a || state.busy);
  $('#model-toggle').disabled = !a || state.busy;
  $('#export-button').disabled = !a || state.busy;
  $('#analyze-button').disabled = state.busy;
  $('#analyze-button').classList.toggle('hidden', state.busy);
  $('#cancel-button').classList.toggle('hidden', !state.busy);
  $('#prompt-input').readOnly = state.busy;
  $('#essay-input').readOnly = state.busy;
  $('#target-band').disabled = state.busy;
  $$('[data-action="new"], [data-action="demo"], [data-action="history"]').forEach(button=>button.disabled=state.busy);
  renderPriorities();
  renderReview();
}
function renderModel() {
  const a = state.analysis;
  $('#model-toggle').textContent = state.modelOpen ? '收起范文' : '展开范文';
  if (state.busy) { $('#model-body').innerHTML = loadingPanel('model'); return; }
  if (!a) { $('#model-body').innerHTML = emptyPanel('model'); return; }
  if (!state.modelOpen) {
    $('#model-body').innerHTML = `<div class="model-lock"><span class="empty-icon">${icon('book')}</span><span class="card-tag">先想一想，再看答案</span><h3>给自己的思考留一点空间。</h3><p>先根据左侧标注修改一处问题，再看看这篇范文如何展开观点。</p><button class="btn btn-secondary" data-action="toggle-model">我准备好了，查看范文 ${icon('arrow')}</button></div>`;
    return;
  }
  $('#model-body').innerHTML = `<div class="essay-prose" lang="en">${annotate(a.model.text, [
    ...a.expressions.filter(item=>item.source==='model').map(item=>({id:item.id,kind:'expression',text:item.text,category:'expression',label:'可复用表达'})),
    ...a.model.notes.map((note,i)=>({id:`note-${i}`,kind:'note',text:note.quote,category:'logic',label:note.label})),
  ])}</div>`;
}
function renderPriorities() {
  $('#priorities').innerHTML = `<div class="priority-intro"><span class="priority-icon">${icon('target')}</span><div><span class="eyebrow">FOCUS ON WHAT MATTERS</span><h2>本次，先做好这三件事</h2></div></div>${(state.analysis?.priorities || [
    {title:'先完整回答题目',description:'明确立场，覆盖题目要求的每个部分。'},
    {title:'让观点有充分支撑',description:'解释为什么，再给出具体例子或结果。'},
    {title:'把一个错误真正改掉',description:'分析完成后，这里会给出你的专属重点。'},
  ]).map((item,i)=>`<div class="priority-item"><span class="priority-index">0${i+1}</span><div><h3>${e(item.title)}</h3><p>${e(item.description)}</p></div></div>`).join('')}`;
}
function getCard(kind, item) {
  if (kind === 'issue') return { id:makeCardId(kind,item.original),kind,prompt:item.practice.question,answer:item.practice.answer,title:item.original,detail:item.explanation,example:item.replacement };
  if (kind === 'expression') return { id:makeCardId(kind,item.text),kind,prompt:`用英文表达：${item.meaning}`,answer:item.text,title:item.text,detail:item.usage,example:item.example };
  return { id:makeCardId(kind,item.quote),kind,prompt:`回想这种论证方法：${item.label}`,answer:item.quote,title:item.label,detail:item.explanation,example:item.quote };
}
function bookmarkButton(kind, item, index) {
  const card = getCard(kind, item);
  const saved = library.some(record=>record.id===card.id);
  return `<button class="icon-btn bookmark-button ${saved?'is-saved':''}" data-save-kind="${kind}" data-save-index="${index}" aria-label="${saved?'取消收藏':'收藏'}：${e(card.title)}" aria-pressed="${saved}">${icon(saved?'check':'bookmark')}</button>`;
}
function renderReview() {
  const a = state.analysis;
  $('#errors-total').textContent = String(a?.issues.length || 0).padStart(2,'0');
  $('#phrases-total').textContent = String(a?.expressions.length || 0).padStart(2,'0');
  $('#notes-total').textContent = String(a?.model.notes.length || 0).padStart(2,'0');
  if (!a) {
    $('#review-errors').innerHTML = '<div class="review-empty"><p>从你的真实错误开始。</p><span>分析后自动整理易错点与针对性小练习。</span></div>';
    $('#review-phrases').innerHTML = '<div class="review-empty"><p>准确、自然，用得上。</p><span>收集搭配，同时记住它的使用场景。</span></div>';
    $('#review-notes').innerHTML = '<div class="review-empty"><p>好表达背后，也有好逻辑。</p><span>学习如何解释、举例和推进论证。</span></div>';
    return;
  }
  $('#review-errors').innerHTML = a.issues.length ? a.issues.map((item,i)=>`<article class="review-card" id="review-issue-${i}"><div class="review-card-top"><span class="card-tag ${e(item.category)}">${e(CATEGORIES[item.category])} · ${item.priority==='essential'?'必须改':'可优化'}</span>${bookmarkButton('issue',item,i)}</div><div class="issue-pair"><div class="wrong">${e(item.original)}</div><div class="correct"><span aria-hidden="true">↳</span> ${e(item.replacement || '建议删除')}</div></div><p class="card-meaning">${e(item.explanation)}</p><button class="mini-btn" data-issue-index="${i}">做一道同类练习 ${icon('arrow')}</button></article>`).join('') : '<div class="review-empty">未发现需要标注的明显错误。继续检查论证的深度与完整性。</div>';
  $('#review-phrases').innerHTML = a.expressions.map((item,i)=>`<article class="review-card"><div class="review-card-top"><span class="card-tag expression">${item.source==='model'?'来自范文':'来自精修'}</span>${bookmarkButton('expression',item,i)}</div><h4 class="card-title" lang="en">${e(item.text)}</h4><p class="card-meaning">${e(item.meaning)}</p><p class="card-example" lang="en">${e(item.example)}</p><p class="card-usage">${e(item.usage)}</p><button class="mini-btn" data-expression-index="${i}">换个话题，自己造句 ${icon('arrow')}</button></article>`).join('');
  $('#review-notes').innerHTML = a.model.notes.map((item,i)=>`<article class="review-card"><div class="review-card-top"><span class="card-tag logic">${e(item.label)}</span>${bookmarkButton('note',item,i)}</div><p class="card-example note-quote" lang="en">${e(item.quote)}</p><p class="card-meaning">${e(item.explanation)}</p><button class="mini-btn" data-note-index="${i}">拆解这句话 ${icon('arrow')}</button></article>`).join('');
}
function renderAll() {
  $('#prompt-input').value = state.prompt;
  $('#essay-input').value = state.essay;
  $('#target-band').value = String(state.targetBand);
  updateWordCount();
  updateCounters();
  renderAnalysis();
}
function clearResult() {
  if (state.analysis) {
    saveHistory();
    state.id = crypto.randomUUID();
    state.createdAt = Date.now();
    state.analyzedAt = null;
    state.analysis = null;
    state.originalView = 'edit';
    renderAnalysis();
  }
  if (state.mode === 'demo') { state.mode='real'; renderAnalysis(); }
  $('#error').classList.add('hidden');
}
$('#prompt-input').addEventListener('input', event=>{ clearResult(); state.prompt=event.target.value; scheduleSave(); });
$('#essay-input').addEventListener('input', event=>{ clearResult(); state.essay=event.target.value; updateWordCount(); scheduleSave(); });
$('#target-band').addEventListener('change', event=>{ clearResult(); state.targetBand=Number(event.target.value); scheduleSave(); });
window.addEventListener('pagehide', saveDraft);

async function checkConnection() {
  const el = $('#connection-status');
  try {
    const response = await fetch('/api/status', { signal:AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('连接不可用');
    connection = {...await response.json(),checked:true};
    el.innerHTML = `<span class="status-dot ${connection.available?'':'offline'}"></span>${connection.available?'AI 已就绪':'AI 暂未连接'}`;
    el.title = connection.message || '';
  } catch { connection={available:false,checked:true}; el.innerHTML='<span class="status-dot offline"></span>服务未连接'; el.title='请运行项目目录里的“启动写作工作台.cmd”'; }
}
function showError(message) { $('#error').textContent = message; $('#error').classList.remove('hidden'); $('#error').scrollIntoView({behavior:'smooth',block:'center'}); }
async function analyze() {
  if (state.busy) return;
  if (!state.prompt.trim()) { showError('先粘贴完整的作文题目，包含最后的提问要求。'); $('#prompt-input').focus(); return; }
  if (countWords(state.essay) < 40) { showError('请先写下至少 40 个英文词，再开始分析。完整 Task 2 作文建议至少 250 词。'); state.originalView='edit';renderOriginal(); $('#essay-input').focus(); return; }
  const previous = { analysis:state.analysis,mode:state.mode,id:state.id,originalView:state.originalView,modelOpen:state.modelOpen,analyzedAt:state.analyzedAt };
  analysisBackup = previous;
  saveHistory();
  if (state.mode === 'demo') { state.mode='real';state.id=crypto.randomUUID(); }
  state.busy=true;
  state.analysis=null;
  state.modelOpen=false;
  state.originalView='edit';
  $('#error').classList.add('hidden');
  controller = new AbortController();
  const timeout = setTimeout(()=>controller?.abort('timeout'), 600000);
  const started = Date.now();
  renderAnalysis();
  progressTimer = setInterval(()=>$$('[data-elapsed]').forEach(el=>el.textContent=Math.floor((Date.now()-started)/1000)),1000);
  try {
    const response = await fetch('/api/analyze', { method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:state.prompt,essay:state.essay,targetBand:state.targetBand}),signal:controller.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `分析失败（${response.status}），请稍后重试。`);
    if (!result.originalScore || !result.corrected?.text || !result.model?.text || !Array.isArray(result.issues)) throw new Error('收到的分析不完整，请重试。');
    state.analysis=result;
    state.mode='real';
    state.analyzedAt=Date.now();
    state.originalView='review';
    practiceAnswers.clear();
    saveHistory();
    toast('分析完成。先看三个提分重点，再逐句修改。');
  } catch (error) {
    Object.assign(state, previous);
    if (controller.signal.aborted) showError(controller.signal.reason==='timeout' ? '分析等待超时，原文已保留。请检查连接后重试。' : '已停止分析，题目和原文已保留。');
    else showError(error.message || '分析失败，请检查 AI 连接后重试。');
  } finally {
    clearTimeout(timeout); clearInterval(progressTimer); controller=null;
    state.busy=false; analysisBackup=null; renderAnalysis(); saveDraft();
  }
}
function freshExercise(useDemo=false) {
  if (state.busy) return;
  saveHistory();
  Object.assign(state,{id:crypto.randomUUID(),createdAt:Date.now(),analyzedAt:null,prompt:useDemo?DEMO_PROMPT:'',essay:useDemo?DEMO_ESSAY:'',targetBand:state.targetBand,analysis:useDemo?structuredClone(DEMO_ANALYSIS):null,mode:useDemo?'demo':'real',modelOpen:useDemo,originalView:useDemo?'review':'edit'});
  practiceAnswers.clear();
  $('#error').classList.add('hidden');
  renderAll(); saveDraft(); setMobileTab('original');
  if (!useDemo) $('#prompt-input').focus();
  toast(useDemo?'已载入完整示例':'新练习已准备好，之前的练习保存在记录中。');
}
function setMobileTab(tab) {
  state.activeTab=tab;
  $$('.mobile-tab').forEach(button=>{ const active=button.dataset.tab===tab; button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1; });
  $$('.essay-panel').forEach(panel=>panel.classList.toggle('is-active',panel.id===`${tab}-panel`));
}
function openModal(title, body, footer='') {
  if (!$('#modal-root').firstElementChild) modalReturnFocus = document.activeElement;
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="modal-header"><h2 id="dialog-title">${e(title)}</h2><button class="icon-btn close-modal" data-action="close-modal" aria-label="关闭弹窗">${icon('close')}</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-footer">${footer}</div>`:''}</section></div>`;
  document.body.classList.add('modal-open');
  $('#modal-root .close-modal').focus();
}
function closeModal() {
  $('#modal-root').innerHTML=''; document.body.classList.remove('modal-open');
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
}
function markActive(id) {
  $$('[data-annotation]').forEach(el=>el.classList.toggle('active',el.dataset.annotation===id));
  const matching = $$('[data-annotation]').filter(el=>el.dataset.annotation===id);
  for (const el of matching) { const body=el.closest('.essay-body'); if(body) body.scrollTop=Math.max(0,el.offsetTop-body.offsetTop-90); }
}
function openIssue(index) {
  const item=state.analysis?.issues[index];if(!item)return;
  markActive(item.id);
  openModal(`${CATEGORIES[item.category]} · ${item.priority==='essential'?'必须修改':'可选优化'}`,`<div class="issue-dialog"><div class="issue-pair"><label>原文</label><div class="wrong" lang="en">${e(item.original)}</div><label>建议修改</label><div class="correct" lang="en">${e(item.replacement || '删除这部分')}</div></div><p class="detail-explanation">${e(item.explanation)}</p><div class="practice-box"><h3>遮住答案，自己试一次</h3><p lang="en">${e(item.practice.question)}</p><label class="sr-only" for="practice-answer">你的练习答案</label><textarea id="practice-answer" class="practice-input" placeholder="写下你的修改…" rows="3">${e(practiceAnswers.get(item.id)||'')}</textarea><div class="card-actions"><button class="btn btn-primary btn-small" data-check-issue="${index}">检查答案</button><button class="btn btn-ghost btn-small" data-reveal-issue="${index}">查看参考答案</button></div><div id="practice-feedback" class="practice-feedback hidden" role="status"></div></div></div>`, `<button class="btn btn-secondary btn-small" data-save-kind="issue" data-save-index="${index}">${icon('bookmark')} ${library.some(card=>card.id===getCard('issue',item).id)?'已在复习库 · 点击移除':'加入复习库'}</button>`);
}
function openExpression(index) {
  const item=state.analysis?.expressions[index];if(!item)return;
  markActive(item.id);
  openModal('让表达变成自己的',`<span class="card-tag expression">${item.source==='model'?'来自独立范文':'来自精修版本'}</span><h3 class="card-title" lang="en">${e(item.text)}</h3><p>${e(item.meaning)}</p><p class="card-usage">${e(item.usage)}</p><p class="card-example" lang="en">${e(item.example)}</p><div class="practice-box"><h3>换一个话题，写一个自己的句子</h3><p>试着谈谈教育、工作或环境，用上这个表达。</p><label class="sr-only" for="expression-answer">我的造句</label><textarea id="expression-answer" class="practice-input" placeholder="Write your own sentence here…" rows="3">${e(practiceAnswers.get(item.id)||'')}</textarea><button class="btn btn-primary btn-small" data-check-expression="${index}">检查是否用上搭配</button><div id="practice-feedback" class="practice-feedback hidden" role="status"></div></div>`, `<button class="btn btn-secondary btn-small" data-save-kind="expression" data-save-index="${index}">${icon('bookmark')} ${library.some(card=>card.id===getCard('expression',item).id)?'已在复习库 · 点击移除':'加入复习库'}</button>`);
}
function openNote(index) {
  const item=state.analysis?.model.notes[index];if(!item)return;
  markActive(`note-${index}`);
  openModal(item.label,`<p class="card-example note-quote" lang="en">${e(item.quote)}</p><p class="detail-explanation">${e(item.explanation)}</p><div class="practice-box"><h3>迁移到下一篇</h3><p>保留这句话的论证作用，换掉话题和例子。想一想：它是在提出观点、解释原因、举例，还是承认限制？</p><label class="sr-only" for="note-answer">我的迁移练习</label><textarea id="note-answer" class="practice-input" rows="3" placeholder="尝试写一句具有相同论证作用的话…">${e(practiceAnswers.get(`note-${index}`)||'')}</textarea><button class="btn btn-secondary btn-small" data-save-note-practice="${index}">保存这次尝试</button></div>`, `<button class="btn btn-secondary btn-small" data-save-kind="note" data-save-index="${index}">${icon('bookmark')} ${library.some(card=>card.id===getCard('note',item).id)?'已在复习库 · 点击移除':'加入复习库'}</button>`);
}
function saveCard(kind,index,button) {
  const a=state.analysis;if(!a)return;
  const item=kind==='issue'?a.issues[index]:kind==='expression'?a.expressions[index]:a.model.notes[index];
  if(!item)return;
  const card=getCard(kind,item);
  const exists=library.some(record=>record.id===card.id);
  if (exists) library=library.filter(record=>record.id!==card.id);
  else library.push({...card,created:Date.now(),due:Date.now(),level:0});
  write(KEYS.library,library);updateCounters();renderReview();
  if(button.closest('.modal-footer')) button.innerHTML=`${icon(exists?'bookmark':'check')} ${exists?'加入复习库':'已在复习库 · 点击移除'}`;
  toast(exists?'已移出复习库，可随时重新收藏。':'已加入复习库，之后可以遮住答案自测。');
}
function showHistory() {
  const real=history.filter(item=>item.analysis);
  const recent=real[0]?.analysis.originalScore;
  const first=real.at(-1)?.analysis.originalScore;
  const recurring={};
  real.forEach(item=>item.analysis.issues.forEach(issue=>{recurring[issue.category]=(recurring[issue.category]||0)+1;}));
  const most=Object.entries(recurring).sort((a,b)=>b[1]-a[1])[0];
  openModal('我的练习记录',`${real.length?`<div class="history-summary"><div><span>已完成练习</span><strong>${real.length}<small>篇</small></strong></div><div><span>首次 → 最近估分</span><strong>${e(formatRange(first))} → ${e(formatRange(recent))}</strong></div><div><span>记录中最常见的问题</span><strong>${e(most?CATEGORIES[most[0]]:'暂无明显错误')}</strong></div></div><p class="score-note">题目与难度不同，单次估分变化不等于稳定进步。</p>`:''}${history.length?history.map(item=>`<article class="history-item"><div class="history-meta"><span>${new Date(item.date).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span><span>${countWords(item.essay)} words · ${item.analysis?`Band ${e(formatRange(item.analysis.originalScore))}`:'未分析的草稿'}</span></div><h3 class="history-title">${e(item.prompt || '未填写题目')}</h3><div class="history-actions"><button class="btn btn-secondary btn-small" data-history-id="${e(item.id)}">打开这篇练习 ${icon('arrow')}</button></div></article>`).join(''):`<div class="empty-library">${icon('history')}<h3>你的进步，会留在这里。</h3><p>真实练习和草稿会自动保留。示例体验不会计入记录。</p></div>`}`,`<span class="score-note">仅保存在当前浏览器，最多保留最近 30 篇。</span>`);
}
function showLibrary(reset=false) {
  if(reset)libraryView={all:false,index:0,revealed:false};
  const due=library.filter(card=>card.due<=Date.now());
  const cards=libraryView.all?library:due;
  libraryView.index=Math.min(libraryView.index,Math.max(0,cards.length-1));
  const card=cards[libraryView.index];
  openModal('我的复习库',`<div class="library-toolbar"><span>已收藏 ${library.length} 项 · 今天待复习 ${due.length} 项</span><button class="btn btn-ghost btn-small" data-action="library-filter">${libraryView.all?'只看待复习':'查看全部收藏'}</button></div>${card?`<article class="library-card"><span class="card-tag">${card.kind==='issue'?'易错点':card.kind==='expression'?'实用搭配':'论证方法'} · ${libraryView.index+1} / ${cards.length}</span><h3>${e(card.prompt)}</h3>${libraryView.revealed?`<div class="library-answer"><p class="card-title" lang="en">${e(card.answer)}</p><p>${e(card.detail)}</p>${card.example && card.example!==card.answer?`<p class="card-example" lang="en">${e(card.example)}</p>`:''}</div><p class="score-note">先自行判断是否能独立答出，再安排下一次复习。</p><div class="library-controls"><button class="btn btn-secondary" data-review-card="${e(card.id)}" data-remembered="false">还不熟 · 10 分钟后</button><button class="btn btn-primary" data-review-card="${e(card.id)}" data-remembered="true">记住了 · ${[1,3,7,14,30][Math.min(card.level||0,4)]} 天后</button></div>`:`<p class="card-usage">先在心里回答，或者在纸上写一次。</p><button class="btn btn-primary" data-action="library-reveal">显示答案 ${icon('arrow')}</button>`}</article>`:`<div class="empty-library">${icon('bookmark')}<h3>${library.length?'今天的复习已完成。':'好表达，从一次收藏开始。'}</h3><p>${library.length?'之后按安排回来复习，也可以查看全部收藏。':'点击易错点、搭配和论证卡片上的书签，把它加入这里。'}</p></div>`}`,`<span class="score-note">复习节奏：1 天 → 3 天 → 7 天 → 14 天 → 30 天</span>`);
}
function exportNotes() {
  const a=state.analysis;if(!a)return;
  const scoreText=score=>`预估 Band：${formatRange(score)}\n\n${score.criteria.map(item=>`- ${item.key} ${CRITERIA[item.key]}：${formatBand(item.band)}\n  依据：${item.evidence}\n  建议：${item.action}`).join('\n')}`;
  const content=`# 句进 · 雅思写作学习笔记\n\n${state.mode==='demo'?'预设示例，供学习体验。\n\n':''}日期：${new Date().toLocaleDateString('zh-CN')}\n目标：Band ${formatBand(state.targetBand)}\nAI 练习估分，非官方成绩。\n\n## 题目\n\n${state.prompt}\n\n## 我的原文\n\n${state.essay}\n\n${scoreText(a.originalScore)}\n\n## 精修版本\n\n${a.corrected.text}\n\n${scoreText(a.corrected.score)}\n\n## 独立范文\n\n${a.model.text}\n\n${scoreText(a.model.score)}\n\n## 本次提分重点\n\n${a.priorities.map((item,i)=>`${i+1}. ${item.title}：${item.description}`).join('\n')}\n\n## 易错点\n\n${a.issues.map(item=>`### ${CATEGORIES[item.category]}\n\n原句：${item.original}\n\n修改：${item.replacement}\n\n原因：${item.explanation}\n\n练习：${item.practice.question}\n\n参考答案：${item.practice.answer}`).join('\n\n')}\n\n## 实用搭配\n\n${a.expressions.map(item=>`### ${item.text}\n\n${item.meaning}\n\n用法：${item.usage}\n\n例句：${item.example}`).join('\n\n')}\n\n## 好句与论证\n\n${a.model.notes.map(item=>`### ${item.label}\n\n${item.quote}\n\n${item.explanation}`).join('\n\n')}\n`;
  const url=URL.createObjectURL(new Blob(['\ufeff',content],{type:'text/markdown;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`句进-写作笔记-${new Date().toISOString().slice(0,10)}.md`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  toast('学习笔记已导出，包含三篇作文、评分和复习内容。');
}
function showAbout() {
  openModal('写作工作台 · 使用与评分说明',`<div class="about-content"><h3>一次练习，走完一个学习闭环</h3><ol><li>粘贴完整 Task 2 题目，在左栏写作。建议 40 分钟、至少 250 词。</li><li>点击「开始分析」，先看三个重点，再点击原文和精修版的高亮。</li><li>中栏保留观点做必要修改；右栏只根据题目独立创作，可按需展开。</li><li>收藏常犯错误和好表达，通过换题造句与间隔复习形成记忆。</li></ol><h3>评分怎么看</h3><p>采用 Task 2 的四项标准：任务回应 TR、连贯与衔接 CC、词汇资源 LR、语法多样性与准确性 GRA。单篇四项等权，展示 AI 参考区间与文本证据。</p><p>这是练习估分，不能替代正式考试结果。语法修正不一定改善论证，范文也不会自动获得满分。此页面不提供包含 Task 1 的完整 Writing 成绩。</p><h3>关于保存与 AI</h3><p>草稿、最近 30 篇练习和复习卡保存在当前浏览器。清除浏览器数据会移除这些记录，请通过「导出学习笔记」备份。</p><p>真实分析使用本机已配置的 AI 服务，将题目和作文发送到该服务，使用相应账户额度。无需在网页输入密钥。示例为预设内容，服务失败时不会拿示例冒充分析结果。</p><p>小练习的答案对照与搭配检查为本地检查；「用上了搭配」不代表整句语法已通过 AI 审核。</p><a href="https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail" target="_blank" rel="noopener noreferrer">查看 IELTS 官方评分说明 ↗</a></div>`);
}

document.addEventListener('click', async event=>{
  const button=event.target.closest('button');
  if (!button || button.disabled)return;
  const data=button.dataset;
  if(data.tab){setMobileTab(data.tab);return;}
  if(data.originalView){state.originalView=data.originalView;renderOriginal();return;}
  if(data.annotation){
    if(data.kind==='issue')openIssue(state.analysis.issues.findIndex(item=>item.id===data.annotation));
    else if(data.kind==='expression')openExpression(state.analysis.expressions.findIndex(item=>item.id===data.annotation));
    else openNote(Number(data.annotation.replace('note-','')));
    return;
  }
  if(data.issueIndex!==undefined){openIssue(Number(data.issueIndex));return;}
  if(data.expressionIndex!==undefined){openExpression(Number(data.expressionIndex));return;}
  if(data.noteIndex!==undefined){openNote(Number(data.noteIndex));return;}
  if(data.saveKind){saveCard(data.saveKind,Number(data.saveIndex),button);return;}
  if(data.checkIssue!==undefined || data.revealIssue!==undefined){
    const item=state.analysis.issues[Number(data.checkIssue??data.revealIssue)];
    const answer=$('#practice-answer').value;practiceAnswers.set(item.id,answer);
    const correct=normalizeAnswer(answer)===normalizeAnswer(item.practice.answer);
    const feedback=$('#practice-feedback');feedback.classList.remove('hidden');
    feedback.innerHTML=data.revealIssue!==undefined?`<strong>参考答案</strong><p lang="en">${e(item.practice.answer)}</p>`:correct?`${icon('check')} 与参考答案一致。下一篇尝试独立用对。`:`<strong>${answer.trim()?'与参考答案有差异，可以对照看看。':'先写下你的答案，再对照参考。'}</strong><p lang="en">${e(item.practice.answer)}</p><span class="score-note">其他表达也可能成立；这里仅做参考答案对照。</span>`;
    return;
  }
  if(data.checkExpression!==undefined){
    const item=state.analysis.expressions[Number(data.checkExpression)];const answer=$('#expression-answer').value;practiceAnswers.set(item.id,answer);
    const used=normalizeAnswer(answer).includes(normalizeAnswer(item.text));
    const feedback=$('#practice-feedback');feedback.classList.remove('hidden');
    feedback.textContent=used?'已用上这个搭配！再检查主谓一致、时态和语境。这是搭配检查，不是完整语法评分。':'还没有找到这个搭配的完整形式。你可以对照上面的例句再试一次；合理的词形变化也可以成立。';return;
  }
  if(data.saveNotePractice!==undefined){const value=$('#note-answer').value;if(!value.trim()){toast('先写一句自己的表达。');return;}practiceAnswers.set(`note-${data.saveNotePractice}`,value);toast('这次尝试已暂存，关闭弹窗后仍可查看。');return;}
  if(data.historyId){
    const item=history.find(record=>record.id===data.historyId);if(!item)return;
    $('#error').classList.add('hidden');
    saveHistory();practiceAnswers.clear();Object.assign(state,structuredClone(item),{createdAt:item.createdAt||item.date,analyzedAt:item.analyzedAt??(item.analysis?item.date:null),originalView:item.analysis?'review':'edit',modelOpen:false});closeModal();renderAll();saveDraft();setMobileTab('original');toast('已打开练习。');return;
  }
  if(data.reviewCard){
    library=library.map(card=>card.id===data.reviewCard?nextReview(card,data.remembered==='true'):card);write(KEYS.library,library);libraryView.revealed=false;
    if(libraryView.all)libraryView.index=(libraryView.index+1)%library.length;
    showLibrary();toast(data.remembered==='true'?'记下了，下次到期再复习。':'已安排 10 分钟后再试一次。');return;
  }
  switch(data.action){
    case 'analyze': await analyze();break;
    case 'cancel': controller?.abort('user');break;
    case 'new':freshExercise();break;
    case 'demo':freshExercise(true);break;
    case 'toggle-model':state.modelOpen=!state.modelOpen;renderModel();saveDraft();break;
    case 'history':showHistory();break;
    case 'library':showLibrary(true);break;
    case 'library-filter':libraryView.all=!libraryView.all;libraryView.index=0;libraryView.revealed=false;showLibrary();break;
    case 'library-reveal':libraryView.revealed=true;showLibrary();break;
    case 'close-modal':closeModal();break;
    case 'about':showAbout();break;
    case 'export':exportNotes();break;
    case 'copy-corrected':case 'copy-model':
      try { await navigator.clipboard.writeText(data.action==='copy-model'?state.analysis.model.text:state.analysis.corrected.text);toast('已复制到剪贴板。'); }catch {toast('浏览器未允许复制，请选中文本手动复制。');}break;
    case 'rewrite':{
      $('#error').classList.add('hidden');
      const corrected=state.analysis.corrected.text;saveHistory();Object.assign(state,{id:crypto.randomUUID(),createdAt:Date.now(),analyzedAt:null,essay:corrected,analysis:null,mode:'real',originalView:'edit',modelOpen:false});renderAll();saveDraft();setMobileTab('original');$('#essay-input').focus();toast('已建立精修稿的下一版练习，原分析保留在记录里。');break;
    }
  }
});
document.addEventListener('click',event=>{if(event.target.classList.contains('modal-backdrop'))closeModal();});
document.addEventListener('keydown',event=>{
  const modal=$('#modal-root .modal');
  if(modal){
    if(event.key==='Escape'){event.preventDefault();closeModal();}
    if(event.key==='Tab'){
      const focusable=[...modal.querySelectorAll('button:not([disabled]),a[href],textarea,input,select,[tabindex="0"]')];
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }
  if(event.target.classList.contains('mobile-tab') && ['ArrowLeft','ArrowRight'].includes(event.key)){
    event.preventDefault();const tabs=['original','corrected','model'];const index=tabs.indexOf(state.activeTab);const next=tabs[(index+(event.key==='ArrowRight'?1:2))%3];setMobileTab(next);$(`[data-tab="${next}"]`).focus();
  }
});
renderAll();
checkConnection();
