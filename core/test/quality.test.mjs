import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assessQuality,formatQuality} from '../quality.mjs';
import {tech,extraZhiChe} from './fixtures.mjs';
const puzzle=()=>{
 const p=tech();
 p.expected[0].clue='模擬人類思考能力的電腦技術領域。（4字）';
 p.expected[1].clue='不用機上駕駛操作的飛行器。（3字）';
 p.expected.forEach((c,i)=>{c.event={fact_status:'fixture',categories:[i?'生活':'科技']};c.difficulty=i?'easy':'medium';});
 return p;
};
const context=p=>({puzzle:p,quality_summary:{anchor_coverage:{required:1,covered:1}}});
const metric=(r,id)=>r.metrics.find(m=>m.id===id);

test('quality applies the six frozen weights without approving news or publication',()=>{
 const r=assessQuality(context(puzzle()));
 assert.deepEqual(r.metrics.map(m=>m.weight),[20,20,15,20,15,10]);
 assert.equal(r.available_weight,100);assert.ok(r.total_score>0&&r.total_score<=100);
 assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.approved_for_print,false);
 assert.equal(r.gates.find(g=>g.id==='GRID').status,'PASS');
 assert.equal(r.gates.find(g=>g.id==='NEWS_FACTS_AND_FRESHNESS').status,'REVIEW_REQUIRED');
 assert.equal(r.gates.find(g=>g.id==='CLUE_UNIQUENESS').status,'REVIEW_REQUIRED');
});
test('missing categories, difficulty or anchor universe remain unassessed',()=>{
 const p=puzzle();delete p.expected[0].event;delete p.expected[0].difficulty;
 const r=assessQuality(p);
 assert.equal(metric(r,'category_diversity').score,null);
 assert.equal(metric(r,'difficulty_balance').score,null);
 assert.equal(metric(r,'anchor_coverage').score,null);
 assert.equal(r.total_score,null);
 assert.match(formatQuality(r),/未評估項目不補零/);
});
test('cross-topic classification excludes geographic labels and deduplicates pairs',()=>{
 let p=puzzle(),r=assessQuality(context(p));
 assert.equal(metric(r,'cross_topic').details.unique_crossing_pairs,1);
 assert.equal(metric(r,'cross_topic').score,15);
 p.expected.forEach(c=>c.event.categories=['台灣','科技']);
 r=assessQuality(context(p));assert.equal(metric(r,'cross_topic').score,0);
 p.expected.forEach(c=>c.event.categories=['台灣']);
 r=assessQuality(context(p));assert.equal(metric(r,'cross_topic').score,null);
 assert.equal(metric(r,'cross_topic').details.classified_pairs,0);
});
test('invalid grids have no numeric quality, even when event data looks perfect',()=>{
 const r=assessQuality(context(extraZhiChe()));
 assert.equal(r.status,'INVALID');assert.equal(r.grid_status,'INVALID');
 assert.equal(r.metrics.length,0);assert.equal(r.total_score,null);
 assert.ok(r.validation_errors.some(e=>e.includes('智撤')));
});
test('known clue alternatives or leaked answers make overall quality INVALID while grid stays VALID',()=>{
 const p=puzzle();p.expected[0].alternative_answers=['機器學習'];
 let r=assessQuality(context(p));
 assert.equal(r.status,'INVALID');assert.equal(r.grid_status,'VALID');
 assert.equal(r.gates.find(g=>g.id==='CLUE_UNIQUENESS').status,'FAIL');
 p.expected[0].alternative_answers=[];p.expected[0].clue='人工智慧是什麼技術？（4字）';
 r=assessQuality(context(p));assert.equal(r.status,'INVALID');
});
test('difficulty target is configurable, validated and cannot manufacture a hard-gate PASS',()=>{
 const p=puzzle();p.expected.forEach(c=>c.difficulty='medium');
 assert.equal(metric(assessQuality(context(p)),'difficulty_balance').score,10);
 assert.equal(metric(assessQuality(context(p),{difficultyTarget:{easy:0,medium:1,hard:0}}),'difficulty_balance').score,20);
 for(const target of [null,{},[],{easy:1,medium:1,hard:0},{easy:-1,medium:2,hard:0},{easy:0,medium:1,hard:0,extra:0}])
  assert.throws(()=>assessQuality(p,{difficultyTarget:target}));
});
test('anchor coverage needs an explicit universe and zero anchors are not applicable',()=>{
 let r=assessQuality({puzzle:puzzle(),selection_quality:{anchor_event_ids:['e'],covered_anchor_event_ids:['e']}});
 assert.equal(metric(r,'anchor_coverage').score,10);
 r=assessQuality({puzzle:puzzle(),quality_summary:{anchor_coverage:{required:0,covered:0}}});
 assert.equal(metric(r,'anchor_coverage').status,'NOT_APPLICABLE');
 assert.equal(r.total_score,null);
 for(const counts of [{required:0,covered:1},{required:1,covered:-1},{required:1.5,covered:1}])
  assert.throws(()=>assessQuality({puzzle:puzzle(),quality_summary:{anchor_coverage:counts}}));
});
test('quality is read-only and scores the real pipeline report transparently',()=>{
 const path=new URL('../reports/news-real-20261001.json',import.meta.url);
 const input=JSON.parse(readFileSync(path,'utf8')),before=structuredClone(input);
 const r=assessQuality(input);
 assert.deepEqual(input,before);assert.equal(r.grid_status,'VALID');
 assert.equal(metric(r,'length_balance').score,17.5);
 assert.equal(metric(r,'anchor_coverage').score,10);
 assert.equal(metric(r,'difficulty_balance').score,10);
 assert.equal(r.semantic_relation_review.status,'REVIEW_REQUIRED');
});
test('CLI quality accepts a full report, returns JSON and rejects solver flags',()=>{
 const cwd=fileURLToPath(new URL('..',import.meta.url));
 let r=spawnSync(process.execPath,['cli.mjs','quality','reports/news-real-20261001.json','--json'],{cwd,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).status,'REVIEW_REQUIRED');
 r=spawnSync(process.execPath,['cli.mjs','quality','examples/invalid-zhi-che.json'],{cwd,encoding:'utf8'});
 assert.equal(r.status,1);assert.match(r.stdout,/INVALID/);
 r=spawnSync(process.execPath,['cli.mjs','quality','examples/news-real-puzzle.json','--seed','1'],{cwd,encoding:'utf8'});
 assert.equal(r.status,2);
});
