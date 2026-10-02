import {lengthBalance} from './model.mjs';

/** Editorial preferences never admit a placement or replace board validation. */
export const SELECTION_ORDER=[
 'entry_count_desc','grid_size_asc','anchor_event_coverage_desc',
 'length_within_half_first','length_penalty_asc','editorial_score_desc'
];
export function anchorEvents(candidates) {
 return [...new Set(candidates.filter(c=>c.anchor_event===true||c.event?.anchor_event===true)
  .map(c=>c.event_id))].sort();
}
const score=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100?n:0;
export function candidatePriority(c) {
 return 0.7*score(c.answer_score)+0.3*score(c.event?.event_score??c.event_score);
}
export function selectionQuality(answers,candidates) {
 const required=anchorEvents(candidates),used=new Set(answers.map(c=>c.event_id));
 const covered=required.filter(id=>used.has(id)),missing=required.filter(id=>!used.has(id));
 return {anchor_event_ids:required,covered_anchor_event_ids:covered,missing_anchor_event_ids:missing,
  length_balance:lengthBalance(answers),
  editorial_score:answers.length?answers.reduce((n,c)=>n+candidatePriority(c),0)/answers.length:0};
}
export function compareSelections(a,b,candidates) {
 const counts=b.expected.length-a.expected.length,sizes=a.board.length-b.board.length;
 if(counts||sizes)return counts||sizes;
 const aq=selectionQuality(a.expected,candidates),bq=selectionQuality(b.expected,candidates);
 return aq.missing_anchor_event_ids.length-bq.missing_anchor_event_ids.length ||
  Number(bq.length_balance.withinHalf)-Number(aq.length_balance.withinHalf) ||
  aq.length_balance.penalty-bq.length_balance.penalty ||
  bq.editorial_score-aq.editorial_score;
}
export function selectionDiagnostics(quality,candidates,analysis,target) {
 const isolated=new Set(analysis.isolated.map(c=>c.id));
 const warnings=quality.missing_anchor_event_ids.map(event_id=>{
  const choices=candidates.filter(c=>c.event_id===event_id);
  const unavailable=choices.every(c=>isolated.has(c.id));
  return {code:unavailable?'ANCHOR_NO_SHARED_CHARACTER':'ANCHOR_NOT_SELECTED',event_id,
   message:unavailable?'重點事件的全部候選都沒有共同字，請增加可交叉答案':
    '本次合法方案未涵蓋此重點事件；可能受題數、幾何或搜尋預算影響，未證明無法排入'};
 });
 if(quality.anchor_event_ids.length>target)warnings.push({code:'ANCHOR_TARGET_LIMIT',
  message:'重點事件數超過目標題數，無法在此目標內每件至少選一題'});
 return warnings;
}
export function formatSelection(quality,warnings=[]) {
 const lines=['候選重點事件涵蓋：'+quality.covered_anchor_event_ids.length+'/'+quality.anchor_event_ids.length+
  ' / 字數平衡差距：'+quality.length_balance.penalty+
  ' / 編輯評分：'+quality.editorial_score.toFixed(2)];
 lines.push(...warnings.map(w=>w.code+' — '+(w.event_id?w.event_id+'：':'')+w.message));
 return lines.join('\n');
}
