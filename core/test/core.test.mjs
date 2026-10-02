import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFileSync,existsSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {solve,canPlace} from '../solver.mjs';
import {validatePuzzle,scanBoard} from '../validator.mjs';
import {BLOCK,lengthBalance} from '../model.mjs';
import {renderValidated} from '../interfaces.mjs';
import {historic,tech,extraZhiChe,makePuzzle} from './fixtures.mjs';

const fails=(p,id)=>{const r=validatePuzzle(p); assert.equal(r.valid,false); assert.equal(r.checks.find(c=>c.id===id).pass,false);return r;};
const pool=JSON.parse((await readFile(new URL('../examples/candidates.json',import.meta.url),'utf8')).replace(/^\uFEFF/,'')).candidates;

test('historic 8x8 12-entry board independently passes all eight checks',()=>{
  const r=validatePuzzle(historic());
  assert.equal(r.valid,true);assert.equal(r.detected.length,12);
  assert.equal(r.checks.filter(c=>c.pass).length,8);
  assert.equal(r.balance.withinHalf,false); // valid legacy geometry, poor balance
});
test('人工智慧 / 無人機 valid crossing concept',()=>assert.equal(validatePuzzle(tech()).valid,true));
test('智撤 extra vertical run rejected by V04',()=>{
  const r=fails(extraZhiChe(),'V04');
  assert.ok(r.checks[3].errors.some(e=>e.includes('智撤')));
});
test('transposed 智撤 extra horizontal run rejected by V03',()=>{
  const p=extraZhiChe();p.board=p.board[0].map((_,i)=>p.board.map(r=>r[i]));
  p.placements=p.placements.map(e=>({...e,row:e.col,col:e.row,direction:e.direction==='H'?'V':'H'}));
  assert.ok(fails(p,'V03').checks[2].errors.some(e=>e.includes('智撤')));
});
test('missing selected declaration fails V02',()=>{const p=tech();p.placements.pop();fails(p,'V02');});
test('unknown and duplicate declarations rejected',()=>{
  const p=tech();p.placements.push({...p.placements[0]});fails(p,'V02');
  p.placements.at(-1).candidate_id='unknown';fails(p,'V02');
});
test('block splits an answer: V01 and V06',()=>{
  const p=tech();p.board[1][2]=BLOCK;fails(p,'V01');fails(p,'V06');
});
test('different letters conflict: V05 and crossing consistency V08',()=>{
  const p=tech();p.board[1][0]='大';fails(p,'V05');fails(p,'V08');
});
test('two declarations disagree on their crossing even if board has one value',()=>{
  const p=tech();p.expected[1].word='無大機';fails(p,'V05');fails(p,'V08');
});
test('isolated answer cannot count as valid crossing',()=>{
  fails(makePuzzle([['台積電','H',0,0]]),'V07');
});
test('out of bounds does not crash and fails V06',()=>{
  const p=tech();p.placements[0].row=9;fails(p,'V06');
});
test('orphan single character invalid despite no new run',()=>{
  const p=tech();p.board[7][7]='金';const r=validatePuzzle(p);assert.equal(r.valid,false);assert.ok(r.structural.length);
});
test('parallel overlap and duplicate placement cannot fake crossing',()=>{
  const p=tech();p.placements.push({...p.placements[0]});fails(p,'V05');
});
test('same word at another location is an extra occurrence',()=>{
  const p=tech();p.board[7].splice(0,4,...Array.from('人工智慧'));
  fails(p,'V03');
});
test('malformed inputs fail closed',()=>{
  for(const p of [null,{}, {...tech(),board:[['人']]},{...tech(),placements:[null]}]) assert.equal(validatePuzzle(p).valid,false);
});
test('placement rules reject touching, conflicts, and end extensions',()=>{
  const p=tech(), map=new Map(p.expected.map(c=>[c.id,c]));
  for(const [word,place] of [
    ['撤軍',{direction:'H',row:2,col:2}],
    ['天人',{direction:'H',row:0,col:0}],
    ['大地',{direction:'V',row:1,col:1}],
    ['智慧',{direction:'H',row:1,col:2}]
  ]) assert.equal(canPlace(p.board,p.placements,map,{word},place),false);
});
test('invalid candidate length, non-Han, duplicate word/id and missing event rejected',()=>{
  for(const addition of [{id:'x',word:'人',event_id:'x'},{id:'x',word:'AI',event_id:'x'},
    {...pool[0],id:'new'}, {...pool[1],id:pool[0].id},{id:'x',word:'人民'}])
    assert.throws(()=>solve([...pool,addition]));
});
test('balance objective ranks 4/4/4 ahead of 8/3/1',()=>{
  const make=counts=>[2,3,4].flatMap((len,i)=>Array.from({length:counts[i]},()=>({word:'人'.repeat(len)})));
  assert.equal(lengthBalance(make([4,4,4])).penalty,0);
  assert.ok(lengthBalance(make([8,3,1])).penalty>0);
  assert.equal(lengthBalance(make([8,3,1])).withinHalf,false);
});
test('solver reaches 12 with balanced lengths, metadata, and independent validity',()=>{
  const result=solve(pool,{attempts:120});
  assert.equal(result.status,'SOLVED');assert.equal(result.puzzle.board.length,8);
  assert.equal(validatePuzzle(result.puzzle).valid,true);
  assert.deepEqual(result.validation.balance.counts,{2:4,3:4,4:4});
  assert.ok(result.puzzle.expected.every(c=>c.event.fact_status==='fixture'));
});
test('fixed seed is reproducible regardless of candidate order',()=>{
  const a=solve(pool,{attempts:6,seed:17}),b=solve([...pool].reverse(),{attempts:6,seed:17});
  assert.deepEqual(a.puzzle,b.puzzle);
});
test('9x9 and 10x10 supported and validated',()=>{
  for(const size of [9,10]) {
    const result=solve(pool,{sizes:[size],attempts:4});
    assert.ok(result.puzzle);assert.equal(result.puzzle.board.length,size);assert.equal(result.validation.valid,true);
  }
});
test('no-cross candidates exhaust 8,9,10 in order and never claim unsatisfiable',()=>{
  const result=solve([{id:'a',word:'天地',event_id:'a'},{id:'b',word:'玄黃',event_id:'b'}],{target:2,minEntries:2,attempts:1});
  assert.equal(result.status,'SEARCH_EXHAUSTED');assert.deepEqual(result.diagnostics.map(d=>d.size),[8,9,10]);
});
test('small valid result is explicitly PARTIAL with unselected candidates',()=>{
  const result=solve([...tech().expected,{id:'other',word:'天地',event_id:'other'}],{target:3,minEntries:2,attempts:1});
  assert.equal(result.status,'PARTIAL');assert.equal(result.validation.valid,true);assert.equal(result.unselected.length,1);
});
test('same event limited to two selected answers',()=>{
  const candidates=pool.slice(0,4).map(c=>({...c,event_id:'same'}));
  const result=solve(candidates,{target:4,minEntries:2,attempts:2});
  assert.ok(result.puzzle);assert.ok(result.puzzle.expected.length<=2);
});
test('renderer extension revalidates and blocks INVALID',async()=>{
  let called=false;
  await assert.rejects(()=>renderValidated(extraZhiChe(),{render(){called=true;}}),/INVALID/);
  assert.equal(called,false);
  assert.equal(await renderValidated(tech(),{render(p,r){return r.status;}}),'VALID');
});
test('CLI solve JSON output and validate exit codes',()=>{
  const cwd=fileURLToPath(new URL('..',import.meta.url));
  const run=args=>spawnSync(process.execPath,['cli.mjs',...args],{cwd,encoding:'utf8',timeout:30000});
  let r=run(['solve','examples/candidates.json','--attempts','4']);
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Puzzle Status: VALID/);
  r=run(['validate','examples/invalid-zhi-che.json']);assert.equal(r.status,1);assert.match(r.stdout,/智撤/);
  r=run(['solve','examples/candidates.json','--attempts','0']);assert.equal(r.status,2);
  const output=join(tmpdir(),'crossword-test-'+randomUUID()+'.json');
  try {
    r=run(['solve','examples/candidates.json','--attempts','4','--out',output]);
    assert.equal(r.status,0,r.stderr);
    const saved=JSON.parse(readFileSync(output,'utf8'));
    assert.equal(validatePuzzle(saved).valid,true);
    r=run(['validate',output]);assert.equal(r.status,0);
  } finally {if(existsSync(output)) unlinkSync(output);}
});
test('reverse scanner scans maximal runs, not subwords',()=>{
  assert.deepEqual(scanBoard(tech().board).map(e=>e.word).sort(),['人工智慧','無人機'].sort());
});

test('actual fallback from 8 to 9 for four separated long crossing pairs',()=>{
  const cs=Array.from({length:8},(_,i)=>({id:'a'+i,event_id:'e'+i,
    word:String.fromCodePoint(0x5000+Math.floor(i/2)*20)+[1,2,3].map(j=>String.fromCodePoint(0x5000+Math.floor(i/2)*20+(i%2)*4+j)).join('')}));
  const r=solve(cs,{target:8,minEntries:8,attempts:8});
  assert.equal(r.status,'SOLVED');assert.equal(r.puzzle.board.length,9);
  assert.deepEqual(r.diagnostics.map(d=>d.size),[8,9]);
  assert.equal(validatePuzzle(r.puzzle).valid,true);
});
test('V02 also catches an answer physically missing from the final board',()=>{
  const p=tech();p.board[1][2]=BLOCK;fails(p,'V02');
});
test('multiple seeds all returned puzzles independently pass',()=>{
  for(let seed=1;seed<=20;seed++) {
    const r=solve(pool,{seed,attempts:4});
    assert.ok(r.puzzle,'seed '+seed);
    assert.equal(validatePuzzle(r.puzzle).valid,true,'seed '+seed);
    assert.equal(r.puzzle.expected.length,12);
  }
});
test('all single-cell mutations of historic board are detected',()=>{
  const p=historic();
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) {
    const copy=structuredClone(p);
    copy.board[r][c]=copy.board[r][c]===BLOCK?'智':BLOCK;
    assert.equal(validatePuzzle(copy).valid,false,'mutation '+r+','+c);
  }
});
