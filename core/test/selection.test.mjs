import {runBatch,formatBatch} from '../batch.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {anchorEvents,candidatePriority,selectionQuality,compareSelections} from '../selection.mjs';
import {solve} from '../solver.mjs';
import {validatePuzzle} from '../validator.mjs';
import {runPipeline,formatPipeline} from '../pipeline.mjs';
import {fullPacket} from './news-fixtures.mjs';
import {readFileSync} from 'node:fs';

const cs=[
 {id:'ai',word:'人工智慧',event_id:'tech',event:{anchor_event:true,event_score:90},answer_score:90},
 {id:'drone',word:'無人機',event_id:'police',answer_score:80},
 {id:'gold',word:'黃金',event_id:'market',answer_score:95},
 {id:'medal',word:'金牌',event_id:'sports',answer_score:95}
];
const state=(answers,size=8)=>({expected:answers,board:Array.from({length:size},()=>Array(size).fill('■'))});

test('solver covers the anchor before picking a shorter high score pair',()=>{
 const r=solve(cs,{target:2,minEntries:2,attempts:2,seed:1});
 assert.equal(r.status,'SOLVED');
 assert.ok(r.puzzle.expected.some(c=>c.id==='ai'));
 assert.equal(r.validation.valid,true);
 assert.deepEqual(r.selection_quality.covered_anchor_event_ids,['tech']);
 assert.equal(r.selection_quality.editorial_score,73);
});
test('anchor coverage is per event, including unflagged answers from the same event',()=>{
 const pool=[...cs,{id:'chip',word:'智慧',event_id:'tech'}];
 assert.deepEqual(anchorEvents(pool),['tech']);
 const q=selectionQuality([pool[0],pool.at(-1)],pool);
 assert.deepEqual(q.covered_anchor_event_ids,['tech']);
 assert.deepEqual(q.missing_anchor_event_ids,[]);
 assert.equal(selectionQuality([pool.at(-1)],pool).covered_anchor_event_ids.length,1);
});
test('equal count and grid size favor anchor coverage before length balance',()=>{
 const pool=[...cs,{id:'city',word:'智慧城市',event_id:'city'}];
 const covering=state([cs[0],pool.at(-1)]),balanced=state([cs[1],cs[2]]);
 assert.ok(selectionQuality(covering.expected,pool).length_balance.penalty>
  selectionQuality(balanced.expected,pool).length_balance.penalty);
 assert.ok(compareSelections(covering,balanced,pool)<0);
});
test('entry count then preferred grid size remain ahead of editorial preferences',()=>{
 assert.ok(compareSelections(state([cs[2],cs[3],cs[1]]),state([cs[0],cs[1]]),cs)<0);
 assert.ok(compareSelections(state([cs[2],cs[3]],8),state([cs[0],cs[1]],9),cs)<0);
});
test('score resolves equal geometry, anchor coverage and length distribution',()=>{
 const weak=cs.map(c=>({...c,answer_score:10,event_score:10,event:undefined}));
 const strong=cs.map(c=>({...c,answer_score:100,event_score:100,event:undefined}));
 assert.ok(compareSelections(state(strong.slice(2)),state(weak.slice(2)),[...weak,...strong])<0);
 assert.equal(candidatePriority({answer_score:Infinity,event_score:-1}),0);
 assert.equal(candidatePriority({answer_score:'100',event_score:101}),0);
});
test('unplaceable anchor stays a warning while the returned puzzle is legal',()=>{
 const isolated={id:'isolate',word:'天地',event_id:'__proto__',anchor_event:true};
 const r=solve([...cs,isolated],{target:4,minEntries:4,attempts:8});
 assert.equal(r.status,'SOLVED');
 assert.equal(validatePuzzle(r.puzzle).valid,true);
 assert.deepEqual(r.selection_quality.missing_anchor_event_ids,['__proto__']);
 assert.ok(r.selection_warnings.some(w=>w.code==='ANCHOR_NO_SHARED_CHARACTER'&&w.event_id==='__proto__'));
});
test('exhausted search and too many anchors retain useful quality diagnostics',()=>{
 const pool=cs.map(c=>({...c,anchor_event:true}));
 const r=solve(pool,{target:8,minEntries:8,attempts:1});
 assert.equal(r.status,'SEARCH_EXHAUSTED');
 assert.equal(r.selection_quality.covered_anchor_event_ids.length,0);
 assert.equal(r.selection_quality.missing_anchor_event_ids.length,4);
 const capped=solve(pool,{target:2,minEntries:2,attempts:1});
 assert.ok(capped.selection_warnings.some(w=>w.code==='ANCHOR_TARGET_LIMIT'));
 assert.equal(capped.selection_quality.covered_anchor_event_ids.length,2);
});
test('real news default seed now covers both anchors without a hand-picked seed',()=>{
 const packet=JSON.parse(readFileSync(new URL('../examples/news-real-20261001.json',import.meta.url),'utf8'));
 const a=runPipeline(packet),b=runPipeline(packet);
 assert.equal(a.status,'REVIEW_REQUIRED');
 assert.equal(a.grid_status,'VALID');
 assert.equal(a.puzzle.board.length,8);
 assert.equal(a.puzzle.expected.length,12);
 assert.deepEqual(a.quality_summary.missing_anchors,[]);
 assert.deepEqual(a.solver_result.selection_quality.covered_anchor_event_ids,['ai-voluntary','parks-results']);
 assert.deepEqual(a.puzzle,b.puzzle);
 assert.equal(a.approved_for_print,false);
});

test('rejected or absent anchor clues stay visible in overall news coverage',()=>{
 const p=fullPacket();
 p.events[0].keywords[0].clue_draft=p.events[0].keywords[0].word+'就是本題答案。';
 p.events[1].anchor_event=true;p.events[1].keywords=[];
 const r=runPipeline(p);
 assert.equal(r.status,'REVIEW_REQUIRED');
 assert.deepEqual(r.quality_summary.anchor_coverage,{required:2,covered:0});
 assert.equal(r.quality_summary.missing_anchors.length,2);
 assert.equal(r.solver_result.selection_quality.anchor_event_ids.length,0);
 assert.match(formatPipeline(r),/本期合格重點新聞涵蓋：0\/2/);
});
test('no eligible candidates still report which news anchors were omitted',()=>{
 const p=fullPacket();
 for(const e of p.events)e.keywords=[];
 const r=runPipeline(p);
 assert.equal(r.status,'NO_ELIGIBLE_CANDIDATES');
 assert.deepEqual(r.quality_summary.anchor_coverage,{required:1,covered:0});
 assert.equal(r.quality_summary.missing_anchors[0].event_id,p.events[0].event_id);
});
test('truthy strings do not turn ordinary events into anchors',()=>{
 const p=fullPacket();p.events[0].anchor_event='false';
 const r=runPipeline(p);
 assert.deepEqual(r.quality_summary.anchor_coverage,{required:0,covered:0});
 assert.deepEqual(r.solver_result.selection_quality.anchor_event_ids,[]);
});

test('batch preserves anchor quality and displays warnings even for a VALID grid',async()=>{
 const r=await runBatch({cases:[{id:'isolated-anchor',operation:'solve',
  data:{candidates:[...cs,{id:'isolated',word:'天地',event_id:'isolated',anchor_event:true}]},
  options:{target:4,minEntries:4,attempts:8},expect:{status:'SOLVED',valid:true}}]});
 assert.equal(r.passed,true);
 assert.equal(r.cases[0].validation.valid,true);
 assert.deepEqual(r.cases[0].selection_quality.missing_anchor_event_ids,['isolated']);
 assert.match(formatBatch(r),/ANCHOR_NO_SHARED_CHARACTER/);
});