/** Explicit editorial classification; does not guess genre from answer words. */
const normalized=s=>s.normalize('NFKC').replace(/[\p{Cf}\s]/gu,'').toLowerCase();
export const ENTERTAINMENT_LABELS=Object.freeze([
 '娛樂','娛樂新聞','影劇','影劇新聞','影視娛樂','演藝','演藝新聞','明星八卦','綜藝','追星',
 'entertainment','showbiz','celebrity','celebritygossip'
]);
const labels=new Set(ENTERTAINMENT_LABELS.map(normalized));
export function assessNewsScope(item) {
 const signals=[],errors=[];
 if(item?.is_entertainment!==undefined) {
  if(typeof item.is_entertainment!=='boolean')errors.push('is_entertainment 必須是布林值');
  else if(item.is_entertainment)signals.push('is_entertainment=true');
 }
 const inspect=(value,field)=>{if(typeof value==='string'&&labels.has(normalized(value)))signals.push(field+': '+value.trim());};
 for(const [field,value] of Object.entries({category:item?.category,editorial_domain:item?.editorial_domain,source_section:item?.source_section}))
  inspect(value,field);
 if(Array.isArray(item?.categories))for(const value of item.categories)inspect(value,'categories');
 for(const source of Array.isArray(item?.sources)?item.sources:[]) {
  inspect(source?.section,'source.section');inspect(source?.category,'source.category');
 }
 return {allowed:signals.length===0&&errors.length===0,
  reason:signals.length?'ENTERTAINMENT_EXCLUDED':errors.length?'NEWS_SCOPE_INVALID':null,
  signals:[...new Set(signals)],errors,
  note:'依明示分類排除娛樂新聞；不因答案含電競、電影等字詞自動判為娛樂新聞。'};
}
export function assessCandidateScope(candidate) {
 const a=assessNewsScope(candidate),b=assessNewsScope(candidate?.event);
 const signals=[...new Set([...a.signals,...b.signals])],errors=[...new Set([...a.errors,...b.errors])];
 return {allowed:a.allowed&&b.allowed,
  reason:signals.length?'ENTERTAINMENT_EXCLUDED':errors.length?'NEWS_SCOPE_INVALID':null,signals,errors};
}
export function filterCandidateScope(candidates) {
 const accepted=[],excluded=[];
 for(const candidate of candidates) {
  const scope=assessCandidateScope(candidate);
  if(scope.allowed)accepted.push(candidate);
  else excluded.push({candidate_id:candidate.id,word:candidate.word,event_id:candidate.event_id,
   reason:scope.reason,message:scope.reason==='ENTERTAINMENT_EXCLUDED'?'依本期規則排除娛樂新聞候選':'新聞範圍標記不合法',
   signals:scope.signals,errors:scope.errors});
 }
 return {accepted,excluded};
}
