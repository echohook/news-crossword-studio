import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {analyzeCandidates} from '../analysis.mjs';
import {runBatch} from '../batch.mjs';
import {solve,canPlace} from '../solver.mjs';
import {validatePuzzle} from '../validator.mjs';
import {tech,makePuzzle} from './fixtures.mjs';

const cwd=fileURLToPath(new URL('..',import.meta.url));
const pool=JSON.parse(await readFile(join(cwd,'examples/candidates.json'),'utf8')).candidates;
const cli=args=>spawnSync(process.execPath,['cli.mjs',...args],{cwd,encoding:'utf8',timeout:30000});

test('sparse board rows and missing cells fail closed',()=>{
  const inputs=[];
  let p=tech();delete p.board[3];inputs.push(p);
  p=tech();delete p.board[3][3];inputs.push(p);
  p=tech();p.board=Array(8);inputs.push(p);
  for(const input of inputs) {
    const r=validatePuzzle(input);
    assert.equal(r.status,'INVALID');assert.ok(r.structural.length);
  }
});
test('null, primitive and sparse placements fail closed',()=>{
  for(const value of [null,0,'placement',undefined]) {
    const p=tech();p.placements.push(value);
    assert.equal(validatePuzzle(p).valid,false);
  }
  const p=tech();delete p.placements[0];assert.equal(validatePuzzle(p).valid,false);
});
test('special candidate IDs survive validation and JSON serialization',()=>{
  const p=tech();
  p.expected[0].id='__proto__';p.placements[0].candidate_id='__proto__';
  p.expected[1].id='constructor';p.placements[1].candidate_id='constructor';
  const r=validatePuzzle(p);
  assert.equal(r.valid,true);
  const json=JSON.parse(JSON.stringify(r));
  assert.equal(json.intersections.__proto__.length,1);
  assert.equal(json.intersections.constructor.length,1);
  assert.equal(json.intersections.__proto__[0].with,'constructor');
});
test('unsupported data version and more than 14 official entries rejected',()=>{
  const p=tech();p.schema_version='2.0';
  assert.equal(validatePuzzle(p).valid,false);
  const specs=[];
  for(let i=0;i<8;i++) {
    const a=String.fromCodePoint(0x6000+i*3),b=String.fromCodePoint(0x6001+i*3),c=String.fromCodePoint(0x6002+i*3);
    const r=Math.floor(i/3)*3,col=(i%3)*3;
    specs.push([a+b,'H',r,col],[b+c,'V',r,col+1]);
  }
  const oversized=makePuzzle(specs,10);
  const result=validatePuzzle(oversized);
  assert.equal(result.valid,false);assert.ok(result.structural.some(s=>s.includes('14')));
});
test('unsafe coordinates and invalid placement directions rejected',()=>{
  const p=tech(),map=new Map(p.expected.map(c=>[c.id,c]));
  assert.equal(canPlace(p.board,p.placements,map,p.expected[0],{direction:'X',row:4,col:0}),false);
  assert.equal(canPlace(p.board,p.placements,map,p.expected[0],{direction:'H',row:NaN,col:0}),false);
  p.placements[0].row=Number.MAX_SAFE_INTEGER+1;
  assert.equal(validatePuzzle(p).valid,false);
});
test('seed and sparse grid size configuration rejected',()=>{
  for(const seed of [-1,4294967296,1.5,NaN]) assert.throws(()=>solve(pool,{seed}));
  assert.throws(()=>solve(pool,{sizes:Array(2)}));
  assert.throws(()=>solve(pool,null));
});
test('character graph reports isolated words and does not require one component',()=>{
  const cs=[...tech().expected,{id:'isolated',word:'天地',event_id:'isolate'}];
  const r=analyzeCandidates(cs,{target:3,minEntries:2});
  assert.equal(r.crossableCount,2);assert.equal(r.entryUpperBound,2);
  assert.equal(r.components.length,2);
  assert.deepEqual(r.isolated.map(c=>c.word),['天地']);
  assert.equal(r.links.length,1);assert.deepEqual(r.links[0].characters,['人']);
  assert.ok(r.warnings.some(w=>w.code==='TARGET_CAPACITY_SHORTAGE'));
});
test('event cap provides conservative upper bound and length shortage',()=>{
  const cs=[
    {id:'a',word:'黃金',event_id:'same'},
    {id:'b',word:'金牌',event_id:'same'},
    {id:'c',word:'金價',event_id:'same'},
    {id:'d',word:'黃牌',event_id:'same'}
  ];
  const r=analyzeCandidates(cs,{target:4,minEntries:2});
  assert.equal(r.crossableCount,4);assert.equal(r.eventCapacity,2);
  assert.equal(r.entryUpperBound,2);
  assert.ok(r.warnings.some(w=>w.code==='EVENT_LIMIT'));
  assert.ok(r.warnings.some(w=>w.code==='LENGTH_CAPACITY_SHORTAGE'));
});
test('unselected reasons distinguish isolated from search choice',()=>{
  const isolated={id:'isolate',word:'天地',event_id:'isolate'};
  const r=solve([...tech().expected,isolated],{target:3,minEntries:2,attempts:1});
  assert.equal(r.exclusions.find(c=>c.candidate_id==='isolate').reason,'NO_SHARED_CHARACTER');
  const full=solve(pool,{attempts:4});
  assert.ok(full.exclusions.some(c=>c.reason==='NOT_SELECTED_WITHIN_BUDGET'));
});
test('event-limited exclusions explained without claiming impossible geometry',()=>{
  const cs=[
    {id:'a',word:'黃金',event_id:'same'},
    {id:'b',word:'金牌',event_id:'same'},
    {id:'c',word:'金價',event_id:'same'}
  ];
  const r=solve(cs,{target:3,minEntries:2,attempts:1});
  assert.equal(r.status,'PARTIAL');assert.equal(r.exclusions[0].reason,'EVENT_LIMIT');
});
test('diagnostics show placements below minimum instead of reporting zero',()=>{
  const r=solve(tech().expected,{target:8,minEntries:8,attempts:1});
  assert.equal(r.status,'SEARCH_EXHAUSTED');
  assert.ok(r.diagnostics.every(d=>d.bestCount===2 && !d.meetsMinimum));
});
test('default batch covers solved, partial, invalid, exhausted and malformed input',async()=>{
  const manifest=JSON.parse(await readFile(join(cwd,'examples/batch.json'),'utf8'));
  const report=await runBatch(manifest,{baseDir:join(cwd,'examples')});
  assert.equal(report.passed,true);assert.equal(report.summary.passed,6);
  assert.equal(report.summary.statusCounts.INVALID,1);
  assert.equal(report.summary.statusCounts.INPUT_ERROR,1);
});
test('batch case failure does not stop later cases, and wrong expectation fails batch',async()=>{
  const report=await runBatch({cases:[
    {id:'bad',operation:'solve',data:{candidates:[]}},
    {id:'valid',operation:'validate',data:tech()},
    {id:'wrong',operation:'validate',data:tech(),expect:{status:'INVALID'}}
  ]});
  assert.equal(report.passed,false);assert.equal(report.summary.failed,2);
  assert.equal(report.cases[1].passed,true);
  assert.ok(report.cases[2].mismatches[0].includes('status'));
});
test('batch missing file becomes per-case INPUT_ERROR',async()=>{
  const r=await runBatch({cases:[{id:'missing',operation:'solve',input:'not-present-41d6a032.json',expect:{status:'INPUT_ERROR'}}]},{baseDir:cwd});
  assert.equal(r.passed,true);assert.equal(r.cases[0].status,'INPUT_ERROR');
});
test('batch manifest cannot silently accept typo expectations or duplicate IDs',async()=>{
  for(const expect of [{valid:'false'},{status:'invalid'},{entryCount:-1},{lengthCounts:{2:1}},{vaid:true},{}]) {
    await assert.rejects(()=>runBatch({cases:[{id:'x',operation:'validate',data:tech(),expect}]}));
  }
  const c={id:'x',operation:'validate',data:tech()};
  await assert.rejects(()=>runBatch({cases:[c,c]}));
});
test('CLI JSON solve and analysis output parse without incidental text',()=>{
  let r=cli(['solve','examples/candidates.json','--attempts','4','--json']);
  assert.equal(r.status,0,r.stderr);
  const result=JSON.parse(r.stdout);
  assert.equal(result.status,'SOLVED');assert.equal(result.validation.valid,true);
  assert.ok(result.analysis);assert.ok(result.exclusions);
  r=cli(['analyze','examples/candidates.json','--json']);assert.equal(r.status,0);
  assert.equal(JSON.parse(r.stdout).candidateCount,28);
});
test('CLI batch works outside the manifest directory and has machine-readable summary',()=>{
  const r=cli(['batch','examples/batch.json','--json']);
  assert.equal(r.status,0,r.stderr);
  const report=JSON.parse(r.stdout);
  assert.equal(report.summary.total,6);assert.equal(report.passed,true);
});
test('CLI null placements returns INVALID code 1 rather than crashing',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'crossword-edge-'));
  try {
    const file=join(folder,'invalid.json'),p=tech();p.placements.push(null);
    await writeFile(file,JSON.stringify(p));
    const r=cli(['validate',file]);
    assert.equal(r.status,1,r.stderr);assert.equal(JSON.parse(r.stdout).status,'INVALID');
    assert.doesNotMatch(r.stderr,/Cannot read/);
  } finally {await rm(folder,{recursive:true,force:true});}
});
test('CLI command-specific and duplicate options fail explicitly',()=>{
  for(const args of [
    ['validate','examples/solved.json','--target','12'],
    ['solve','examples/candidates.json','--seed','1','--seed','2'],
    ['solve','examples/candidates.json','--seed','--json']
  ]) {
    const r=cli(args);assert.equal(r.status,2);assert.match(r.stderr,/ERROR/);
  }
});