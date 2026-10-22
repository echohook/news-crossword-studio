import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateEditions} from '../core/editions.mjs';
import {runMixed} from '../core/mixed.mjs';
import {validatePuzzle} from '../core/validator.mjs';
import {validateEditorialSelection} from '../core/editorial.mjs';
import {bankFingerprint,verifiedCapacity,generateVerifiedEditions} from '../core/verified-bank.mjs';
import {assessBankReadiness} from '../news/readiness.mjs';
import {currentBank,loadAutoBank} from '../src/auto-bank.mjs';
import {preparePacket} from '../src/worker.mjs';
import {assertPrintableReport} from '../src/pdf.mjs';
import {updateNews} from '../scripts/update-news.mjs';
import {MAX_NEWS_EVENTS,MAX_BANK_BYTES} from '../core/limits.mjs';
const before=JSON.parse(readFileSync(new URL('./fixtures/multi-context-shortage.json',import.meta.url)));
const weekly=JSON.parse(readFileSync(new URL('./fixtures/multi-weekly.json',import.meta.url)));
const options={count:2,solverOptions:{attempts:16,seed:2}};
const two=generateEditions(before,options);
const progress=[];
const seven=generateEditions(weekly,{count:7,solverOptions:{attempts:16,seed:2},onProgress:p=>progress.push(p)});
test('the formerly failing 69-answer bank completes two editions with fewer than four crossable event clues',()=>{
 assert.equal(before.news.candidates.length,69);assert.equal(two.status,'COMPLETE');assert.equal(two.generated_count,2);
 assert(two.editions.some(e=>e.editorial_validation.summary.contextual<2));
 assert(two.diversity_validation.valid);assertPrintableReport(two);
});
test('a preserved weekly bank completes seven disjoint validated twelve-question editions',()=>{
 assert.equal(seven.status,'COMPLETE');assert.equal(seven.generated_count,7);
 assert.equal(new Set(seven.editions.flatMap(e=>e.puzzle.expected.map(c=>c.word))).size,84);
 for(const e of seven.editions){assert(validatePuzzle(e.puzzle).valid);assert(validateEditorialSelection(e.puzzle.expected).valid);assert.equal(e.puzzle.expected.length,12);}
 assertPrintableReport(seven);
});
test('completion progress reaches the requested count and records the reproducible seed',()=>{
 assert(progress.some(p=>p.phase==='edition-complete'&&p.generated_count===7&&p.requested_count===7));
 assert.equal(seven.batch_search.seed,2);
 assert(progress.every(p=>p.generated_count>=0&&p.generated_count<=7));
});
test('different explicit seeds can vary puzzles while repeating a seed reproduces the batch',()=>{
 const repeated=generateEditions(before,options),changed=generateEditions(before,{count:2,solverOptions:{attempts:16,seed:17}});
 assert.equal(repeated.batch_id,two.batch_id);assert.equal(changed.status,'COMPLETE');assert.notEqual(changed.batch_id,two.batch_id);
});
test('raw answer counts do not conceal a true shortage of crossable words',()=>{
 const p={editorial_policy:before.editorial_policy,candidates:before.news.candidates.filter(c=>['醫療','輝達'].includes(c.word))};
 const r=generateEditions(p,{count:2,solverOptions:{target:2,attempts:1}});
 assert.equal(r.status,'INCOMPLETE');assert.equal(r.generated_count,0);assert.equal(r.shortage.code,'CROSSABLE_POOL_TOO_SMALL');
 assert.equal(r.shortage.available.crossable,0);assert.throws(()=>assertPrintableReport(r));
});
test('news intake can validate without running a redundant preliminary layout search',()=>{
 const p=runMixed(before,{intakeOnly:true});assert.equal(p.status,'INTAKE_READY');assert.equal(p.news_report.solver_result,null);assert.equal(p.puzzle,null);
 assert(p.eligible_candidates.length>=69);assert.throws(()=>runMixed(before,{intakeOnly:'yes'}));
});
test('the browser loads a weekly bank larger than the old 2 MB / 200-event limits',async()=>{
 const p=structuredClone(weekly);while(p.news.events.length<220){const e=structuredClone(p.news.events[0]);e.event_id='additional-'+p.news.events.length;e.dedup_key=e.event_id;p.news.events.push(e);}
 p.padding='x'.repeat(2*1024*1024);const now=new Date('2026-10-01T10:01:00Z');
 const result=await loadAutoBank({fallback:before,now,fetchImpl:async()=>new Response(JSON.stringify(p))});
 assert.equal(result.connection,'ONLINE');assert.equal(result.packet.news.events.length,220);
 assert.equal(preparePacket(result.packet).packet.news.events.length,220);
});
test('expanded archive bounds still reject oversized banks',async()=>{
 const p=structuredClone(before);p.news.events.length=MAX_NEWS_EVENTS+1;
 assert.throws(()=>preparePacket(p));assert.throws(()=>currentBank(p,{now:new Date('2026-10-01T10:01:00Z')}));
 const r=await loadAutoBank({fallback:before,now:new Date('2026-10-01T10:01:00Z'),fetchImpl:async()=>new Response('x'.repeat(MAX_BANK_BYTES+1))});
 assert.equal(r.connection,'OFFLINE');
});
test('readiness is backed by actual generation and becomes invalid if the candidate snapshot changes',()=>{
 const p=structuredClone(before);p.automation.generation_check=assessBankReadiness(p,{count:2,attempts:16});
 assert.equal(verifiedCapacity(p),2);assert.equal(p.automation.generation_check.fingerprint,bankFingerprint(p));
 p.news.candidates[0].clue+=' changed';assert.equal(verifiedCapacity(p),null);
});
test('advancing the news day clears an obsolete readiness claim',()=>{
 const p=structuredClone(before);p.automation.generation_check={issue_date:p.news.issue_date,generated_count:7,fingerprint:bankFingerprint(p)};
 const next=currentBank(p,{now:new Date('2026-10-02T10:00:00Z')});assert.equal(next.automation.generation_check,undefined);
});
test('normal randomized generation remains independently validated even when verified metadata is present',()=>{
 const p=structuredClone(before);p.automation.generation_check=assessBankReadiness(p,{count:2,attempts:16});
 const r=generateVerifiedEditions(p,{count:2,seed:23,attempts:16});assert.equal(r.status,'COMPLETE');assertPrintableReport(r);
});
test('relaxing the event-clue quota does not permit news with fabricated source evidence',()=>{
 const e=structuredClone(two.editions[0]),c=e.puzzle.expected.find(c=>c.content_kind==='news');
 c.source_support[0].evidence='不存在的證據';
 const q=validateEditorialSelection(e.puzzle.expected);assert(!q.valid);assert(!q.checks.find(c=>c.id==='Q06').pass);
});
test('a seemingly refreshed RSS bank that cannot produce even one edition cannot overwrite the prior bank',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'crossword-readiness-')),path=join(folder,'bank.json'),bytes=JSON.stringify(before);
 const xml='<rss><channel><item><title>匯率與通膨影響政策</title><link>https://www.cna.com.tw/news/aipl/202610020001.aspx</link><pubDate>Fri, 02 Oct 2026 09:00:00 +0800</pubDate></item></channel></rss>';
 try{await writeFile(path,bytes);await assert.rejects(updateNews({now:new Date('2026-10-02T10:00:00Z'),destinationPath:path,fetchImpl:async()=>new Response(xml)}),/無法實際/);assert.equal(await readFile(path,'utf8'),bytes);}
 finally{await rm(folder,{recursive:true,force:true});}
});

