import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBank} from '../news/collector.mjs';
import {SOURCES} from '../news/sources.mjs';
import {EXPERIENCED_PROFILE as profile} from '../core/experienced-definitions.mjs';
import {namedTyphoons,validateKnowledge,expandCandidates} from '../core/expansion.mjs';
import {runMixed} from '../core/mixed.mjs';
import {solve} from '../core/solver.mjs';
import {validatePuzzle} from '../core/validator.mjs';
import {buildWorksheet} from '../core/worksheet.mjs';
import {currentBank} from '../src/auto-bank.mjs';
const now=new Date('2026-10-22T10:00:00Z');
// Synthetic article for regression testing, not a real event snapshot.
function event(title='薔琵颱風逼近 東部防災整備'){
 return {event_id:'synthetic-typhoon',dedup_key:'synthetic',event_date:'2026-10-22',updated_at:'2026-10-22',published_at:'2026-10-22T01:00:00Z',title,summary:title,categories:['生活'],fact_status:'reported',content_type:'news',event_score:80,sources:[{source_id:'synthetic-source',publisher:'中央社',kind:'newswire',url:'https://www.cna.com.tw/news/ahel/202610220001.aspx',published_at:'2026-10-22',excerpt:title}]};
}
const bank=()=>buildBank([{source:SOURCES[0],events:[event()]}],{now,profile});
const packet=bank(),intake=runMixed(packet,{intakeOnly:true});
test('typhoon names are extracted from news rather than a fixed name list',()=>{
 for(const title of ['薔琵颱風逼近','颱風薔琵估明日北轉','颱風「薔琵」接近海面'])assert(namedTyphoons({title}).includes('薔琵'));
 assert.deepEqual(namedTyphoons({title:'強烈颱風將帶來豪雨'}),[]);
 assert(packet.news.candidates.some(c=>c.word==='薔琵'&&c.kind==='颱風名稱'));
});
test('news names unlock music and plants that never occurred in the source',()=>{
 for(const word of ['琵琶','薔薇','紫薇']){
  const c=intake.eligible_candidates.find(c=>c.word===word);assert(c,word);assert.equal(c.content_kind,'knowledge');
  assert(!c.event.sources[0].excerpt.includes(word));assert(validateKnowledge(c,c.event));assert.equal(c.expansion.seed_word,'薔琵');
 }
 assert.equal(intake.eligible_candidates.find(c=>c.word==='紫薇').expansion.path.length,2);
});
test('weather topics produce related concepts and an expanded idiom pool',()=>{
 for(const word of ['風災','災難','豪雨','土石流','避難所'])assert(intake.eligible_candidates.some(c=>c.word===word),word);
 for(const word of ['風聲鶴唳','風起雲湧','未雨綢繆','同舟共濟'])assert(intake.eligible_candidates.some(c=>c.word===word&&c.content_kind==='idiom'),word);
 assert(intake.eligible_candidates.every(c=>!c.clue.includes(c.word)));
});
test('the three proposed words can be used in a four-answer legal grid with a further partner',()=>{
 const pool=['薔琵','琵琶','薔薇','紫薇'].map(word=>intake.eligible_candidates.find(c=>c.word===word));
 const r=solve(pool,{target:4,minEntries:4,attempts:16,seed:2});assert(r.puzzle);
 assert(validatePuzzle(r.puzzle).valid);assert.equal(buildWorksheet(r.puzzle).status,'TRIAL_READY');
});
test('forged meaning, dictionary, seed, character path or news linkage is rejected independently',()=>{
 const original=intake.eligible_candidates.find(c=>c.word==='琵琶');
 const changes=[c=>c.clue='大家都知道的樂器。（2字）',c=>c.knowledge_source.url='https://example.invalid/forged',c=>c.expansion.seed_word='不存在',c=>c.expansion.path[0].character='風',c=>c.expansion.path.push(...c.expansion.path,...c.expansion.path),c=>c.expansion.source_id='missing'];
 for(const change of changes){const c=structuredClone(original);change(c);assert(!validateKnowledge(c,c.event));}
 const p=bank();p.news.candidates.find(c=>c.word==='琵琶').expansion.path[0].character='風';
 assert(!runMixed(p,{intakeOnly:true}).eligible_candidates.some(c=>c.word==='琵琶'));
});
test('entertainment events cannot serve as roots for expansion',()=>{
 const e={...event(),is_entertainment:true};assert.deepEqual(expandCandidates([e],[{word:'薔琵',event_id:e.event_id}]),{knowledge:[],idioms:[]});
});
test('related idioms lose eligibility when the supporting event expires or the link is forged',()=>{
 const p=bank();p.idioms[0].related_news.source_id='missing';assert(!runMixed(p,{intakeOnly:true}).eligible_candidates.some(c=>c.id===p.idioms[0].id));
 const later=currentBank(packet,{now:new Date('2026-10-30T10:00:00Z')});assert.equal(later.news.candidates.length,0);assert.equal(later.idioms.length,0);
});
