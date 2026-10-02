import {assessCandidateScope,ENTERTAINMENT_LABELS} from './news-policy.mjs';
import {collectEvents,generateCandidates,scoreValue,ANSWER_WEIGHTS} from './news.mjs';
import {validateClue} from './clues.mjs';
import {checkCandidates} from './model.mjs';
import {solve,solverSettings} from './solver.mjs';
import {validatePuzzle} from './validator.mjs';
import {formatSelection} from './selection.mjs';

const reviews=[
  {id:'NEWS_FACT_CHECK',message:'核對真正來源、摘錄上下文與新聞事實'},
  {id:'FRESHNESS_RECHECK',message:'輸出前重新查核重大更新、否認或更正'},
  {id:'CLUE_UNIQUENESS',message:'確認題目自然且答案唯一'},
  {id:'TAIWAN_LANGUAGE',message:'確認台灣慣用詞與譯名'},
  {id:'POLITICAL_NEUTRALITY',message:'確認題目沒有主觀政治判斷'},
  {id:'SENIOR_DIFFICULTY',message:'確認長輩理解與書寫難度'}
];
export function runPipeline(packet,{solverOptions={},maxClueChars=60}={}) {
  if(!packet||typeof packet!=='object'||Array.isArray(packet)) throw new Error('新聞輸入必須是物件');
  if(packet.dataset_mode!==undefined&&!['news','fixture'].includes(packet.dataset_mode)) throw new Error('dataset_mode 必須為 news 或 fixture');
  if(!Number.isInteger(maxClueChars)||maxClueChars<10||maxClueChars>300) throw new Error('maxClueChars 需為 10～300 整數');
  const config=solverSettings(solverOptions);
  const fixture=packet.dataset_mode==='fixture';
  const news=collectEvents(packet.events,{issueDate:packet.issue_date,fixture});
  const proposed=packet.candidates===undefined?generateCandidates(news.accepted):packet.candidates;
  if(!Array.isArray(proposed)) throw new Error('candidates 必須是陣列');
  const eventMap=new Map(news.accepted.map(e=>[e.event_id,e]));
  const ids=new Map();
  for(const c of proposed) if(typeof c?.id==='string') ids.set(c.id,(ids.get(c.id)??0)+1);
  const admitted=[],candidateReports=[];
  for(const [index,raw] of proposed.entries()) {
    const errors=[];
    try {checkCandidates([raw]);} catch(e){errors.push({code:'A01',message:e.message});}
    if(ids.get(raw?.id)>1)errors.push({code:'DUPLICATE_ID',message:'同批候選 ID 重複，需修正輸入'});
    const canonical=news.aliases.get(raw?.event_id),event=eventMap.get(canonical);
    if(!event)errors.push({code:'A02',message:'事件不存在或未通過 E01～E06'});
    const score=scoreValue(raw,'answer_score',ANSWER_WEIGHTS);
    if(score.error||score.value<70)errors.push({code:'A03',message:score.error??'Answer Score 至少 70'});
    if(event && raw?.event_revision!==undefined && raw.event_revision!==event.content_revision) errors.push({code:'A04',message:'候選綁定的新聞版本已更新，請重新產生題目'});
    if(event?.supersedes_candidates && raw?.event_revision!==event.content_revision)errors.push({code:'A04',message:'此事件有重大更新，舊候選需重新產生並綁定最新版本'});
    const candidate={...raw,event_id:canonical,answer_score:score.value??null,event};
    const resolvedScope=assessCandidateScope(candidate),rawScope=assessCandidateScope(raw);
    const scope={allowed:resolvedScope.allowed&&rawScope.allowed,signals:[...new Set([...resolvedScope.signals,...rawScope.signals])],errors:[...new Set([...resolvedScope.errors,...rawScope.errors])]};
    if(!scope.allowed)errors.push({code:'A05',message:'娛樂新聞或不合法的新聞範圍標記不得入選',details:[...scope.signals,...scope.errors]});
    const clueReport=event?validateClue(candidate,event,{maxChars:maxClueChars}):null;
    if(clueReport&&!clueReport.passed) for(const c of clueReport.checks.filter(c=>!c.pass)) errors.push({code:c.id,message:c.label,details:c.details});
    const report={index,candidate_id:raw?.id??null,word:raw?.word??null,event_id:canonical??raw?.event_id??null,passed:errors.length===0,errors,clue_report:clueReport};
    candidateReports.push(report);
    if(report.passed)admitted.push({candidate,report});
  }
  admitted.sort((a,b)=>b.candidate.answer_score-a.candidate.answer_score ||
    b.candidate.event.event_score-a.candidate.event.event_score ||
    (a.candidate.id<b.candidate.id?-1:a.candidate.id>b.candidate.id?1:0));
  const words=new Set(),candidates=[];
  for(const a of admitted) {
    if(words.has(a.candidate.word)) {
      a.report.passed=false;a.report.errors.push({code:'DUPLICATE_ANSWER',message:'同答案已由較高評分或穩定 ID 順序的候選提供'});
    } else {words.add(a.candidate.word);candidates.push(a.candidate);}
  }
  const allAnchors=news.accepted.filter(e=>e.anchor_event===true);
  const base={schema_version:'1.0',issue_date:packet.issue_date,dataset_mode:fixture?'fixture':'news',
    window:news.window,policy:{windowDays:7,eventScoreMin:60,answerScoreMin:70,maxClueChars,eventAnswerLimit:2,excludeEntertainment:true,excludedLabels:ENTERTAINMENT_LABELS},
    event_summary:{input:news.inputCount,deduplicated:news.eventCount,admitted:news.accepted.length},
    event_reports:news.reports,candidate_summary:{input:proposed.length,admitted:candidates.length,rejected:proposed.length-candidates.length},
    candidate_reports:candidateReports,eligible_candidates:candidates,
    quality_summary:{anchor_coverage:{required:allAnchors.length,covered:0},
      missing_anchors:allAnchors.map(e=>({event_id:e.event_id,title:e.title})),
      category_counts:{},length_balance:null,selection_quality:null,selection_warnings:[]},
    approved_for_print:false,review_required:structuredClone(reviews),
    note:fixture?'合成資料僅供管線測試，未宣稱為真實新聞。':'來源與評分為輸入資料；機械檢查不等於已完成事實查核。'};
  if(!candidates.length) return {...base,status:'NO_ELIGIBLE_CANDIDATES',grid_status:null,puzzle:null,solver_result:null,grid_validation:null,clue_validation:[]};
  const result=solve(candidates,config);
  const puzzle=result.puzzle;
  const grid=puzzle?validatePuzzle(puzzle):null;
  const clues=puzzle?puzzle.expected.map(c=>validateClue(c,eventMap.get(c.event_id),{maxChars:maxClueChars})):[];
  const usedEvents=new Set(puzzle?.expected.map(c=>c.event_id)??[]);
  const missingAnchors=allAnchors.filter(e=>!usedEvents.has(e.event_id)).map(e=>({event_id:e.event_id,title:e.title}));
  const categoryCounts=new Map();
  for(const c of puzzle?.expected??[]) for(const category of new Set(c.event.categories)) categoryCounts.set(category,(categoryCounts.get(category)??0)+1);
  let status=result.status;
  if(puzzle && (!grid.valid||clues.some(c=>!c.passed)))status='INVALID';
  else if(result.status==='SOLVED')status='REVIEW_REQUIRED';
  const quality={anchor_coverage:{required:allAnchors.length,covered:allAnchors.length-missingAnchors.length},missing_anchors:missingAnchors,category_counts:Object.fromEntries(categoryCounts),length_balance:grid?.balance??null,
    selection_quality:result.selection_quality,selection_warnings:result.selection_warnings};
  return {...base,status,grid_status:grid?.status??null,puzzle,solver_result:result,grid_validation:grid,clue_validation:clues,quality_summary:quality};
}
export function formatPipeline(report) {
  const lines=['PIPELINE '+report.status+' — '+report.window.from+' ～ '+report.window.to,
    '事件：'+report.event_summary.input+' 筆 → 去重 '+report.event_summary.deduplicated+' 件 → 合格 '+report.event_summary.admitted+' 件',
    '候選：'+report.candidate_summary.input+' 題 → 合格 '+report.candidate_summary.admitted+' 題',
    report.note];
  for(const e of report.event_reports.filter(e=>!e.passed)) lines.push('排除事件 '+e.event_id+': '+e.checks.filter(c=>!c.pass).map(c=>c.id+' '+c.message+(c.details?.length?' ('+c.details.join(' / ')+')':'')).join('；'));
  for(const c of report.candidate_reports.filter(c=>!c.passed)) lines.push('排除候選 '+(c.word??c.candidate_id??'#'+c.index)+': '+c.errors.map(e=>e.code+' '+e.message).join('；'));
  if(report.quality_summary?.anchor_coverage)lines.push('本期合格重點新聞涵蓋：'+report.quality_summary.anchor_coverage.covered+'/'+report.quality_summary.anchor_coverage.required);
  if(report.quality_summary?.selection_quality)lines.push(formatSelection(report.quality_summary.selection_quality,report.quality_summary.selection_warnings));
  for(const e of report.quality_summary?.missing_anchors??[]) lines.push('Anchor 未入盤：'+e.title);
  lines.push('題目機械檢查：'+report.clue_validation.filter(c=>c.passed).length+'/'+report.clue_validation.length+' PASS');
  lines.push('內容複核：REQUIRED / 正式出版核准：否');
  lines.push(...report.review_required.map(r=>'待複核 '+r.id+' — '+r.message));
  return lines.join('\n');
}