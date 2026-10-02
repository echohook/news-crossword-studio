import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assessNewsScope,assessCandidateScope,filterCandidateScope,ENTERTAINMENT_LABELS} from '../news-policy.mjs';
import {collectEvents,generateCandidates} from '../news.mjs';
import {runPipeline,formatPipeline} from '../pipeline.mjs';
import {solve} from '../solver.mjs';
import {analyzeCandidates} from '../analysis.mjs';
import {validatePuzzle} from '../validator.mjs';
import {buildWorksheet,createAnswerTemplate,gradeAnswers} from '../worksheet.mjs';
import {assessQuality} from '../quality.mjs';
import {runBatch} from '../batch.mjs';
import {packetForWords} from './news-fixtures.mjs';
import {tech} from './fixtures.mjs';
const options={target:2,minEntries:2,attempts:4};
const packet=()=>packetForWords(['人工智慧','無人機']);
const candidatePool=()=>[
 {id:'a',word:'人工智慧',event_id:'a',clue:'模擬人類思考的電腦技術領域。（4字）'},
 {id:'b',word:'無人機',event_id:'b',clue:'不用機上駕駛的飛行器。（3字）'},
 {id:'c',word:'黃金',event_id:'c',category:'娛樂',anchor_event:true,answer_score:100},
 {id:'d',word:'金牌',event_id:'d',event:{is_entertainment:true},answer_score:100}
];
const playable=()=>{
 const p=tech(),pool=candidatePool();p.expected.forEach((c,i)=>c.clue=pool[i].clue);return p;
};
test('all declared entertainment aliases, NFKC, spacing and invisible characters are excluded',()=>{
 for(const label of ENTERTAINMENT_LABELS)assert.equal(assessNewsScope({categories:[label]}).allowed,false,label);
 for(const label of ['ＥＮＴＥＲＴＡＩＮＭＥＮＴ','娛\u200b樂新聞','Celebrity Gossip'])
  assert.equal(assessNewsScope({category:label}).allowed,false,label);
});
test('mixed themes and false flag cannot override an entertainment classification',()=>{
 const r=assessNewsScope({is_entertainment:false,categories:['文化','科技','娛樂']});
 assert.equal(r.allowed,false);assert.equal(r.reason,'ENTERTAINMENT_EXCLUDED');
});
test('culture, lifestyle, sports and answer words are not automatically excluded',()=>{
 for(const word of ['電競','電影','文化資產'])assert.equal(assessCandidateScope({word,event:{categories:['文化','生活','體育']}}).allowed,true);
});
test('boolean scope field fails closed on malformed values',()=>{
 for(const flag of ['false','true',0,1,null,{}]) {
  const r=assessNewsScope({is_entertainment:flag});assert.equal(r.allowed,false);assert.equal(r.reason,'NEWS_SCOPE_INVALID');
 }
 assert.equal(assessNewsScope({is_entertainment:false}).allowed,true);
});
test('editorial domain and source section/category are recognized',()=>{
 for(const item of [{editorial_domain:'showbiz'},{source_section:'影劇'},
  {sources:[{section:'娛樂新聞'}]},{sources:[{category:'celebrity'}]}])assert.equal(assessNewsScope(item).allowed,false);
});
test('E06 rejects high scoring entertainment anchors before generating candidates',()=>{
 const p=packet();p.events[0].categories=['科技','娛樂'];p.events[0].event_score=100;
 const r=runPipeline(p,{solverOptions:options});
 assert.equal(r.event_summary.admitted,1);assert.equal(r.candidate_summary.input,1);
 assert.ok(!r.eligible_candidates.some(c=>c.word==='人工智慧'));
 assert.equal(r.event_reports.find(e=>e.event_id===p.events[0].event_id).checks.find(c=>c.id==='E06').pass,false);
 assert.equal(r.quality_summary.anchor_coverage.required,0);
 assert.match(formatPipeline(r),/排除事件.*E06/);
});
test('source entertainment classification blocks an otherwise eligible event',()=>{
 const p=packet();p.events[0].sources[0].section='娛樂';
 const r=collectEvents(p.events,{issueDate:p.issue_date,fixture:true});assert.equal(r.accepted.length,1);
});
test('latest deduplicated revision is classified before admitting the event',()=>{
 const p=packet(),old=p.events[0];old.dedup_key='same';
 const current=structuredClone(old);current.event_id='revision';current.updated_at='2026-10-01';current.is_entertainment=true;
 p.events.push(current);
 const r=collectEvents(p.events,{issueDate:p.issue_date,fixture:true});assert.equal(r.accepted.length,1);
 assert.equal(r.reports.find(e=>e.dedup_key==='same').selected_revision,'revision');
});
test('explicit candidates cannot bypass E06 with an excluded event ID',()=>{
 const p=packet(),news=collectEvents(p.events,{issueDate:p.issue_date,fixture:true});p.candidates=generateCandidates(news.accepted);
 p.events[0].is_entertainment=true;
 const r=runPipeline(p,{solverOptions:options});
 assert.ok(r.candidate_reports.find(c=>c.word==='人工智慧').errors.some(e=>e.code==='A02'));
});
test('A05 rejects both candidate and embedded event classifications before canonical binding',()=>{
 for(const fields of [{is_entertainment:true},{event:{categories:['娛樂']}}]) {
  const p=packet(),news=collectEvents(p.events,{issueDate:p.issue_date,fixture:true});p.candidates=generateCandidates(news.accepted);
  Object.assign(p.candidates[0],fields);
  const r=runPipeline(p,{solverOptions:options});assert.equal(r.candidate_summary.admitted,1);
  assert.ok(r.candidate_reports[0].errors.some(e=>e.code==='A05'));
 }
});
test('direct Solver and candidate analysis both exclude entertainment and explain why',()=>{
 const pool=candidatePool(),a=analyzeCandidates(pool,options),r=solve(pool,options);
 assert.equal(a.inputCandidateCount,4);assert.equal(a.candidateCount,2);assert.equal(a.excluded_candidates.length,2);
 assert.equal(r.status,'SOLVED');assert.equal(validatePuzzle(r.puzzle).valid,true);
 assert.deepEqual(r.puzzle.expected.map(c=>c.word).sort(),['人工智慧','無人機']);
 assert.ok(r.exclusions.every(c=>c.reason==='ENTERTAINMENT_EXCLUDED'));
 assert.equal(r.selection_quality.anchor_event_ids.length,0);
});
test('an all-entertainment batch returns an honest empty search or intake result',()=>{
 const pool=candidatePool().slice(2),a=analyzeCandidates(pool,options),r=solve(pool,options);
 assert.equal(a.candidateCount,0);assert.equal(a.entryUpperBound,0);
 assert.equal(r.status,'SEARCH_EXHAUSTED');assert.equal(r.puzzle,null);assert.equal(r.exclusions.length,2);
 const p=packet();p.events.forEach(e=>e.is_entertainment=true);
 assert.equal(runPipeline(p,{solverOptions:options}).status,'NO_ELIGIBLE_CANDIDATES');
});
test('policy and pipeline are read-only and seeded layouts are reproducible',()=>{
 const pool=candidatePool(),before=structuredClone(pool);filterCandidateScope(pool);
 const r=solve(pool,options);assert.deepEqual(pool,before);assert.deepEqual(solve([...pool].reverse(),options).puzzle,r.puzzle);
 const p=packet(),copy=structuredClone(p);p.events[0].is_entertainment=true;copy.events[0].is_entertainment=true;
 runPipeline(p,{solverOptions:options});assert.deepEqual(p,copy);
});
test('previously saved entertainment puzzles stay geometry VALID but trial and grading are blocked',()=>{
 const p=playable();p.expected[0].event={categories:['娛樂'],fact_status:'fixture'};
 assert.equal(validatePuzzle(p).status,'VALID');
 const sheet=buildWorksheet(p);assert.equal(sheet.status,'INVALID');assert.equal(sheet.grid_status,'VALID');
 assert.ok(sheet.errors.some(e=>e.code==='ENTERTAINMENT_EXCLUDED'));assert.ok(!sheet.board);
 assert.equal(createAnswerTemplate(p).status,'INVALID');assert.equal(gradeAnswers(p,{}).status,'INVALID');
 const q=assessQuality(p);assert.equal(q.status,'INVALID');assert.equal(q.gates.find(g=>g.id==='NEWS_SCOPE').status,'FAIL');
 assert.equal(q.gates.find(g=>g.id==='CLUE_MECHANICS').status,'PASS');
});
test('real news keeps rejected provenance and excludes all seven activity candidates',()=>{
 const p=JSON.parse(readFileSync(new URL('../examples/news-real-20261001.json',import.meta.url),'utf8'));
 const r=runPipeline(p,{solverOptions:{attempts:256,seed:2}});
 assert.equal(p.events.length,11);assert.equal(p.events.reduce((n,e)=>n+e.keywords.length,0),34);
 assert.deepEqual(r.event_reports.filter(e=>!e.passed).map(e=>e.event_id).sort(),['africa-expo','tourism-market']);
 assert.equal(r.candidate_summary.admitted,27);assert.equal(r.puzzle.expected.length,12);
 assert.ok(r.puzzle.expected.every(c=>assessCandidateScope(c).allowed));
 assert.ok(r.eligible_candidates.some(c=>c.word==='文化資產'));
 assert.ok(r.eligible_candidates.some(c=>c.word==='陳念琴'));
});
test('CLI solve reports exclusion and batch does not reinterpret the policy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'crossword-scope-'));
 try {
  const path=join(dir,'candidates.json');writeFileSync(path,JSON.stringify(candidatePool()),'utf8');
  const cwd=fileURLToPath(new URL('..',import.meta.url));
  const r=spawnSync(process.execPath,['cli.mjs','solve',path,'--target','2','--min','2','--attempts','4','--json'],{cwd,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).news_scope.excluded_candidates.length,2);
  const batch=await runBatch({cases:[{id:'no-entertainment',operation:'solve',data:{candidates:candidatePool()},options,
   expect:{status:'SOLVED',valid:true,entryCount:2}}]});assert.equal(batch.passed,true);
 } finally {rmSync(dir,{recursive:true,force:true});}
});