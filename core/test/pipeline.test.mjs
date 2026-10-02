import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {newsWindow,dateDay,collectEvents,generateCandidates,scoreValue,EVENT_WEIGHTS,ANSWER_WEIGHTS} from '../news.mjs';
import {validateClue} from '../clues.mjs';
import {runPipeline} from '../pipeline.mjs';
import {runBatch} from '../batch.mjs';
import {JsonSnapshotCollector,runFromAdapters} from '../adapters.mjs';
import {fullPacket,packetForWords,badPacket} from './news-fixtures.mjs';

const settings={issueDate:'2026-10-01',fixture:true};
const smallOptions={solverOptions:{target:2,minEntries:2,attempts:2}};
const prepared=p=>collectEvents(p.events,settings);
const explicit=p=>({...p,candidates:generateCandidates(prepared(p).accepted)});
const cluePair=()=>{const p=packetForWords(['無人機']);const e=prepared(p).accepted[0];return {event:e,candidate:generateCandidates([e])[0]};};
const checkFails=(c,e,id)=>assert.equal(validateClue(c,e).checks.find(x=>x.id===id).pass,false);
const cwd=fileURLToPath(new URL('..',import.meta.url));
const cli=args=>spawnSync(process.execPath,['cli.mjs',...args],{cwd,encoding:'utf8',timeout:30000});

test('seven day window inclusive and UTC independent',()=>{
  assert.deepEqual(newsWindow('2026-10-01'),{from:'2026-09-25',to:'2026-10-01'});
  assert.deepEqual(newsWindow('2026-01-03'),{from:'2025-12-28',to:'2026-01-03'});
  assert.notEqual(dateDay('2024-02-29'),null);assert.equal(dateDay('2026-02-29'),null);
  assert.throws(()=>newsWindow('2026-02-30'));
});
test('event date outside inclusive seven days and future update rejected',()=>{
  for(const date of ['2026-09-24','2026-10-02','2026-02-30']) {
    const p=packetForWords(['無人機']);p.events[0].event_date=date;
    const r=prepared(p);assert.equal(r.accepted.length,0);assert.equal(r.reports[0].checks[0].pass,false);
  }
  const p=packetForWords(['無人機']);p.events[0].updated_at='2026-10-02';assert.equal(prepared(p).accepted.length,0);
});
test('same explicit event key merges sources and selects latest state deterministically',()=>{
  const p=packetForWords(['無人機']),a=p.events[0];
  a.dedup_key='shared';
  const b=structuredClone(a);b.event_id='z-new';b.event_date='2026-09-30';b.fact_status='considering';
  b.sources[0].source_id='new-source';p.events.push(b);
  const r=prepared(p),reversed=prepared({...p,events:[...p.events].reverse()});
  assert.equal(r.eventCount,1);assert.equal(r.accepted[0].sources.length,2);
  assert.equal(r.accepted[0].fact_status,'considering');
  assert.equal(r.aliases.get('z-new'),'event-01');
  assert.deepEqual(r.accepted,reversed.accepted);
});
test('duplicate event IDs refused instead of silently collapsing revisions',()=>{
  const p=packetForWords(['無人機']);p.events.push(structuredClone(p.events[0]));
  assert.throws(()=>prepared(p),/event_id 重複/);
});
test('conflicting records for same source ID block event',()=>{
  const p=packetForWords(['無人機']),b=structuredClone(p.events[0]);
  b.event_id='duplicate';b.dedup_key=p.events[0].dedup_key='same';
  b.sources[0].excerpt='互相矛盾的測試摘錄';p.events.push(b);
  const r=prepared(p);assert.equal(r.accepted.length,0);assert.ok(r.reports[0].source_conflicts.length);
});
test('source scheme, publication date and fixture mode enforced',()=>{
  for(const mutate of [
    s=>{s.url='javascript:alert(1)';},
    s=>{s.url='https://user:secret@example.invalid/news';},
    s=>{s.published_at='2026-09-24';},
    s=>{s.published_at='2026-10-02';},
    s=>{s.excerpt='';}
  ]) {
    const p=packetForWords(['無人機']);mutate(p.events[0].sources[0]);assert.equal(prepared(p).accepted.length,0);
  }
  const p=packetForWords(['無人機']);
  assert.equal(collectEvents(p.events,{issueDate:p.issue_date}).accepted.length,0);
});
test('one valid source sufficient, invalid extra sources discarded with count',()=>{
  const p=packetForWords(['無人機']);
  p.events[0].sources.push({source_id:'bad',url:'file:///bad'});
  const r=prepared(p);assert.equal(r.accepted.length,1);assert.equal(r.reports[0].discarded_source_count,1);
});
test('unverified, opinion and missing event metadata rejected',()=>{
  for(const mutate of [
    e=>{e.fact_status='unverified';},
    e=>{e.content_type='opinion';},
    e=>{e.summary='';},
    e=>{e.categories=Array(2);}
  ]) {
    const p=packetForWords(['無人機']);mutate(p.events[0]);assert.equal(prepared(p).accepted.length,0);
  }
});
test('event and answer score thresholds inclusive at 60 and 70',()=>{
  const p=packetForWords(['人工智慧','無人機']);
  p.events.forEach(e=>{e.event_score=60;e.keywords[0].answer_score=70;});
  const r=runPipeline(p,smallOptions);assert.equal(r.status,'REVIEW_REQUIRED');
  const lowEvent=structuredClone(p);lowEvent.events[0].event_score=59;
  assert.equal(runPipeline(lowEvent,smallOptions).event_summary.admitted,1);
  const lowAnswer=structuredClone(p);lowAnswer.events[0].keywords[0].answer_score=69;
  assert.equal(runPipeline(lowAnswer,smallOptions).candidate_summary.admitted,1);
});
test('score component limits, totals, missing fields and unknown keys checked',()=>{
  for(const [key,weights] of [['event_score',EVENT_WEIGHTS],['answer_score',ANSWER_WEIGHTS]]) {
    assert.equal(scoreValue({score_components:{...weights}},key,weights).value,100);
    assert.ok(scoreValue({[key]:90,score_components:{...weights}},key,weights).error);
    assert.ok(scoreValue({score_components:{}},key,weights).error);
    assert.ok(scoreValue({score_components:{...weights,unknown:0}},key,weights).error);
    const polluted=JSON.parse(JSON.stringify(weights));Object.defineProperty(polluted,'__proto__',{value:0,enumerable:true});
    assert.ok(scoreValue({score_components:polluted},key,weights).error);
  }
});
test('keyword generator appends hints and source evidence, preserves wrong hint for rejection',()=>{
  const {event}=cluePair(),c=generateCandidates([event])[0];
  assert.ok(c.clue.endsWith('（3字）'));assert.equal(c.source_support.length,1);assert.equal(c.event_revision,event.content_revision);
  event.keywords[0].clue_draft='不需機上駕駛操作的飛行器。（2字）';
  checkFails(generateCandidates([event])[0],event,'C03');
});
test('answer leak including spaces punctuation and zero width characters rejected',()=>{
  const {candidate:c,event:e}=cluePair();
  for(const clue of ['這個無人機是不需機上駕駛的飛行器。（3字）','這個無、人、機是不需駕駛的飛行器。（3字）','這個無人\u200b機是不需駕駛的飛行器。（3字）'])
    checkFails({...c,clue},e,'C01');
});
test('short, empty and overlong clues fail length check',()=>{
  const {candidate:c,event:e}=cluePair();
  for(const clue of ['', '飛行（3字）','飛行器'.repeat(25)+'（3字）']) checkFails({...c,clue},e,'C02');
});
test('wrong hint and absent hint fail; full width digit and Chinese numeral accepted',()=>{
  const {candidate:c,event:e}=cluePair();
  checkFails({...c,clue:'不需機上駕駛操作的飛行器。'},e,'C03');
  checkFails({...c,clue:'不需機上駕駛操作的飛行器。（2字）'},e,'C03');
  for(const suffix of ['（３字）','（三字）']) assert.equal(validateClue({...c,clue:'不需機上駕駛操作的飛行器。'+suffix},e).passed,true);
});
test('known same length alternative blocks clue, absence of alternatives is not uniqueness proof',()=>{
  const {candidate:c,event:e}=cluePair();
  checkFails({...c,alternative_answers:['飛行器']},e,'C04');
  const r=validateClue({...c,alternative_answers:['機器']},e);
  assert.equal(r.passed,true);assert.equal(r.semantic_review,'REQUIRED');
});
test('considering and planned retain qualifier and reject certainty upgrade',()=>{
  const p=packetForWords(['台積電']),e=prepared(p).accepted[0],c=generateCandidates([e])[0];
  e.fact_status='considering';checkFails(c,e,'C05');
  assert.equal(validateClue({...c,clue:'近日傳出評估投資的台灣晶圓代工企業。（3字）'},e).passed,true);
  checkFails({...c,clue:'評估後已決定投資的台灣晶圓代工企業。（3字）'},e,'C05');
  e.fact_status='planned';
  assert.equal(validateClue({...c,clue:'預計進行投資的台灣晶圓代工企業。（3字）'},e).passed,true);
  checkFails({...c,clue:'已完成投資的台灣晶圓代工企業。（3字）'},e,'C05');
});
test('reported status requires attribution',()=>{
  const {candidate:c,event:e}=cluePair();e.fact_status='reported';checkFails(c,e,'C05');
  assert.equal(validateClue({...c,clue:'據報導不需機上駕駛操作的飛行器。（3字）'},e).passed,true);
});
test('evidence must refer to admitted source, contain answer and match excerpt',()=>{
  const {candidate:c,event:e}=cluePair(),id=e.sources[0].source_id;
  for(const source_support of [[],[{source_id:'missing',evidence:e.sources[0].excerpt}],
    [{source_id:id,evidence:'新聞談及人工智慧。'}],[{source_id:id,evidence:'報導說無人機已大獲全勝。'}]])
    checkFails({...c,source_support},e,'C06');
});
test('invalid keywords and duplicate candidate IDs cannot enter Solver',()=>{
  const p=explicit(packetForWords(['人工智慧','無人機']));
  p.candidates[0].word='人';
  assert.ok(runPipeline(p,smallOptions).candidate_reports[0].errors.some(e=>e.code==='A01'));
  const duplicate=explicit(packetForWords(['人工智慧','無人機']));
  duplicate.candidates[1].id=duplicate.candidates[0].id;
  assert.equal(runPipeline(duplicate,smallOptions).status,'NO_ELIGIBLE_CANDIDATES');
});
test('unknown event candidate cannot enter Solver',()=>{
  const p=explicit(packetForWords(['人工智慧','無人機']));p.candidates[0].event_id='missing';
  assert.ok(runPipeline(p,smallOptions).candidate_reports[0].errors.some(e=>e.code==='A02'));
});
test('duplicate answer keeps highest qualified answer score deterministically',()=>{
  const p=packetForWords(['無人機','無人機']);
  p.events[0].keywords[0].answer_score=75;p.events[1].keywords[0].answer_score=95;
  const r=runPipeline(p,smallOptions);
  assert.equal(r.eligible_candidates.length,1);assert.equal(r.eligible_candidates[0].answer_score,95);
  assert.ok(r.candidate_reports.some(c=>c.errors.some(e=>e.code==='DUPLICATE_ANSWER')));
});
test('major event revision rejects stale candidate and regenerates latest bindings',()=>{
  const p=explicit(packetForWords(['人工智慧','無人機']));
  const newer=structuredClone(p.events[0]);
  p.events[0].dedup_key=newer.dedup_key='same';
  newer.event_id='new-version';newer.updated_at='2026-10-01';newer.supersedes_candidates=true;
  newer.sources[0].source_id='new-source';p.events.push(newer);
  const r=runPipeline(p,smallOptions);
  assert.ok(r.candidate_reports[0].errors.some(e=>e.code==='A04'));
  delete p.candidates;
  assert.equal(runPipeline(p,smallOptions).status,'REVIEW_REQUIRED');
});
test('full pipeline gets 8x8 12 entries balanced, all clue and grid checks pass, review remains required',()=>{
  const r=runPipeline(fullPacket());
  assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.grid_status,'VALID');
  assert.equal(r.puzzle.board.length,8);assert.equal(r.puzzle.expected.length,12);
  assert.deepEqual(r.grid_validation.balance.counts,{2:4,3:4,4:4});
  assert.ok(r.grid_validation.checks.every(c=>c.pass));assert.ok(r.clue_validation.every(c=>c.passed));
  assert.equal(r.approved_for_print,false);assert.equal(r.review_required.length,6);
});
test('pipeline repeatability and no mutation of input',()=>{
  const p=fullPacket(),before=structuredClone(p),r=runPipeline(p);
  assert.deepEqual(p,before);
  assert.deepEqual(runPipeline({...p,events:[...p.events].reverse()}).puzzle,r.puzzle);
});
test('bad clue fixture produces detailed rejection, never a grid or print approval',()=>{
  const r=runPipeline(badPacket(),smallOptions);
  assert.equal(r.status,'NO_ELIGIBLE_CANDIDATES');assert.equal(r.puzzle,null);
  assert.ok(r.candidate_reports[0].errors.some(e=>e.code==='C01'));
  assert.ok(r.candidate_reports[1].errors.some(e=>e.code==='C03'));
  assert.equal(r.approved_for_print,false);
});
test('missing anchor is reported, cannot force illegal isolated entry',()=>{
  const p=packetForWords(['人工智慧','無人機','天地']);p.events[2].anchor_event=true;
  const r=runPipeline(p,smallOptions);
  assert.ok(r.quality_summary.missing_anchors.some(e=>e.event_id==='event-03'));
  assert.equal(r.grid_validation.valid,true);
});
test('empty input, explicit empty candidates and unknown mode handled',()=>{
  assert.equal(runPipeline({issue_date:'2026-10-01',events:[]}).status,'NO_ELIGIBLE_CANDIDATES');
  assert.equal(runPipeline({...fullPacket(),candidates:[]}).status,'NO_ELIGIBLE_CANDIDATES');
  assert.throws(()=>runPipeline({...fullPacket(),dataset_mode:'pretend'}));
});
test('local snapshot collector and injectable adapters use the same gates',async()=>{
  const collector=new JsonSnapshotCollector(join(cwd,'examples/news-input.json'));
  const r=await runFromAdapters({issue_date:'2026-10-01',dataset_mode:'fixture'},{collector});
  assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.grid_validation.valid,true);
  let range;
  const bad=await runFromAdapters({issue_date:'2026-10-01',dataset_mode:'fixture'},{
    collector:{async collect(window){range=window;return fullPacket().events;}},
    candidateGenerator:{async generate(){return [{id:'bad',event_id:'event-01',word:'AI',answer_score:99}];}}
  });
  assert.deepEqual(range,{from:'2026-09-25',to:'2026-10-01'});
  assert.equal(bad.status,'NO_ELIGIBLE_CANDIDATES');
});
test('pipeline CLI text and JSON preserve review boundary and rejection exit code',()=>{
  let r=cli(['pipeline','examples/news-input.json','--json']);
  assert.equal(r.status,0,r.stderr);const report=JSON.parse(r.stdout);
  assert.equal(report.status,'REVIEW_REQUIRED');assert.equal(report.approved_for_print,false);
  r=cli(['pipeline','examples/news-rejected.json','--json']);assert.equal(r.status,4);
  assert.equal(JSON.parse(r.stdout).status,'NO_ELIGIBLE_CANDIDATES');
  r=cli(['pipeline','examples/news-input.json','--clue-max-chars','3']);assert.equal(r.status,2);
});
test('batch pipeline cases obey expectations and do not masquerade as SOLVED',async()=>{
  const report=await runBatch({cases:[
    {id:'good',operation:'pipeline',data:fullPacket()},
    {id:'rejected',operation:'pipeline',data:badPacket(),expect:{status:'NO_ELIGIBLE_CANDIDATES'}},
    {id:'wrong',operation:'pipeline',data:fullPacket(),expect:{status:'SOLVED'}}
  ]});
  assert.equal(report.cases[0].passed,true);assert.equal(report.cases[1].passed,true);
  assert.equal(report.cases[2].passed,false);assert.equal(report.passed,false);
});
test('invalid Solver options rejected even when all candidates are filtered',()=>{
  for(const solverOptions of [{target:20},{typo:1},{seed:-1}]) assert.throws(()=>runPipeline(badPacket(),{solverOptions}));
});
test('unknown factual states do not access inherited regex properties',()=>{
  const {candidate:c,event:e}=cluePair();
  for(const status of ['__proto__','constructor',null]) checkFails(c,{...e,fact_status:status},'C05');
});
test('hidden characters cannot disguise upgrade from considering to certainty',()=>{
  const p=packetForWords(['台積電']),e=prepared(p).accepted[0],c=generateCandidates([e])[0];
  e.fact_status='considering';
  checkFails({...c,clue:'評估後已\u200b決定投資的台灣晶圓代工企業。（3字）'},e,'C05');
});
test('short clue count uses Unicode code points rather than UTF-16 units',()=>{
  const {candidate:c,event:e}=cluePair();
  checkFails({...c,clue:'𠀀𠀁（3字）'},e,'C02');
});
test('source records without identifiers are counted as discarded',()=>{
  const p=packetForWords(['無人機']);p.events[0].sources.push({publisher:'missing id'});
  const r=prepared(p);
  assert.equal(r.accepted.length,1);assert.equal(r.reports[0].discarded_source_count,1);
});