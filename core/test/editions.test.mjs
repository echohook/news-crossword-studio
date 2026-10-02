import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateEditions} from '../editions.mjs';
import {validateEditionDiversity} from '../edition-policy.mjs';
const c=(id,word,clue)=>({id,word,event_id:id,clue});
const pool=[c('a','黃金','貴重的黃色金屬。（2字）'),c('b','金牌','競賽第一名的獎牌。（2字）')];
const options={solverOptions:{target:2,attempts:3,seed:2},maxVariantAttempts:1};
test('one requested edition is independently validated and has player and answer sheets',()=>{
 const r=generateEditions(pool,options);assert.equal(r.status,'COMPLETE');assert.equal(r.generated_count,1);
 const e=r.editions[0];assert.ok(e.grid_validation.checks.every(c=>c.pass));assert.equal(e.player.worksheet_id,e.answers.worksheet_id);
 assert.ok(!JSON.stringify(e.player).includes('黃金'));assert.equal(e.approved_for_print,false);
});
test('same answers in another layout do not count as a new edition; shortage is explicit',()=>{
 const r=generateEditions(pool,{...options,count:3});assert.equal(r.status,'INCOMPLETE');assert.equal(r.generated_count,1);
 assert.equal(r.requested_count,3);assert.equal(r.attempts.length,2);assert.equal(r.attempts[1].status,'REMAINING_POOL_TOO_SMALL');
});
test('batch inputs are read-only and seed makes every edition reproducible',()=>{
 const before=structuredClone(pool),a=generateEditions(pool,options),b=generateEditions(pool,options);
 assert.deepEqual(pool,before);assert.deepEqual(a,b);
});
test('count and attempt bounds fail before generation',()=>{
 for(const count of [0,-1,1.5,'3',8,7.5,50,NaN])assert.throws(()=>generateEditions(pool,{count}));
 assert.equal(generateEditions(pool,{...options,count:7}).requested_count,7);
 for(const maxVariantAttempts of [0,11,'2'])assert.throws(()=>generateEditions(pool,{maxVariantAttempts}));
});
test('incomplete target and leaking clues never enter printable batch',()=>{
 assert.equal(generateEditions(pool,{solverOptions:{target:3,attempts:1}}).generated_count,0);
 const p=structuredClone(pool);p[0].clue='黃金是貴重金屬。（2字）';
 assert.equal(generateEditions(p,options).generated_count,0);
});
test('news and idiom batch keeps exact composition and entertainment exclusion',()=>{
 const input=JSON.parse(readFileSync(new URL('../examples/mixed-input.json',import.meta.url),'utf8'));
 const r=generateEditions(input,{solverOptions:{attempts:256,seed:2},maxVariantAttempts:1});
 assert.equal(r.status,'COMPLETE');assert.deepEqual(r.editions[0].content_summary.selected,{news:8,idiom:4});
 assert.ok(r.editions[0].puzzle.expected.every(c=>!['africa-expo','tourism-market'].includes(c.event_id)));
});
test('generate CLI accepts count and returns nonzero for incomplete requested output',()=>{
 const cwd=fileURLToPath(new URL('..',import.meta.url));
 const invalid=spawnSync(process.execPath,['cli.mjs','generate','examples/candidates.json','--count','0'],{cwd,encoding:'utf8'});
 assert.equal(invalid.status,2);assert.match(invalid.stderr,/份數/);
 const r=spawnSync(process.execPath,['cli.mjs','generate','examples/mixed-input.json','--count','1','--attempts','256','--json'],{cwd,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).generated_count,1);
});

test('a sufficiently varied pool can satisfy three distinct complete editions',()=>{
 const p=[...pool,c('t','科技','運用知識發展創新工具的領域。（2字）'),c('s','技術','實作所需的方法及技能。（2字）'),
  c('w','文化','社會共同的生活及思想方式。（2字）'),c('h','化學','研究物質組成與變化的學科。（2字）')];
 const r=generateEditions(p,{count:3,solverOptions:{target:2,attempts:2,seed:123456},maxVariantAttempts:10});
 assert.equal(r.status,'COMPLETE');assert.equal(r.generated_count,3);
 assert.equal(new Set(r.editions.flatMap(e=>e.puzzle.expected.map(c=>c.word))).size,6);
 assert.equal(r.diversity_validation.valid,true);
 assert.deepEqual(r.editions.map(e=>e.edition_number),[1,2,3]);
 assert.ok(r.editions.every(e=>e.grid_validation.valid));
});

test('the mixed pool tries news after all four idioms have been consumed',()=>{
 const input=JSON.parse(readFileSync(new URL('../examples/mixed-input.json',import.meta.url),'utf8'));
 const r=generateEditions(input,{count:2,solverOptions:{attempts:256,seed:2}});
 assert.equal(r.status,'INCOMPLETE');assert.equal(r.generated_count,1);
 assert.equal(r.shortage,null);assert.ok(r.attempts.slice(1).some(a=>a.status==='NO_FULL_PUZZLE'));
 assert.equal(r.diversity_validation.valid,true);
});
test('even one shared answer is rejected when its clue and position change',()=>{
 const a={puzzle:{expected:[c('a','黃金','貴重的黃色金屬。（2字）')]}};
 const b={puzzle:{expected:[c('b','黃金','首飾常用的貴金屬。（2字）')]}};
 const v=validateEditionDiversity([a,b]);assert.equal(v.valid,false);assert.ok(v.errors.some(e=>e.code==='D01'));
});
test('identical clues with changed punctuation, spacing or length hints cannot reappear',()=>{
 const v=validateEditionDiversity([{puzzle:{expected:[c('a','黃金','這是一種獎勵。（2字）')]}},
 {puzzle:{expected:[c('b','銀牌',' 這是 一種獎勵!（3字）')]}}]);
 assert.equal(v.valid,false);assert.ok(v.errors.some(e=>e.code==='D02'));
});
test('clue duplicates within one edition and malformed diversity input fail closed',()=>{
 assert.equal(validateEditionDiversity([{puzzle:{expected:[c('a','黃金','同一則提示。（2字）'),c('b','金牌','同一則提示。（2字）')]}}]).valid,false);
 for(const data of [null,[],[{}],[{puzzle:{expected:[{word:'黃金'}]}}]])assert.equal(validateEditionDiversity(data).valid,false);
});
