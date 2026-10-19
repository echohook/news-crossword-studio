import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editorialFacts,canAddEditorial,validateEditorialSelection,EXPERIENCED_PROFILE} from '../core/editorial.mjs';
import {experiencedDefinition,EXPERIENCED_DEFINITIONS} from '../core/experienced-definitions.mjs';
import {knownDefinitionClue,CLUE_STYLE} from '../core/definitions.mjs';
import {naturalClueOptions} from '../news/clues.mjs';
import {buildBank,parseFeed,termAllowed} from '../news/collector.mjs';
import {SOURCES} from '../news/sources.mjs';
import {solve} from '../core/solver.mjs';
import {generateEditions} from '../core/editions.mjs';
import {validatePuzzle} from '../core/validator.mjs';
import {assertPrintableReport} from '../src/pdf.mjs';
const profile=EXPERIENCED_PROFILE;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/experienced-candidates.json',import.meta.url)));
const report=generateEditions(fixture,{count:2,solverOptions:{attempts:96,seed:2}});
const meaning=word=>({id:word,event_id:word,word,clue:experiencedDefinition(word).body+'（'+Array.from(word).length+'字）',clue_kind:'meaning',clue_style:CLUE_STYLE,clue_profile:profile});
const geo=word=>{const event={title:word+'將參與跨國能源安全合作計畫',categories:['科技']},entry={word,kind:'國家或地區'};return {id:word,event_id:word,event,...entry,...naturalClueOptions(event,entry,{profile})[0]};};

test('experienced clues reject elementary capital/flag definitions and validate exact authored meanings',()=>{
 assert.deepEqual(naturalClueOptions({title:'日本相關消息'},{word:'日本',kind:'國家或地區'},{profile}),[]);
 const c=meaning('通膨');assert(editorialFacts(c).applied);assert(knownDefinitionClue(c,c.clue.replace(/（.*$/u,'')));
 c.clue='名目所得不變時大家都快樂。（2字）';assert(!editorialFacts(c).qualified);assert(!knownDefinitionClue(c,'名目所得不變時大家都快樂。'));
});
test('all authored advanced terms are natural 2-4 Han characters and clues never reveal their own answer',()=>{
 for(const [word,{body}] of Object.entries(EXPERIENCED_DEFINITIONS)){
  assert(/^\p{Script=Han}{2,4}$/u.test(word),word);assert(Array.from(body+'（'+word.length+'字）').length<=60,word);
  assert(!body.includes(word),word+' leaks itself');
 }
});
test('country-heavy examples fail independently even if the article category says technology',()=>{
 const pool=['日本','美國','韓國','英國','法國','中國'].map(geo);
 assert(pool.every(c=>editorialFacts({...c,kind:'財經用語'}).geographic));
 const r=validateEditorialSelection(pool,{target:12});assert(!r.valid);assert(!r.checks.find(c=>c.id==='Q02').pass);
 assert.equal(canAddEditorial(pool.slice(0,2),[pool[2]],12,profile),false);
 assert.equal(canAddEditorial([pool[0]],pool.slice(1,3),12,profile),false);
});
test('a country-only pool cannot be published as a solved experienced puzzle',()=>{
 const r=solve(['美國','韓國','英國','中國'].map(geo),{target:4,minEntries:4,attempts:1,editorialPolicy:profile});
 assert.equal(r.puzzle,null);
});
test('one topic or institution cluster fails even when all clues are edited',()=>{
 const econ=['通膨','關稅','匯率','利率','供應鏈'].map(meaning);
 assert(!canAddEditorial(econ.slice(0,4),[econ[4]],12,profile));
 const agencies=['國防部','外交部','海巡署'].map(meaning);
 assert(!canAddEditorial(agencies.slice(0,2),[agencies[2]],12,profile));
 const r=validateEditorialSelection(econ,{target:12});assert(!r.checks.find(c=>c.id==='Q03').pass);
});
test('recent event questions preserve the full action, uncertainty and source subject',()=>{
 const event={title:'台積電評估海外新廠投資計畫'},entry={word:'台積電',kind:'企業'};
 const [c]=naturalClueOptions(event,entry,{profile});
 assert.equal(c.clue,'據報導，某家公司評估海外新廠投資計畫。（3字）');
 assert(editorialFacts({...c,...entry,event}).contextual);
 assert(!editorialFacts({...c,...entry,event:{title:'台積電已完成海外新廠投資計畫'}}).contextual);
});
test('complete fixed batch satisfies editorial checks, grid reverse scan and whole-answer deduplication',()=>{
 assert.equal(report.status,'COMPLETE');assert.equal(report.generated_count,2);
 assert(report.diversity_validation.valid);assert.equal(assertPrintableReport(report),true);
 for(const e of report.editions){assert(validatePuzzle(e.puzzle).valid);assert(validateEditorialSelection(e.puzzle.expected).valid);assert.equal(e.puzzle.expected.length,12);}
 const again=generateEditions(fixture,{count:2,solverOptions:{attempts:96,seed:2}});
 assert.equal(again.batch_id,report.batch_id);
});
test('PDF rechecks difficulty and topics instead of trusting saved PASS markers',()=>{
 const r=structuredClone(report),c=r.editions[0].puzzle.expected.find(c=>c.clue_kind==='meaning');
 c.clue='大家都知道的簡單東西。（'+c.word.length+'字）';
 assert(r.editions[0].editorial_validation.valid);
 assert.throws(()=>assertPrintableReport(r),/題材或難度/);
});
test('culture is included and the entertainment RSS channel remains excluded',()=>{
 assert(SOURCES.some(s=>s.url.endsWith('/culture')));assert(!SOURCES.some(s=>s.url.endsWith('/stars')));
 assert.equal(SOURCES.length,10);
});
test('non-golf RSS leads support advanced terms while entertainment descriptions are rejected',()=>{
 const source=SOURCES[0],now=new Date('2026-10-02T10:00:00Z');
 const item=(id,title,lead)=>'<item><title>'+title+'</title><link>https://www.cna.com.tw/news/aipl/'+id+'.aspx</link><pubDate>Fri, 02 Oct 2026 09:00:00 +0800</pubDate><description>'+lead+'</description></item>';
 const events=parseFeed('<rss><channel>'+item('202610020001','政策研討會登場','（中央社2日電）與會者討論通膨及物價變動的影響。')+item('202610020002','產業會議舉行','藝人出席演唱會。')+'</channel></rss>',source,{now});
 assert.equal(events.length,1);assert(events[0].sources[0].excerpt.includes('（中央社2日電）'));
 const packet=buildBank([{source,events}],{now,profile,lexicon:[{word:'通膨',kind:'財經用語'},{word:'物價',kind:'財經用語'}]});
 assert(packet.news.candidates.some(c=>c.word==='通膨'&&c.clue_profile===profile));
});
test('news sense guards distinguish maritime police, typhoon warnings and metaphorical satellites',()=>{
 assert(!termAllowed({word:'海警'},{title:'中國海警船巡航'}));
 assert(termAllowed({word:'海警'},{title:'颱風最快明日發海警'}));
 assert(!termAllowed({word:'衛星'},{title:'讓各地衛星變繁星'}));
 assert(!termAllowed({word:'金融'},{title:'金融時報報導國際動向'}));
});


