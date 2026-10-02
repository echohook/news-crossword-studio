import {validatePuzzle} from './validator.mjs';
import {lengthBalance,BLOCK} from './model.mjs';
import {buildWorksheet} from './worksheet.mjs';

const CATEGORIES=['台灣','國際','科技','財經','體育','生活','文化'];
const THEMES=CATEGORIES.filter(c=>!['台灣','國際'].includes(c));
const WEIGHTS={length_balance:20,category_diversity:20,cross_topic:15,difficulty_balance:20,compactness:15,anchor_coverage:10};
const rounded=n=>Math.round(n*100)/100;
const bounded=n=>Math.min(1,Math.max(0,n));
const tags=c=>{
 const raw=c.event?.categories??c.categories??(c.event?.category?[c.event.category]:[]);
 return Array.isArray(raw)?[...new Set(raw.filter(t=>CATEGORIES.includes(t)))]:[];
};
function rating(id,fraction,details,status=fraction===null?'UNASSESSED':'ASSESSED') {
 return {id,weight:WEIGHTS[id],score:fraction===null?null:rounded(WEIGHTS[id]*bounded(fraction)),status,details};
}
function validateTarget(target) {
 if(!target||Array.isArray(target)||Object.keys(target).length!==3||
  ['easy','medium','hard'].some(k=>!Object.hasOwn(target,k)||typeof target[k]!=='number'||!Number.isFinite(target[k])||target[k]<0||target[k]>1)||
  Math.abs(target.easy+target.medium+target.hard-1)>1e-8)
  throw new Error('difficultyTarget 必須是 easy/medium/hard 比例，總和為 1');
}
function coverageContext(input) {
 const c=input?.quality_summary?.anchor_coverage;
 if(c!==undefined) {
  if(!c||!Number.isSafeInteger(c.required)||!Number.isSafeInteger(c.covered)||c.required<0||c.covered<0||c.covered>c.required)
   throw new Error('anchor_coverage 數據不合法');
  return {required:c.required,covered:c.covered};
 }
 const q=input?.selection_quality;
 if(q!==undefined) {
  if(!q||!Array.isArray(q.anchor_event_ids)||!Array.isArray(q.covered_anchor_event_ids)||
   ![...q.anchor_event_ids,...q.covered_anchor_event_ids].every(id=>typeof id==='string'&&id.trim()))
   throw new Error('selection_quality 重點事件資料不合法');
  const required=new Set(q.anchor_event_ids),covered=new Set(q.covered_anchor_event_ids);
  if([...covered].some(id=>!required.has(id)))throw new Error('重點事件涵蓋範圍不合法');
  return {required:required.size,covered:covered.size};
 }
 return null;
}
export function assessQuality(input,{difficultyTarget={easy:0.5,medium:0.5,hard:0},maxClueChars=60}={}) {
 validateTarget(difficultyTarget);
 if(!Number.isInteger(maxClueChars)||maxClueChars<10||maxClueChars>300)throw new Error('maxClueChars 需為 10～300 整數');
 const snapshot=structuredClone(input),puzzle=snapshot&&Object.hasOwn(snapshot,'puzzle')?snapshot.puzzle:snapshot;
 const validation=validatePuzzle(puzzle),anchor=coverageContext(snapshot);
 const gates=[
  {id:'GRID',status:validation.valid?'PASS':'FAIL'},
  {id:'NEWS_FACTS_AND_FRESHNESS',status:'REVIEW_REQUIRED'},
  {id:'CLUE_UNIQUENESS',status:'REVIEW_REQUIRED'},
  {id:'CLUE_MECHANICS',status:'UNASSESSED'},
  {id:'NEWS_SCOPE',status:'UNASSESSED'}
 ];
 if(!validation.valid)return {schema_version:'1.0',status:'INVALID',grid_status:'INVALID',gates,
  metrics:[],total_score:null,available_score:0,available_weight:0,approved_for_print:false,
  validation_errors:[...validation.structural,...validation.checks.flatMap(c=>c.errors)],
  note:'無效盤不計算品質分數。'};
 const trial=buildWorksheet(puzzle,{maxClueChars});
 const codes=new Set(trial.errors?.map(e=>e.code)??[]);
 gates[3].status=[...codes].some(c=>/^C\d+$/.test(c))?'FAIL':'PASS';
 gates[4].status=['ENTERTAINMENT_EXCLUDED','NEWS_SCOPE_INVALID'].some(c=>codes.has(c))?'FAIL':'PASS';
 if(['C01','C04'].some(c=>codes.has(c)))gates[2].status='FAIL';
 if(['C05','C06'].some(c=>codes.has(c)))gates[1].status='FAIL';
 const n=puzzle.expected.length,balance=lengthBalance(puzzle.expected),ideal=n%3===0?0:4;
 const metrics=[rating('length_balance',1-(balance.penalty-ideal)/(4*n-ideal),balance)];
 const categoryCounts=Object.fromEntries(CATEGORIES.map(c=>[c,0]));
 let categoryKnown=0;
 for(const c of puzzle.expected) {
  const t=tags(c);if(t.length)categoryKnown++;
  t.forEach(tag=>categoryCounts[tag]++);
 }
 const tagCount=Object.values(categoryCounts).reduce((a,b)=>a+b,0);
 const entropy=tagCount?Object.values(categoryCounts).filter(c=>c>0).reduce((s,c)=>s-(c/tagCount)*Math.log(c/tagCount),0):0;
 metrics.push(rating('category_diversity',categoryKnown===n?entropy/Math.log(CATEGORIES.length):null,
  {category_counts:categoryCounts,entries_with_categories:categoryKnown,total_entries:n,multiple_tags:true}));
 const byId=new Map(puzzle.expected.map(c=>[c.id,c])),pairs=new Map();
 for(const [id,intersections] of Object.entries(validation.intersections))for(const x of intersections) {
  const pair=[id,x.with].sort(),pairKey=JSON.stringify(pair);
  if(!pairs.has(pairKey))pairs.set(pairKey,pair);
 }
 let crossTopic=0,classified=0;
 for(const [a,b] of pairs.values()) {
  const left=tags(byId.get(a)).filter(t=>THEMES.includes(t)),right=tags(byId.get(b)).filter(t=>THEMES.includes(t));
  if(left.length&&right.length) {
   classified++;
   if(!left.some(t=>right.includes(t)))crossTopic++;
  }
 }
 metrics.push(rating('cross_topic',classified===pairs.size&&pairs.size?crossTopic/pairs.size:null,
  {unique_crossing_pairs:pairs.size,classified_pairs:classified,cross_topic_pairs:crossTopic,
   definition:'兩端已知主題類別不重疊；地理標籤不算主題，未推論詞義關係'}));
 const difficultyCounts={easy:0,medium:0,hard:0};
 let difficultyKnown=0;
 for(const c of puzzle.expected)if(Object.hasOwn(difficultyCounts,c.difficulty)){difficultyCounts[c.difficulty]++;difficultyKnown++;}
 const distance=Object.keys(difficultyCounts).reduce((s,k)=>s+Math.abs(difficultyCounts[k]/n-difficultyTarget[k]),0);
 metrics.push(rating('difficulty_balance',difficultyKnown===n?1-distance/2:null,
  {counts:difficultyCounts,known_entries:difficultyKnown,total_entries:n,target:difficultyTarget,
   note:'難度是輸入標籤；參考目標尚未經長輩試玩校準'}));
 const filled=[];
 puzzle.board.forEach((row,r)=>row.forEach((ch,c)=>{if(ch!==BLOCK)filled.push([r,c]);}));
 const rows=filled.map(c=>c[0]),cols=filled.map(c=>c[1]);
 const boxRows=Math.max(...rows)-Math.min(...rows)+1,boxCols=Math.max(...cols)-Math.min(...cols)+1;
 metrics.push(rating('compactness',filled.length/(boxRows*boxCols),
  {filled_cells:filled.length,bounding_rows:boxRows,bounding_cols:boxCols,density:rounded(filled.length/(boxRows*boxCols))}));
 metrics.push(rating('anchor_coverage',anchor?.required?anchor.covered/anchor.required:null,
  anchor??{note:'只有盤面無法得知未入盤的重點事件；請輸入完整 Solver 或 Pipeline 報告'},
  anchor?.required===0?'NOT_APPLICABLE':anchor===null?'UNASSESSED':'ASSESSED'));
 const scored=metrics.filter(m=>m.score!==null),sum=rounded(scored.reduce((s,m)=>s+m.score,0));
 return {schema_version:'1.0',status:gates.some(g=>g.status==='FAIL')?'INVALID':'REVIEW_REQUIRED',
  grid_status:'VALID',gates,metrics,total_score:scored.length===metrics.length?sum:null,
  available_score:sum,available_weight:scored.reduce((s,m)=>s+m.weight,0),
  approved_for_print:false,clue_warnings:trial.clue_warnings??[],
  semantic_relation_review:{status:'REVIEW_REQUIRED',reference_max_related_entry_ratio:0.2,
   note:'同義及上下位關係須人工標註，不能用同事件或共同字自動推定'},
  note:'權重依凍結規格；各項數值公式為原型參考，不會取代新聞、唯一性及正式出版資格檢查。'};
}
export function formatQuality(report) {
 const names={length_balance:'字數平衡',category_diversity:'主題多樣性',cross_topic:'跨主題交叉',
  difficulty_balance:'難度平衡',compactness:'盤面緊湊度',anchor_coverage:'重點新聞涵蓋'};
 const lines=['遊戲品質：'+report.status+' / 字盤：'+report.grid_status];
 for(const gate of report.gates)lines.push(gate.id+' '+gate.status);
 for(const m of report.metrics)lines.push(names[m.id]+'：'+(m.score===null?m.status:m.score+'/'+m.weight));
 lines.push(report.total_score===null?'已評估 '+report.available_score+'/'+report.available_weight+' 權重；未評估項目不補零':
  '原型參考分數：'+report.total_score+'/100');
 lines.push(...(report.validation_errors??[]));
 lines.push(report.note,'正式出版核准：否');
 return lines.join('\n');
}
