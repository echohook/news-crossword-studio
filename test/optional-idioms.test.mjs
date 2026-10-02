import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runMixed,solveMixedPool} from '../core/mixed.mjs';
import {generateEditions} from '../core/editions.mjs';
import {preparePacket} from '../src/worker.mjs';
import {assertPrintableReport} from '../src/pdf.mjs';
import {packetForWords,fullPacket} from '../core/test/news-fixtures.mjs';
const original=JSON.parse(readFileSync(new URL('../core/examples/mixed-input.json',import.meta.url),'utf8'));
const settings={solverOptions:{attempts:256,seed:2}};
const small=()=>({news:packetForWords(['黃金','金牌','債市','債券']),idioms:[original.idioms[0]],mix:{news:1,idiom:1}});

test('zero available idioms are replaced by news without reducing the target',()=>{
 const input=small();input.idioms=[];const before=structuredClone(input),r=runMixed(input,settings);
 assert.equal(r.status,'REVIEW_REQUIRED');assert.deepEqual(r.content_summary.selected,{news:2,idiom:0});
 assert.equal(r.puzzle.expected.length,2);assert.ok(r.grid_validation.valid);assert.equal(r.content_summary.fallback,true);assert.deepEqual(input,before);
});
test('after using the only idiom the next edition is all news and remains printable',()=>{
 const r=generateEditions(small(),{...settings,count:2});
 assert.equal(r.status,'COMPLETE');assert.equal(r.generated_count,2);
 assert.deepEqual(r.editions.map(e=>e.content_summary.selected),[{news:1,idiom:1},{news:2,idiom:0}]);
 assert.ok(r.diversity_validation.valid);assert.ok(r.editions.every(e=>e.grid_validation.valid));assert.equal(assertPrintableReport(r),true);
});
test('one unplaceable idiom can be omitted even when the raw count is sufficient',()=>{
 const pool=[{id:'a',word:'黃金',event_id:'a',content_kind:'news'},{id:'b',word:'金牌',event_id:'b',content_kind:'news'},{id:'i',word:'海闊天空',event_id:'i',content_kind:'idiom'}];
 const r=solveMixedPool(pool,{news:1,idiom:1},{attempts:3,seed:2});
 assert.deepEqual(r.effective,{news:2,idiom:0});assert.ok(r.result.puzzle);assert.deepEqual(r.attempted.map(a=>a.idiom),[1,0]);
});
test('no optional idioms still allows a full twelve-entry edition',()=>{
 const r=runMixed({news:fullPacket(),idioms:[]},settings);
 assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.puzzle.expected.length,12);assert.deepEqual(r.content_summary.selected,{news:12,idiom:0});assert.ok(r.grid_validation.valid);
});
test('a partial idiom bank only uses admitted idioms and supplements news',()=>{
 const packet={news:fullPacket(),idioms:original.idioms.slice(0,2)};
 const r=runMixed(packet,settings);assert.ok(r.puzzle);assert.equal(r.puzzle.expected.length,12);assert.ok(r.content_summary.selected.idiom<=2);
 assert.equal(r.content_summary.selected.news+r.content_summary.selected.idiom,12);
});
test('missing or explicit zero idioms can be imported without weakening malformed input checks',()=>{
 const input=small();delete input.idioms;const before=structuredClone(input),prepared=preparePacket(input);
 assert.deepEqual(prepared.packet.idioms,[]);assert.deepEqual(input,before);
 assert.ok(runMixed({...small(),idioms:[],mix:{news:2,idiom:0}},settings).puzzle);
 assert.throws(()=>runMixed({...small(),idioms:null},settings));assert.throws(()=>preparePacket({...small(),mix:{news:1,idiom:0}}));assert.throws(()=>preparePacket({...small(),idioms:null}));assert.throws(()=>preparePacket({...small(),mix:{news:2,idiom:-1}}));
});
test('news shortage still fails closed and cannot repeat content to fill a batch',()=>{
 const input=small();input.news=packetForWords(['黃金']);input.idioms=[];
 const r=generateEditions(input,{...settings,count:2});assert.equal(r.status,'INCOMPLETE');assert.equal(r.generated_count,0);
 assert.equal(r.shortage.code,'REMAINING_POOL_TOO_SMALL');assert.deepEqual(r.shortage.needed_for_next,{total:2,news:2,idiom:0});assert.throws(()=>assertPrintableReport(r));
});

test('the shipped real-news snapshot prints twelve news questions when idioms are removed',()=>{
 const p=structuredClone(original);p.idioms=[];
 const r=generateEditions(p,settings);assert.equal(r.status,'COMPLETE');assert.equal(r.editions[0].puzzle.expected.length,12);
 assert.deepEqual(r.editions[0].content_summary.selected,{news:12,idiom:0});assert.equal(assertPrintableReport(r),true);
});
