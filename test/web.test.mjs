import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateEditions} from '../core/editions.mjs';
import {assertPrintableReport} from '../src/pdf.mjs';
import {preparePacket} from '../src/worker.mjs';
const input=JSON.parse(readFileSync(new URL('../core/examples/mixed-input.json',import.meta.url),'utf8'));
const report=generateEditions(input,{solverOptions:{attempts:256,seed:2}});
test('browser PDF accepts a complete, independently valid, nonrepeating batch',()=>assert.equal(assertPrintableReport(report),true));
test('PDF rejects incomplete output and requests outside the 1-7 limit',()=>{
 assert.throws(()=>assertPrintableReport({...report,status:'INCOMPLETE'}));
 assert.throws(()=>assertPrintableReport({...report,requested_count:8,generated_count:8}));
});
test('PDF reverse scans even when a saved report claims all PASS',()=>{
 const r=structuredClone(report),p=r.editions[0].puzzle,b=Array.from({length:10},()=>Array(10).fill('■'));
 p.board.forEach((row,i)=>row.forEach((ch,j)=>b[i][j]=ch));b[8][9]='智';b[9][9]='撤';p.board=b;
 assert.throws(()=>assertPrintableReport(r),/獨立驗證/);
});
test('PDF cannot reuse a single answer or trust changed player cells',()=>{
 const r=structuredClone(report);r.requested_count=2;r.generated_count=2;r.editions.push({...structuredClone(r.editions[0]),edition_number:2});
 assert.throws(()=>assertPrintableReport(r),/重複/);
 const a=structuredClone(report);a.editions[0].player.board[0][0].value='國';assert.throws(()=>assertPrintableReport(a),/資料不一致/);
});
test('bank preparation is read-only and excludes entertainment keyword generation',()=>{
 const before=structuredClone(input),p=preparePacket(input);
 assert.deepEqual(input,before);assert.equal(p.packet.news.candidates.length,27);assert.equal(p.excluded_events,2);
 assert.ok(p.packet.news.candidates.every(c=>!['tourism-market','africa-expo'].includes(c.event_id)));
});
test('invalid imports and unsafe size bounds fail before replacing current bank',()=>{
 assert.throws(()=>preparePacket({}));
 assert.throws(()=>preparePacket({...input,idioms:Array(301).fill(input.idioms[0])}));
 const p=structuredClone(input);p.idioms.push(structuredClone(p.idioms[0]));assert.throws(()=>preparePacket(p));
});
