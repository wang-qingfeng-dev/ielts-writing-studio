export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const countWords = text => (String(text).match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g) || []).length;
export const normalizeAnswer = text => String(text).trim().toLowerCase().replace(/[’]/g,"'").replace(/[.,!?;:]+$/g,'').replace(/\s+/g,' ');
export const formatBand = band => Number(band).toFixed(1);
export const formatRange = score => score.low === score.high ? formatBand(score.low) : `${formatBand(score.low)}–${formatBand(score.high)}`;

// Keep the unique context as an anchor, but visually mark only the changed words.
export function issueAnnotation(text, issue, side) {
  const before=[...issue.original.matchAll(/\S+/g)];
  const after=[...issue.replacement.matchAll(/\S+/g)];
  let prefix=0,suffix=0;
  while(prefix<before.length && prefix<after.length && before[prefix][0]===after[prefix][0])prefix++;
  while(suffix<before.length-prefix && suffix<after.length-prefix && before[before.length-1-suffix][0]===after[after.length-1-suffix][0])suffix++;
  const source=side==='original'?issue.original:issue.replacement;
  const tokens=side==='original'?before:after;
  let start=0,end=source.length;
  if(tokens.length && issue.original!==issue.replacement){
    const from=Math.min(prefix,tokens.length-1);
    const to=Math.max(from,tokens.length-suffix-1);
    start=tokens[from].index;end=tokens[to].index+tokens[to][0].length;
  }
  const anchor=text.indexOf(source);
  return {id:issue.id,kind:'issue',category:issue.category,text:source.slice(start,end),position:anchor<0?-1:anchor+start};
}

// Split overlapping sentence/phrase highlights into adjacent buttons, never nested markup.
export function annotate(text, entries = []) {
  const ranges = [];
  for (const entry of entries) {
    if (!entry.text) continue;
    if (Number.isInteger(entry.position)) {
      if(entry.position>=0 && text.slice(entry.position,entry.position+entry.text.length)===entry.text)ranges.push({...entry,start:entry.position,end:entry.position+entry.text.length});
      continue;
    }
    let start = text.indexOf(entry.text);
    const first = start;
    let placed = false;
    while (start !== -1) {
      const end = start + entry.text.length;
      if (!ranges.some(range => start < range.end && end > range.start)) {
        ranges.push({ ...entry, start, end });
        placed = true;
        break;
      }
      start = text.indexOf(entry.text, start + 1);
    }
    if (!placed && first !== -1) ranges.push({ ...entry, start:first, end:first + entry.text.length });
  }
  const boundaries = [...new Set([0,text.length,...ranges.flatMap(range=>[range.start,range.end])])].sort((a,b)=>a-b);
  const segments = [];
  for (let i=0;i<boundaries.length-1;i++) {
    const start=boundaries[i],end=boundaries[i+1];
    // A specific phrase remains clickable inside a broader reasoning sentence.
    const range=ranges.filter(item=>item.start<=start && item.end>=end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
    const last=segments.at(-1);
    if(last && last.range===range) last.end=end;
    else segments.push({start,end,range});
  }
  let result = '';
  for (const segment of segments) {
    const range=segment.range;
    const content=text.slice(segment.start,segment.end);
    if(!range || !content.trim()){result+=escapeHtml(content);continue;}
    const category = ['grammar','vocabulary','logic','spelling','expression'].includes(range.category) ? range.category : 'expression';
    result += content.split(/(\n\s*\n)/).map(part=>/^\n\s*\n$/.test(part)?part:part?`<button type="button" class="annotation ${category}" data-annotation="${escapeHtml(range.id)}" data-kind="${escapeHtml(range.kind)}" title="${escapeHtml(range.label)}" aria-label="${escapeHtml(range.label)}：${escapeHtml(part)}">${escapeHtml(part)}</button>`:'').join('');
  }
  return `<p>${result.replace(/\n\s*\n/g,'</p><p>').replace(/\n/g,'<br>')}</p>`;
}

export function makeCardId(kind, text) {
  let hash = 2166136261;
  for (const char of `${kind}:${text}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${kind}-${(hash >>> 0).toString(36)}`;
}

export function nextReview(card, remembered, now = Date.now()) {
  const level = remembered ? Math.min((card.level || 0) + 1, 5) : 0;
  const days = [0,1,3,7,14,30][level];
  return { ...card, level, reviewedAt: now, due: now + (remembered ? days * 86400000 : 10 * 60000) };
}
