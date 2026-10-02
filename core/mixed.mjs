import {runPipeline} from './pipeline.mjs';
import {solve,solverSettings} from './solver.mjs';
import {checkCandidates} from './model.mjs';
import {validateClue} from './clues.mjs';
import {validatePuzzle} from './validator.mjs';
import {sourceUrl,text} from './news.mjs';
import {assessCandidateScope} from './news-policy.mjs';

/** Prefer idioms, but replace unavailable or unplaceable idioms with news. */
export function solveMixedPool(pool,mix,solverOptions={}) {
 const target=mix.news+mix.idiom;
 const available={news:pool.filter(c=>c.content_kind==='news').length,idiom:pool.filter(c=>c.content_kind==='idiom').length};
 const preferred=Math.min(mix.idiom,available.idiom),minimum=Math.max(0,target-available.news),attempted=[];
 let effective={news:target-preferred,idiom:preferred};
 let result={status:'SEARCH_EXHAUSTED',puzzle:null,diagnostics:[],reason:'INSUFFICIENT_CANDIDATES'};
 for(let idiom=preferred;idiom>=minimum;idiom--) {
  effective={news:target-idiom,idiom};
  result=solve(pool,{...solverOptions,target,minEntries:target,contentTargets:effective});
  attempted.push({...effective,status:result.status});
  if(result.puzzle)break;
 }
 return {result,effective,attempted};
}
export function runMixed(packet,{solverOptions={},maxClueChars=60}={}) {
 if(!packet||typeof packet!=='object'||Array.isArray(packet)||!packet.news)throw Error('mixed 輸入需有 news；idioms 可省略');
 const mix=packet.mix===undefined?{news:8,idiom:4}:packet.mix;
 if(!mix||Array.isArray(mix)||Object.keys(mix).length!==2||Object.keys(mix).some(k=>!['news','idiom'].includes(k))||
  !['news','idiom'].every(k=>Number.isInteger(mix[k])&&mix[k]>=(k==='news'?1:0))||mix.news+mix.idiom<2||mix.news+mix.idiom>14)throw Error('mix 的 news 需為正整數、idiom 需為非負整數，總題數需為 2～14');
 const target=mix.news+mix.idiom;
 const settings=solverSettings({...solverOptions,target,minEntries:target,contentTargets:mix});
 if(['target','minEntries','contentTargets'].some(k=>Object.hasOwn(solverOptions,k)))throw Error('混合模式的題數及配額由 mix 設定');
 const proposed=structuredClone(packet.idioms===undefined?[]:packet.idioms),idioms=[],reports=[];
 if(!Array.isArray(proposed))throw Error('idioms 需為陣列');
 if(proposed.length)checkCandidates(proposed);
 for(const c of proposed) {
  const errors=[],source=c.knowledge_source;
  if(Array.from(c.word).length!==4)errors.push('成語模式只接受完整四字成語');
  if(c.event!==undefined||c.anchor_event===true)errors.push('成語不是新聞事件或新聞重點，不得附 event 或 anchor_event=true');
  if(!source||!text(source.publisher)||!sourceUrl(source.url)||!text(source.meaning))errors.push('成語需有辭典來源與釋義');
  if(!assessCandidateScope(c).allowed)errors.push('內容分類不符合選題範圍');
  const clue=validateClue(c,undefined,{maxChars:maxClueChars});
  errors.push(...clue.checks.filter(x=>['C01','C02','C03','C04'].includes(x.id)&&!x.pass).map(x=>x.id+' '+x.label));
  reports.push({id:c.id,word:c.word,passed:!errors.length,errors,semantic_review:'REQUIRED'});
  if(!errors.length)idioms.push({...c,content_kind:'idiom',knowledge_source:{...source,url:sourceUrl(source.url)}});
 }
 const news=runPipeline(packet.news,{maxClueChars});
 const pool=[...news.eligible_candidates.map(c=>({...c,content_kind:'news'})),...idioms];
 if(pool.length)checkCandidates(pool);
 const searched=solveMixedPool(pool,mix,settings),result=searched.result,puzzle=result.puzzle,validation=puzzle?validatePuzzle(puzzle):null;
 const selected={news:0,idiom:0};puzzle?.expected.forEach(c=>selected[c.content_kind]++);
 if(puzzle&&(!validation.valid||['news','idiom'].some(k=>selected[k]!==searched.effective[k])))throw Error('混合盤未通過獨立驗證或配額檢查');
 return {schema_version:'1.0',mode:'news_and_idioms',issue_date:packet.news.issue_date,
  status:result.status==='SOLVED'?'REVIEW_REQUIRED':result.status,puzzle,grid_validation:validation,
  content_summary:{requested:{...mix},effective:searched.effective,selected,idiom_optional:true,fallback:selected.idiom<mix.idiom},news_report:news,idiom_reports:reports,solver_result:result,
  approved_for_print:false,review_required:['NEWS_FACT_CHECK','CLUE_UNIQUENESS','IDIOM_MEANING_AND_USAGE'],
  note:'時事使用七日窗口；成語優先加入，不足或無法排入時以時事補足，允許零成語。成語不套用新聞日期。'};
}
export function formatMixed(report) {
 const c=report.content_summary;
 return ['MIXED '+report.status,'時事 '+c.selected.news+' 題；成語 '+c.selected.idiom+' 題（成語優先目標 '+c.requested.idiom+' 題，不足以時事補足）',
  report.note,...report.idiom_reports.filter(r=>!r.passed).map(r=>'排除成語 '+r.word+'：'+r.errors.join('；')),
  '內容複核：REQUIRED'].join('\n');
}