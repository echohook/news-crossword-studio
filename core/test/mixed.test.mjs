import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runMixed} from '../mixed.mjs';
import {solve,solverSettings} from '../solver.mjs';
import {validatePuzzle} from '../validator.mjs';
import {buildWorksheet} from '../worksheet.mjs';
const input=()=>JSON.parse(readFileSync(new URL('../examples/mixed-input.json',import.meta.url),'utf8'));
const options={solverOptions:{attempts:256,seed:2}};
const report=runMixed(input(),options);

test('mixed prototype selects exactly eight news entries and four complete idioms',()=>{
 assert.equal(report.status,'REVIEW_REQUIRED');assert.equal(report.approved_for_print,false);
 assert.deepEqual(report.content_summary.selected,{news:8,idiom:4});
 assert.equal(report.puzzle.board.length,9);assert.equal(report.puzzle.expected.length,12);
 assert.ok(report.grid_validation.checks.every(c=>c.pass));assert.equal(report.grid_validation.balance.withinHalf,true);
 assert.deepEqual(report.grid_validation.balance.counts,{2:4,3:3,4:5});
});
test('idioms carry dictionary provenance without fake news dates or news anchor flags',()=>{
 const idioms=report.puzzle.expected.filter(c=>c.content_kind==='idiom');
 assert.equal(idioms.length,4);
 for(const c of idioms){assert.equal(Array.from(c.word).length,4);assert.ok(c.clue.startsWith('【成語】'));assert.ok(c.knowledge_source.url);assert.ok(!c.event);assert.ok(!c.anchor_event);}
 assert.equal(report.news_report.event_summary.admitted,9);
 assert.ok(!report.puzzle.expected.some(c=>['africa-expo','tourism-market'].includes(c.event_id)));
});
test('mixed worksheets preserve identity, all answers and player privacy',()=>{
 const player=buildWorksheet(report.puzzle),answers=buildWorksheet(report.puzzle,{includeAnswers:true});
 assert.equal(player.status,'TRIAL_READY');assert.equal(player.worksheet_id,answers.worksheet_id);assert.equal(player.clue_warnings.length,0);
 assert.equal([...player.clues.H,...player.clues.V].filter(e=>e.clue.startsWith('【成語】')).length,4);
 for(const c of report.puzzle.expected)assert.ok(!JSON.stringify(player).includes(c.word));
});
test('fixed mixed input is read-only and reproducible',()=>{
 const p=input(),before=structuredClone(p),again=runMixed(p,options);
 assert.deepEqual(p,before);assert.deepEqual(again.puzzle,report.puzzle);
});
test('reverse validator still catches 智撤 after introducing idiom entries',()=>{
 const p=structuredClone(report.puzzle),b=Array.from({length:10},()=>Array(10).fill('■'));
 p.board.forEach((row,r)=>row.forEach((ch,c)=>b[r][c]=ch));b[8][9]='智';b[9][9]='撤';p.board=b;
 const v=validatePuzzle(p);assert.equal(v.status,'INVALID');assert.equal(v.checks.find(c=>c.id==='V04').pass,false);
});
test('composition configuration rejects wrong totals, negative values and inherited fields',()=>{
 for(const q of [null,[],{}, {news:8,idiom:3},{news:-1,idiom:13},{news:8,idiom:4,extra:1},Object.assign(Object.create({news:8,idiom:4}),{a:1,b:2})])
  assert.throws(()=>solverSettings({target:12,contentTargets:q}));
 for(const mix of [null,[],{}, {news:8,idiom:0},{news:8,idiom:7},{news:'8',idiom:4}])assert.throws(()=>runMixed({...input(),mix},options));
 assert.throws(()=>runMixed(input(),{solverOptions:{target:12}}));
});
test('content caps apply to crossing pair insertion as well as individual entries',()=>{
 const pool=[{id:'a',word:'黃金',event_id:'a',content_kind:'news'},
  {id:'b',word:'金牌',event_id:'b',content_kind:'news'},
  {id:'i',word:'天空',event_id:'i',content_kind:'idiom'}];
 const r=solve(pool,{target:2,minEntries:2,attempts:4,contentTargets:{news:1,idiom:1}});
 assert.equal(r.status,'SEARCH_EXHAUSTED');assert.equal(r.puzzle,null);
});
test('unsupported content kinds cannot fill a quota',()=>{
 assert.throws(()=>solve([{id:'a',word:'黃金',event_id:'a',content_kind:'other'},{id:'b',word:'金牌',event_id:'b'}],
  {target:2,minEntries:2,contentTargets:{news:1,idiom:1}}));
});
test('bad idiom clues and missing dictionary sources are rejected before layout',()=>{
 const p=input();p.idioms[0].clue='一諾千金表示什麼意思？（4字）';delete p.idioms[1].knowledge_source;
 const r=runMixed(p,options);assert.equal(r.status,'SEARCH_EXHAUSTED');assert.equal(r.puzzle,null);
 assert.equal(r.idiom_reports.filter(x=>!x.passed).length,2);
});
test('mixed CLI exports JSON with exact composition and rejects irrelevant switches',()=>{
 const cwd=fileURLToPath(new URL('..',import.meta.url));
 const a=spawnSync(process.execPath,['cli.mjs','mixed','examples/mixed-input.json','--attempts','256','--seed','2','--json'],{cwd,encoding:'utf8'});
 assert.equal(a.status,0,a.stderr);assert.deepEqual(JSON.parse(a.stdout).content_summary.selected,{news:8,idiom:4});
 const b=spawnSync(process.execPath,['cli.mjs','mixed','examples/mixed-input.json','--target','12'],{cwd,encoding:'utf8'});assert.equal(b.status,2);
});