import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runPipeline} from '../pipeline.mjs';
import {collectEvents,generateCandidates} from '../news.mjs';
import {validatePuzzle} from '../validator.mjs';

const packet=()=>JSON.parse(readFileSync(new URL('../examples/news-real-20261001.json',import.meta.url),'utf8'));
const config={solverOptions:{attempts:256,seed:2}};
const original=runPipeline(packet(),config);

test('fixed news snapshot preserves provenance and admits 9 non-entertainment events with 27 candidates',()=>{
 const p=packet();
 assert.equal(p.dataset_mode,'news');
 assert.equal(original.event_summary.admitted,9);
 assert.equal(original.candidate_summary.admitted,27);
 for(const e of p.events) {
  assert.equal(e.sources[0].kind,'newswire');
  assert.equal(new URL(e.sources[0].url).hostname,'www.cna.com.tw');
 }
});
test('real snapshot has independent VALID 8x8 grid, 12 entries, balanced lengths and anchors',()=>{
 assert.equal(original.status,'REVIEW_REQUIRED');
 assert.equal(original.approved_for_print,false);
 assert.equal(original.puzzle.board.length,8);
 assert.equal(original.puzzle.expected.length,12);
 assert.deepEqual(original.grid_validation.balance.counts,{2:3,3:5,4:4});
 assert.equal(original.quality_summary.missing_anchors.length,0);
 assert.equal(original.clue_validation.length,12);
 assert.ok(original.clue_validation.every(c=>c.passed));
 assert.ok(validatePuzzle(original.puzzle).checks.every(c=>c.pass));
});
test('news snapshot and fixed seed reproduce exact placements',()=>{
 const again=runPipeline(packet(),config);
 assert.deepEqual(again.puzzle,original.puzzle);
});
test('new police announcement distinguishes the old prosecution period',()=>{
 const p=packet();
 const e=p.events.find(e=>e.event_id==='police-announcement');
 assert.equal(e.event_scope,'announcement');
 assert.equal(e.underlying_event_period,'2026-07');
 assert.equal(e.event_date,'2026-09-30');
 e.event_date='2026-07-01';
 const r=collectEvents(p.events,{issueDate:p.issue_date});
 assert.ok(!r.accepted.some(x=>x.event_id===e.event_id));
 assert.equal(r.reports.find(x=>x.event_id===e.event_id).checks.find(x=>x.id==='E01').pass,false);
});
test('considering investment cannot become a decided factory in the clue',()=>{
 const p=packet();
 p.events.find(e=>e.event_id==='tsmc-texas').keywords.find(k=>k.word==='台積電').clue_draft=
  '已決定在德州設廠的台灣晶圓代工龍頭，常用簡稱為何？';
 const r=runPipeline(p,config);
 const c=r.candidate_reports.find(c=>c.word==='台積電');
 assert.equal(c.passed,false);
 assert.ok(c.errors.some(e=>e.code==='C05'));
 assert.ok(!r.puzzle.expected.some(c=>c.word==='台積電'));
});
test('a genuine URL alone cannot support an answer absent from the excerpt',()=>{
 const p=packet();
 p.events.find(e=>e.event_id==='ai-voluntary').sources[0].excerpt='科技業者簽署自願承諾。';
 const r=collectEvents(p.events,{issueDate:p.issue_date});
 const candidate=generateCandidates(r.accepted).find(c=>c.word==='人工智慧');
 assert.equal(candidate.source_support.length,0);
 const result=runPipeline(p,config);
 assert.ok(result.candidate_reports.find(c=>c.word==='人工智慧').errors.some(e=>e.code==='C06'));
});
test('reverse scan catches undeclared 智撤 in a tampered real news puzzle',()=>{
 const p=structuredClone(original.puzzle);
 const board=Array.from({length:10},()=>Array(10).fill('■'));
 p.board.forEach((row,r)=>row.forEach((ch,c)=>board[r][c]=ch));
 board[8][9]='智';board[9][9]='撤';p.board=board;
 const result=validatePuzzle(p);
 assert.equal(result.status,'INVALID');
 assert.equal(result.checks.find(c=>c.id==='V04').pass,false);
 assert.ok(result.detected.some(e=>e.direction==='V'&&e.word==='智撤'));
});
