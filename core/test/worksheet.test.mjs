import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildWorksheet,numberEntries,formatWorksheet,createAnswerTemplate,gradeAnswers,formatGrade} from '../worksheet.mjs';
import {tech,makePuzzle,extraZhiChe} from './fixtures.mjs';
const playable=()=>{
 const p=tech();
 p.expected[0].clue='模擬人類思考能力的電腦技術領域。（4字）';
 p.expected[1].clue='不用機上駕駛操作的飛行器。（3字）';
 p.expected.forEach(c=>c.id='event::'+c.word);
 p.placements.forEach((e,i)=>e.candidate_id=p.expected[i].id);
 return p;
};
const fullAnswers=p=>{
 const t=createAnswerTemplate(p),sheet=buildWorksheet(p,{includeAnswers:true});
 const entries=[...sheet.clues.H,...sheet.clues.V];
 for(const a of t.answers)a.answer=entries.find(e=>e.number===a.number&&e.direction===a.direction).answer;
 return t;
};
const shared=()=>{
 const p=makePuzzle([['黃金','H',0,0],['黃牌','V',0,0]]);
 p.expected[0].clue='常用於首飾的黃色貴金屬。（2字）';
 p.expected[1].clue='足球裁判警告球員時出示的卡片。（2字）';
 return p;
};
const cwd=fileURLToPath(new URL('..',import.meta.url));
const cli=args=>spawnSync(process.execPath,['cli.mjs',...args],{cwd,encoding:'utf8',timeout:30000});

test('numbering is row-major and H/V sharing a start share a number',()=>{
 const p=shared(),entries=numberEntries(p);
 assert.deepEqual(entries.map(e=>[e.number,e.direction]),[[1,'H'],[1,'V']]);
 const t=numberEntries(playable());
 assert.deepEqual(t.map(e=>[e.number,e.direction]),[[1,'V'],[2,'H']]);
});
test('player JSON and text omit answer cells, answers and internal answer-bearing IDs',()=>{
 const p=playable(),sheet=buildWorksheet(p);
 assert.equal(sheet.status,'TRIAL_READY');
 for(const c of p.expected) {
  assert.ok(!JSON.stringify(sheet).includes(c.word));
  assert.ok(!formatWorksheet(sheet).includes(c.word));
 }
 assert.equal(sheet.mode,'player');assert.equal(sheet.approved_for_print,false);
 assert.ok(sheet.board.flat().every(c=>!Object.hasOwn(c,'value')));
 assert.ok([...sheet.clues.H,...sheet.clues.V].every(c=>!Object.hasOwn(c,'answer')&&!Object.hasOwn(c,'candidate_id')));
});
test('answer mode exactly preserves the validated board and original puzzle',()=>{
 const p=playable(),before=structuredClone(p),sheet=buildWorksheet(p,{includeAnswers:true});
 assert.deepEqual(p,before);
 assert.deepEqual(sheet.board.map(row=>row.map(c=>c.block?'■':c.value)),p.board);
 assert.deepEqual([...sheet.clues.H,...sheet.clues.V].map(c=>c.answer).sort(),p.expected.map(c=>c.word).sort());
 assert.match(formatWorksheet(sheet),/答案：人工智慧/);
});
test('invalid geometry and 智撤 never become a player sheet or grading result',()=>{
 assert.throws(()=>numberEntries(extraZhiChe()),/INVALID/);
 for(const p of [extraZhiChe(),null,{board:Array(8)}]) {
  assert.equal(buildWorksheet(p).status,'INVALID');
  assert.equal(buildWorksheet(p).board,undefined);
  assert.equal(createAnswerTemplate(p).status,'INVALID');
  assert.equal(gradeAnswers(p,{}).status,'INVALID');
 }
});
test('missing, leaking, wrong-length and known ambiguous clues block trial output',()=>{
 for(const [modify,code] of [
  [c=>{delete c.clue;},'C02'],
  [c=>{c.clue='人工智慧是模擬人類思考的領域。（4字）';},'C01'],
  [c=>{c.clue='模擬人類思考能力的技術。（3字）';},'C03'],
  [c=>{c.alternative_answers=['機器學習'];},'C04']
 ]) {
  const p=playable();modify(p.expected[0]);
  const r=buildWorksheet(p);assert.equal(r.status,'INVALID');
  assert.ok(r.errors.some(e=>e.code===code));assert.equal(r.board,undefined);
 }
});
test('worksheet identity is stable under input order and changes with clue changes',()=>{
 const p=playable(),a=buildWorksheet(p);
 p.expected.reverse();p.placements.reverse();
 assert.equal(buildWorksheet(p).worksheet_id,a.worksheet_id);
 p.expected[0].clue='警方使用、不用機上駕駛操作的飛行器。（3字）';
 assert.notEqual(buildWorksheet(p).worksheet_id,a.worksheet_id);
});
test('answer template is blank and uniquely addressed by direction plus number',()=>{
 const p=shared(),t=createAnswerTemplate(p);
 assert.equal(t.worksheet_id,buildWorksheet(p).worksheet_id);
 assert.deepEqual(t.answers,[{number:1,direction:'H',answer:''},{number:1,direction:'V',answer:''}]);
 assert.ok(!JSON.stringify(t).includes('黃金'));
});
test('all correct answers grade 100 with no hidden answer key in default report',()=>{
 const p=playable(),r=gradeAnswers(p,fullAnswers(p));
 assert.equal(r.status,'GRADED');assert.equal(r.score,100);assert.equal(r.solved,true);
 assert.equal(r.correct,2);assert.deepEqual(r.crossing_conflicts,[]);
 assert.ok(r.results.every(a=>!Object.hasOwn(a,'expected_answer')));
});
test('empty and omitted answers remain unanswered rather than invalid input',()=>{
 const p=playable(),t=createAnswerTemplate(p);t.answers=[];
 const r=gradeAnswers(p,t);
 assert.equal(r.answered,0);assert.equal(r.correct,0);assert.equal(r.solved,false);
 assert.ok(r.results.every(a=>a.status==='UNANSWERED'));
});
test('wrong length is an incorrect answer and a valid submission',()=>{
 const p=playable(),t=createAnswerTemplate(p);t.answers[0].answer='無';
 const r=gradeAnswers(p,t);
 assert.equal(r.results.find(a=>a.direction==='V').reason,'LENGTH_MISMATCH');
 assert.equal(r.score,0);
});
test('contradictory attempts at a crossing are reported without changing the puzzle',()=>{
 const p=playable(),t=fullAnswers(p),before=structuredClone(p);
 t.answers.find(a=>a.direction==='H').answer='天工智慧';
 const r=gradeAnswers(p,t);
 assert.equal(r.score,50);assert.equal(r.crossing_conflicts.length,1);
 assert.deepEqual([r.crossing_conflicts[0].row,r.crossing_conflicts[0].col],[1,0]);
 assert.deepEqual(p,before);
 assert.match(formatGrade(r),/交叉填字不一致/);
 const revealed=gradeAnswers(p,t,{reveal:true});
 assert.ok(revealed.results.every(a=>typeof a.expected_answer==='string'));
 assert.match(formatGrade(revealed),/正確答案：人工智慧/);
});
test('unknown, duplicate, stale or malformed submissions cannot be silently graded',()=>{
 const p=playable();
 const mutations=[
 t=>{t.worksheet_id='old';},t=>{t.schema_version='2.0';},
 t=>{t.answers[0].number=99;},t=>{t.answers.push(t.answers[0]);},
 t=>{t.answers[0].direction='X';},t=>{t.answers[0].answer='AI';},
 t=>{t.answers[0].answer='人工智慧科技';},t=>{t.answers[0].anwer='錯字';},
 t=>{delete t.answers[0];},t=>{t.answers={};},t=>{t.extra=true;}
 ];
 for(const mutate of mutations){const t=createAnswerTemplate(p);mutate(t);assert.throws(()=>gradeAnswers(p,t));}
 assert.equal(gradeAnswers(shared(),fullAnswers(shared())).correct,2);
});
test('cross-clue answer mention gets a warning without leaking private metadata',()=>{
 const p=shared();p.expected[0].clue='與黃牌不同、常用於首飾的黃色貴金屬。（2字）';
 const r=buildWorksheet(p);
 assert.equal(r.status,'TRIAL_READY');
 assert.ok(r.clue_warnings.some(w=>w.entry_key==='H01'&&w.other_entry_key==='V01'));
 assert.ok(!JSON.stringify(r.clue_warnings).includes('黃牌'));
});
test('worksheet and grade options must be boolean and limits remain enforced',()=>{
 assert.throws(()=>buildWorksheet(playable(),{includeAnswers:'false'}));
 assert.throws(()=>buildWorksheet(playable(),{maxClueChars:0}));
 assert.throws(()=>gradeAnswers(playable(),fullAnswers(playable()),{reveal:'false'}));
});
test('CLI player, teacher and answer template produce usable separate outputs',()=>{
 const folder=mkdtempSync(join(tmpdir(),'crossword-play-'));
 try {
  const path=join(folder,'puzzle.json'),textPath=join(folder,'player.txt'),jsonPath=join(folder,'player.json');
  writeFileSync(path,JSON.stringify(playable()));
  let r=cli(['worksheet',path,'--out',textPath]);
  assert.equal(r.status,0,r.stderr);assert.equal(readFileSync(textPath,'utf8').trim(),r.stdout.trim());
  assert.ok(!r.stdout.includes('人工智慧'));
  r=cli(['worksheet',path,'--json','--out',jsonPath]);
  assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(readFileSync(jsonPath,'utf8')).mode,'player');
  r=cli(['worksheet',path,'--answers']);assert.equal(r.status,0);assert.match(r.stdout,/答案：人工智慧/);
  r=cli(['answer-template',path]);assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).answers.length,2);
  const answersPath=join(folder,'answers.json');writeFileSync(answersPath,JSON.stringify(fullAnswers(playable())));
  r=cli(['grade',path,answersPath,'--json']);assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).score,100);
  const bad=join(folder,'bad.json');writeFileSync(bad,JSON.stringify(extraZhiChe()));
  r=cli(['worksheet',bad]);assert.equal(r.status,1);assert.match(r.stdout,/禁止建立/);
 } finally {rmSync(folder,{recursive:true,force:true});}
});
test('CLI trial commands reject missing submissions, unsupported and duplicate flags',()=>{
 for(const args of [
  ['grade','examples/news-real-puzzle.json'],
  ['worksheet','examples/news-real-puzzle.json','--seed','2'],
  ['solve','examples/candidates.json','--answers'],
  ['worksheet','examples/news-real-puzzle.json','--answers','--answers'],
  ['answer-template','examples/news-real-puzzle.json','--reveal']
 ]){const r=cli(args);assert.equal(r.status,2);assert.match(r.stderr,/ERROR/);}
});

test('available news metadata enforces status qualifiers and source support before trial output',()=>{
 const p=playable(),c=p.expected[0];
 c.event={fact_status:'considering',sources:[{source_id:'s',excerpt:'人工智慧'}]};
 c.source_support=[{source_id:'s',evidence:'人工智慧'}];
 c.clue='已決定推動、模擬人類思考能力的電腦技術。（4字）';
 assert.ok(buildWorksheet(p).errors.some(e=>e.code==='C05'));
 c.clue='評估推動、模擬人類思考能力的電腦技術。（4字）';
 assert.equal(buildWorksheet(p).status,'TRIAL_READY');
 c.source_support=[];
 assert.ok(buildWorksheet(p).errors.some(e=>e.code==='C06'));
});