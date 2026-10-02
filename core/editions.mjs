import {createHash} from 'node:crypto';
import {runMixed} from './mixed.mjs';
import {runPipeline} from './pipeline.mjs';
import {solve,solverSettings} from './solver.mjs';
import {checkCandidates} from './model.mjs';
import {sourceUrl} from './news.mjs';
import {validatePuzzle} from './validator.mjs';
import {buildWorksheet} from './worksheet.mjs';
import {MAX_EDITIONS,answerKey,clueKey,validateEditionDiversity} from './edition-policy.mjs';

/** Used answers and clues are removed before searching each next edition.
 * Shared characters remain permitted: only whole answers / questions are unique.
 */
export function generateEditions(input,{count=1,solverOptions={},maxVariantAttempts=3,maxClueChars=60}={}) {
 if(!Number.isSafeInteger(count)||count<1||count>MAX_EDITIONS)throw Error('份數需為 1～7 的整數');
 if(!Number.isSafeInteger(maxVariantAttempts)||maxVariantAttempts<1||maxVariantAttempts>10)throw Error('每份搜尋次數需為 1～10 的整數');
 if(!input||typeof input!=='object')throw Error('需提供題庫輸入');
 const mode=input.news?'mixed':Array.isArray(input)||Array.isArray(input.candidates)?'candidates':'news';
 const snapshot=structuredClone(input);
 const {maxClueChars:ignored,...options}=solverOptions;
 if(ignored!==undefined)throw Error('maxClueChars 應獨立設定');
 const settings=solverSettings({attempts:mode==='mixed'?256:48,seed:2,minEntries:options.target??12,...options});
 const editions=[],usedWords=new Set(),usedClues=new Set(),attempts=[];
 let pool,initial=null,mix=null;
 if(mode==='mixed') {
  initial=runMixed(snapshot,{solverOptions:{...options,attempts:settings.attempts,seed:settings.seed},maxClueChars});
  mix=initial.content_summary.requested;
  const admitted=new Set(initial.idiom_reports.filter(r=>r.passed).map(r=>r.id));
  pool=[...initial.news_report.eligible_candidates.map(c=>({...c,content_kind:'news'})),
   ...snapshot.idioms.filter(c=>admitted.has(c.id)).map(c=>({...c,content_kind:'idiom',
    knowledge_source:{...c.knowledge_source,url:sourceUrl(c.knowledge_source.url)}}))];
 } else if(mode==='news') {
  initial=runPipeline(snapshot,{solverOptions:{...settings,minEntries:settings.target},maxClueChars});
  pool=initial.eligible_candidates;
 } else {pool=Array.isArray(snapshot)?snapshot:snapshot.candidates;checkCandidates(pool);}
 const target=mix?mix.news+mix.idiom:settings.target;
 const searchSettings={...settings,target,minEntries:target,...(mix?{contentTargets:mix}:{})};
 let shortage=null;
 for(let attempt=0;attempt<count*maxVariantAttempts && editions.length<count;attempt++) {
  const remaining=pool.filter(c=>!usedWords.has(answerKey(c.word))&&!usedClues.has(clueKey(c.clue)));
  const available={total:remaining.length};
  if(mix)for(const kind of ['news','idiom'])available[kind]=remaining.filter(c=>c.content_kind===kind).length;
  if(available.total<target||(mix&&['news','idiom'].some(k=>available[k]<mix[k]))) {
   shortage={code:'REMAINING_POOL_TOO_SMALL',next_edition:editions.length+1,available,
    needed_for_next:{total:target,...(mix??{})}};
   attempts.push({status:shortage.code,...shortage});break;
  }
  const seed=(settings.seed+Math.imul(attempt,2654435761))>>>0;
  const result=attempt===0&&initial?initial:solve(remaining,{...searchSettings,seed});
  const puzzle=result.puzzle;
  if(!puzzle||puzzle.expected.length!==target){attempts.push({seed,status:'NO_FULL_PUZZLE'});continue;}
  const validation=validatePuzzle(puzzle);
  if(!validation.valid){attempts.push({seed,status:'INVALID_GRID'});continue;}
  const diversity=validateEditionDiversity([...editions,{puzzle}]);
  if(!diversity.valid){attempts.push({seed,status:'REPEATED_CONTENT',errors:diversity.errors});continue;}
  const player=buildWorksheet(puzzle,{maxClueChars}),answers=buildWorksheet(puzzle,{includeAnswers:true,maxClueChars});
  if(player.status!=='TRIAL_READY'||answers.status!=='TRIAL_READY'||player.clue_warnings.length) {
   attempts.push({seed,status:'WORKSHEET_REJECTED'});continue;
  }
  puzzle.expected.forEach(c=>{usedWords.add(answerKey(c.word));usedClues.add(clueKey(c.clue));});
  const edition_number=editions.length+1;
  const selected=mix?Object.fromEntries(['news','idiom'].map(k=>[k,puzzle.expected.filter(c=>c.content_kind===k).length])):null;
  if(mix&&['news','idiom'].some(k=>selected[k]!==mix[k]))throw Error('混合配額未達標');
  editions.push({edition_number,label:'第 '+edition_number+' 份',seed,puzzle,grid_validation:validation,
   player,answers,...(mix?{content_summary:{requested:{...mix},selected}}:{}),approved_for_print:false});
  attempts.push({seed,status:'ACCEPTED',edition_number});
 }
 return {schema_version:'1.1',mode,status:editions.length===count?'COMPLETE':'INCOMPLETE',
  requested_count:count,generated_count:editions.length,render_settings:{maxClueChars},issue_date:input.news?.issue_date??input.issue_date??null,
  batch_id:createHash('sha256').update(JSON.stringify(editions.map(e=>e.player.worksheet_id))).digest('hex'),
  repetition_policy:'NO_REPEATED_ANSWERS_OR_CLUES',diversity_validation:validateEditionDiversity(editions),shortage,
  editions,attempts,approved_for_print:false,review_required:['CONTENT_AND_CLUE_REVIEW'],
  note:'同一批次各份的題目與答案均不得重複；換提示、改編號或換位置也不能重用相同答案。搜尋有上限，不保證指定份數必定可達成。'};
}
export function formatEditions(report) {
 const lines=['多份產題：'+report.status,'指定 '+report.requested_count+' 份 / 完成 '+report.generated_count+' 份'];
 for(const e of report.editions) {
  lines.push('',e.label+' / '+e.puzzle.board.length+'×'+e.puzzle.board.length+' / '+e.puzzle.expected.length+' 題');
  for(const check of e.grid_validation.checks)lines.push(check.id+' '+(check.pass?'PASS':'FAIL'));
  lines.push('整體 '+e.grid_validation.status);
 }
 if(report.status==='INCOMPLETE') {
  if(report.shortage) {
   const s=report.shortage;
   lines.push('未使用候選題目不足：下一份需 '+s.needed_for_next.total+' 題，剩餘 '+s.available.total+' 題。');
   if(s.needed_for_next.idiom!==undefined)lines.push('成語需 '+s.needed_for_next.idiom+' 題，剩餘 '+s.available.idiom+' 題；時事需 '+s.needed_for_next.news+' 題，剩餘 '+s.available.news+' 題。');
  } else lines.push('未達指定份數；請增加候選題目或提高搜尋次數後再試。');
 }
 lines.push(report.note,'內容複核：REQUIRED');
 return lines.join('\n');
}
