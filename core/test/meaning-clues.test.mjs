import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClue} from '../clues.mjs';
import {definitionBody,CLUE_STYLE} from '../definitions.mjs';
import {collectEvents,generateCandidates} from '../news.mjs';
import {packetForWords} from './news-fixtures.mjs';
function pair(word='日本',status='reported'){
 const p=packetForWords([word]);p.events[0].fact_status=status;
 const event=collectEvents(p.events,{issueDate:p.issue_date,fixture:true}).accepted[0];
 const candidate={...generateCandidates([event])[0],clue:definitionBody(word)+'（'+Array.from(word).length+'字）',clue_kind:'meaning',clue_style:CLUE_STYLE};
 return {event,candidate};
}
test('registered short meanings remain valid without claiming news reported their definitions',()=>{
 const {event,candidate}=pair();const r=validateClue(candidate,event);
 assert(r.passed);assert(!candidate.clue.includes('報導'));assert(!candidate.clue.includes('哪個'));
});
test('an arbitrary meaning marker cannot bypass factual qualifiers',()=>{
 const {event,candidate}=pair();candidate.clue='這個國家剛宣布全面完成新計畫。（2字）';
 assert(!validateClue(candidate,event).checks.find(c=>c.id==='C05').pass);
});
test('modified or unknown definitions cannot claim the trusted concise style',()=>{
 const p=pair();p.candidate.clue='國名，首都位在某地。（2字）';
 assert(!validateClue(p.candidate,p.event).checks.find(c=>c.id==='C05').pass);
 const unknown=pair('甲乙');unknown.candidate.clue='指某個人或事情。（2字）';
 assert(!validateClue(unknown.candidate,unknown.event).checks.find(c=>c.id==='C05').pass);
});
test('ordinary event clues still need planning qualifiers and cannot overclaim completion',()=>{
 const {event,candidate}=pair('無人機','planned');
 candidate.clue_kind='event';candidate.clue='據報導，這種航空器已完成部署。（3字）';
 assert(!validateClue(candidate,event).checks.find(c=>c.id==='C05').pass);
 candidate.clue='據報導，預計採購的遙控航空器。（3字）';
 assert(validateClue(candidate,event).checks.find(c=>c.id==='C05').pass);
});
test('known static definitions still need literal source evidence and the correct length',()=>{
 const p=pair();p.candidate.clue=p.candidate.clue.replace('2字','3字');
 assert(!validateClue(p.candidate,p.event).checks.find(c=>c.id==='C03').pass);
 const missing=pair();missing.candidate.source_support=[];
 assert(!validateClue(missing.candidate,missing.event).checks.find(c=>c.id==='C06').pass);
});
test('a forged concise style cannot hide a full answer leak',()=>{
 const {candidate,event}=pair();candidate.clue='國名，日本的首都是東京。（2字）';
 const r=validateClue(candidate,event);assert(!r.passed);
 assert(!r.checks.find(c=>c.id==='C01').pass);assert(!r.checks.find(c=>c.id==='C05').pass);
});
