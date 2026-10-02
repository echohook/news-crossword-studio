import {assessCandidateScope} from './news-policy.mjs';
import {createHash} from 'node:crypto';
import {validatePuzzle} from './validator.mjs';
import {validateClue} from './clues.mjs';
import {BLOCK,isHan} from './model.mjs';

const coordinateKey=(r,c)=>r+','+c;
function numberUnchecked(puzzle) {
 const starts=[...new Map(puzzle.placements.map(p=>[coordinateKey(p.row,p.col),[p.row,p.col]])).values()]
  .sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const numbers=new Map(starts.map(([r,c],i)=>[coordinateKey(r,c),i+1]));
 const candidates=new Map(puzzle.expected.map(c=>[c.id,c]));
 return puzzle.placements.map(p=>({...p,number:numbers.get(coordinateKey(p.row,p.col)),
  length:Array.from(candidates.get(p.candidate_id).word).length}))
  .sort((a,b)=>a.number-b.number||(a.direction==='H'?-1:1));
}
export function numberEntries(puzzle) {
 const snapshot=structuredClone(puzzle);
 if(!validatePuzzle(snapshot).valid)throw new Error('INVALID puzzle: numbering blocked');
 return numberUnchecked(snapshot);
}
const key=e=>e.direction+String(e.number).padStart(2,'0');
const normalize=s=>s.normalize('NFKC').replace(/[\p{P}\p{Z}\p{Cf}\s]/gu,'');
export function buildWorksheet(puzzle,{includeAnswers=false,maxClueChars=60}={}) {
 if(typeof includeAnswers!=='boolean')throw new Error('includeAnswers 必須是布林值');
 const snapshot=structuredClone(puzzle),validation=validatePuzzle(snapshot);
 if(!validation.valid)return {status:'INVALID',grid_status:'INVALID',approved_for_print:false,
  errors:[{code:'W00',message:'字盤未通過獨立 Validator，禁止建立試玩版'}]};
 const numbered=numberUnchecked(snapshot),candidates=new Map(snapshot.expected.map(c=>[c.id,c]));
 const errors=[],warnings=[];
 for(const e of numbered) {
  const c=candidates.get(e.candidate_id),report=validateClue(c,c.event,{maxChars:maxClueChars});
  const scope=assessCandidateScope(c);
  if(!scope.allowed)errors.push({code:scope.reason,entry_key:key(e),message:'本期排除娛樂新聞，不能建立此題的試玩版',details:[...scope.signals,...scope.errors]});
  const required=['C01','C02','C03','C04'];
  if(c.event&&c.event.fact_status!=='fixture')required.push('C05','C06');
  for(const check of report.checks.filter(c=>required.includes(c.id)&&!c.pass))
   errors.push({code:check.id,entry_key:key(e),message:check.label});
  const clue=typeof c.clue==='string'?normalize(c.clue):'';
  for(const other of numbered) {
   if(other.candidate_id!==e.candidate_id && clue.includes(normalize(candidates.get(other.candidate_id).word)))
    warnings.push({code:'OTHER_ANSWER_IN_CLUE',entry_key:key(e),other_entry_key:key(other),
     message:'題目提及另一題答案，試玩前建議調整'});
  }
 }
 if(errors.length)return {status:'INVALID',grid_status:'VALID',approved_for_print:false,errors};
 const canonical=numbered.map(e=>({number:e.number,direction:e.direction,row:e.row,col:e.col,
  word:candidates.get(e.candidate_id).word,clue:candidates.get(e.candidate_id).clue}));
 const worksheet_id=createHash('sha256').update(JSON.stringify({size:snapshot.board.length,entries:canonical})).digest('hex');
 const startNumbers=new Map(numbered.map(e=>[coordinateKey(e.row,e.col),e.number]));
 const board=snapshot.board.map((row,r)=>row.map((char,c)=>{
  const cell={block:char===BLOCK,number:startNumbers.get(coordinateKey(r,c))??null};
  if(includeAnswers&&!cell.block)cell.value=char;
  return cell;
 }));
 const clues={H:[],V:[]};
 for(const e of numbered) {
  const c=candidates.get(e.candidate_id);
  const clue={number:e.number,direction:e.direction,row:e.row,col:e.col,length:e.length,clue:c.clue};
  if(includeAnswers)clue.answer=c.word;
  clues[e.direction].push(clue);
 }
 return {schema_version:'1.0',status:'TRIAL_READY',mode:includeAnswers?'answers':'player',
  worksheet_id,coordinate_base:0,size:snapshot.board.length,entry_count:numbered.length,
  board,clues,grid_status:'VALID',validation_checks:validation.checks.map(c=>({id:c.id,pass:c.pass})),
  review_status:'REQUIRED',approved_for_print:false,clue_warnings:warnings,
  note:'文字試玩版；字盤合法，不代表新聞內容及題目唯一性已完成編輯複核。'};
}
export function createAnswerTemplate(puzzle,{maxClueChars=60}={}) {
 const sheet=buildWorksheet(puzzle,{maxClueChars});
 if(sheet.status!=='TRIAL_READY')return sheet;
 return {schema_version:'1.0',worksheet_id:sheet.worksheet_id,
  answers:[...sheet.clues.H,...sheet.clues.V].sort((a,b)=>a.number-b.number||(a.direction==='H'?-1:1))
   .map(e=>({number:e.number,direction:e.direction,answer:''}))};
}
export function formatWorksheet(sheet) {
 if(sheet.status!=='TRIAL_READY')return '無法建立文字試玩版\n'+sheet.errors.map(e=>e.code+' '+(e.entry_key??'')+' '+e.message).join('\n');
 const lines=['時事填字樂 V1.0 — '+(sheet.mode==='answers'?'答案版':'作答版')+'（試玩）',
  sheet.size+'×'+sheet.size+' / '+sheet.entry_count+' 題',
  '■ 阻隔格 / □ 作答格；格內數字為題號，座標從 1 開始。',''];
 lines.push('列→   '+Array.from({length:sheet.size},(_,i)=>String(i+1).padStart(3,' ')).join('    '));
 for(const [r,row] of sheet.board.entries())lines.push(String(r+1).padStart(2,'0')+' | '+row.map(cell=>{
  const n=cell.number===null?'  ':String(cell.number).padStart(2,'0');
  return '['+n+(cell.block?BLOCK:cell.value??'□')+']';
 }).join(' '));
 for(const dir of ['H','V']) {
  lines.push('',dir==='H'?'橫向題目（由左至右）':'直向題目（由上至下）');
  for(const e of sheet.clues[dir]) {
   lines.push(key(e)+' 起點 ('+(e.row+1)+','+(e.col+1)+')：'+e.clue);
   if(sheet.mode==='answers')lines.push('  答案：'+e.answer);
  }
 }
 for(const warning of sheet.clue_warnings)lines.push('提醒 '+warning.entry_key+' / '+warning.other_entry_key+'：'+warning.message);
 lines.push('',sheet.note);
 return lines.join('\n');
}
function validateSubmission(submission,entries,id) {
 if(!submission||Array.isArray(submission)||typeof submission!=='object'||
  submission.schema_version!=='1.0'||submission.worksheet_id!==id||!Array.isArray(submission.answers))
  throw new Error('作答資料格式或 worksheet_id 不一致，請使用本張題目的作答範本');
 if(Object.keys(submission).some(k=>!['schema_version','worksheet_id','answers'].includes(k)))
  throw new Error('作答資料有未知欄位');
 const known=new Set(entries.map(key)),answers=new Map();
 for(const a of submission.answers) {
  if(!a||typeof a!=='object'||Array.isArray(a)||!Number.isSafeInteger(a.number)||a.number<1||
   !['H','V'].includes(a.direction)||typeof a.answer!=='string'||
   Object.keys(a).some(k=>!['number','direction','answer'].includes(k)))
   throw new Error('每筆作答必須有 number、H/V direction 及 answer 字串');
  const entryKey=key(a),word=a.answer.trim();
  if(!known.has(entryKey)||answers.has(entryKey))throw new Error('未知或重複的題號：'+entryKey);
  if(Array.from(word).length>4||!Array.from(word).every(isHan))
   throw new Error('作答只能填零至四個中文字：'+entryKey);
  answers.set(entryKey,word);
 }
 return answers;
}
export function gradeAnswers(puzzle,submission,{reveal=false,maxClueChars=60}={}) {
 if(typeof reveal!=='boolean')throw new Error('reveal 必須是布林值');
 const sheet=buildWorksheet(puzzle,{includeAnswers:true,maxClueChars});
 if(sheet.status!=='TRIAL_READY')return sheet;
 const entries=[...sheet.clues.H,...sheet.clues.V].sort((a,b)=>a.number-b.number||(a.direction==='H'?-1:1));
 const answers=validateSubmission(submission,entries,sheet.worksheet_id);
 const attempts=[],occupied=new Map();
 for(const e of entries) {
  const answer=answers.get(key(e))??'';
  const status=!answer?'UNANSWERED':answer===e.answer?'CORRECT':'INCORRECT';
  const result={number:e.number,direction:e.direction,status,submitted_answer:answer};
  if(answer&&Array.from(answer).length!==e.length)result.reason='LENGTH_MISMATCH';
  if(reveal)result.expected_answer=e.answer;
  attempts.push(result);
  if(Array.from(answer).length===e.length) {
   Array.from(answer).forEach((char,i)=>{
    const row=e.row+(e.direction==='V'?i:0),col=e.col+(e.direction==='H'?i:0),cell=coordinateKey(row,col);
    if(!occupied.has(cell))occupied.set(cell,[]);
    occupied.get(cell).push({entry_key:key(e),char,row,col});
   });
  }
 }
 const crossing_conflicts=[];
 for(const items of occupied.values())if(items.length>1&&new Set(items.map(i=>i.char)).size>1)
  crossing_conflicts.push({row:items[0].row,col:items[0].col,attempts:items.map(({entry_key,char})=>({entry_key,char}))});
 const correct=attempts.filter(a=>a.status==='CORRECT').length,answered=attempts.filter(a=>a.status!=='UNANSWERED').length;
 return {schema_version:'1.0',status:'GRADED',worksheet_id:sheet.worksheet_id,revealed:reveal,
  solved:correct===attempts.length,total:attempts.length,answered,correct,
  score:Math.round(correct/attempts.length*10000)/100,results:attempts,crossing_conflicts,
  coordinate_base:0,grid_status:'VALID',review_status:'REQUIRED',approved_for_print:false};
}
export function formatGrade(report) {
 if(report.status!=='GRADED')return formatWorksheet(report);
 const labels={CORRECT:'正確',INCORRECT:'錯誤',UNANSWERED:'未作答'};
 const lines=['作答檢查：'+report.correct+'/'+report.total+' 題正確 / '+report.score+' 分',
  '已作答 '+report.answered+' 題 / '+(report.solved?'全部答對':'尚未全部答對')];
 for(const r of report.results) {
  lines.push(key(r)+' '+labels[r.status]+(r.reason==='LENGTH_MISMATCH'?'（字數不符）':''));
  if(report.revealed)lines.push('  正確答案：'+r.expected_answer);
 }
 for(const c of report.crossing_conflicts)lines.push('交叉填字不一致 @ ('+(c.row+1)+','+(c.col+1)+')：'+c.attempts.map(a=>a.entry_key+'='+a.char).join(' / '));
 return lines.join('\n');
}
