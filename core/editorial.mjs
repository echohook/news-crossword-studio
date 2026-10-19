import {experiencedDefinition,experiencedEventBody,EXPERIENCED_PROFILE} from './experienced-definitions.mjs';
import {isGeographicWord} from './definitions.mjs';
export {EXPERIENCED_PROFILE};
const normalize=s=>(s??'').normalize('NFKC').replace(/[\p{P}\p{Z}\p{Cf}\s]/gu,'');
const body=c=>(c.clue??'').replace(/[（(][^）)]*字[）)]\s*$/u,'').trim();
const institution=new Set('央行 國防部 外交部 海巡署 立法院 北約 安理會 聯合國 歐盟'.split(' '));
export function editorialFacts(c){
 const geo=isGeographicWord(c.word)||['國家或地區','地名'].includes(c.kind);
 const idiom=c.content_kind==='idiom';
 const definition=experiencedDefinition(c.word);
 const context=experiencedEventBody(c.event,c);
 const contextual=c.clue_profile===EXPERIENCED_PROFILE&&c.clue_kind==='event'&&!!context&&normalize(body(c))===normalize(context);
 const applied=!idiom&&c.clue_profile===EXPERIENCED_PROFILE&&c.clue_kind==='meaning'&&!!definition&&normalize(body(c))===normalize(definition.body);
 const idiomQualified=idiom&&c.clue_profile===EXPERIENCED_PROFILE&&!!definition&&normalize(body(c))===normalize(definition.body);
 const agency=institution.has(c.word)||c.kind==='機關或組織';
 const named=geo||agency||['企業','人物'].includes(c.kind);
 const category=c.event?.categories?.[0];
 const domain=geo?'geography':idiom?'culture':definition?.domain??({'台灣':'politics','國際':'international','財經':'economy','科技':'technology','生活':'society','體育':'sports','文化':'culture'}[category]??'society');
 return {word:c.word,domain,idiom,geographic:geo,named_entity:named,institution:agency,applied,contextual,qualified:idiomQualified||applied||contextual};
}
export function editorialLimits(target=12){
 return {idioms:2,geography:Math.max(1,Math.floor(target/6)),domain:Math.max(2,Math.ceil(target/3)),named:Math.max(2,Math.ceil(target/3)),institutions:Math.max(1,Math.floor(target/6)),domains:Math.min(4,Math.ceil(target/3)),applied:Math.ceil(target/2),contextual:Math.min(2,Math.floor(target/4))};
}
export function editorialSummary(candidates){
 const facts=candidates.map(editorialFacts),domains={};
 for(const f of facts)domains[f.domain]=(domains[f.domain]??0)+1;
 return {domains,idioms:facts.filter(f=>f.idiom).length,geography:facts.filter(f=>f.geographic).length,named:facts.filter(f=>f.named_entity).length,institutions:facts.filter(f=>f.institution).length,applied:facts.filter(f=>f.applied).length,contextual:facts.filter(f=>f.contextual).length,unqualified:facts.filter(f=>!f.qualified).map(f=>f.word),facts};
}
/** Admission uses upper bounds and remaining seats; final audit is independent of geometry. */
export function editorialAdmission(existing,target,profile){
 if(!profile)return ()=>true;
 const cache=new WeakMap(),fact=c=>{if(!cache.has(c))cache.set(c,editorialFacts(c));return cache.get(c);};
 const start=editorialSummary(existing),l=editorialLimits(target),clues=existing.map(c=>normalize(c.clue)),words=existing.map(c=>normalize(c.word));
 return added=>{
  const all=added.map(fact);if(all.some(f=>!f.qualified))return false;
  for(const c of added)if(clues.some(x=>x.includes(normalize(c.word)))||words.some(w=>normalize(c.clue).includes(w)))return false;
  if(added.length===2&&(normalize(added[0].clue).includes(normalize(added[1].word))||normalize(added[1].clue).includes(normalize(added[0].word))))return false;
  const domains={...start.domains};for(const f of all)domains[f.domain]=(domains[f.domain]??0)+1;
  const seats=target-existing.length-added.length;
  return start.idioms+all.filter(f=>f.idiom).length<=l.idioms&&start.geography+all.filter(f=>f.geographic).length<=l.geography&&start.named+all.filter(f=>f.named_entity).length<=l.named&&start.institutions+all.filter(f=>f.institution).length<=l.institutions&&Object.values(domains).every(n=>n<=l.domain)&&Object.keys(domains).length+seats>=l.domains&&start.applied+all.filter(f=>f.applied).length+seats>=l.applied&&start.contextual+all.filter(f=>f.contextual).length+seats>=l.contextual;
 };
}
export function canAddEditorial(existing,added,target,profile){
 if(!profile)return true;
 return editorialAdmission(existing,target,profile)(added);
}
export function validateEditorialSelection(candidates,{profile=EXPERIENCED_PROFILE,target=candidates.length}={}){
 if(profile!==EXPERIENCED_PROFILE)throw Error('未知選題規格');
 const s=editorialSummary(candidates),l=editorialLimits(target);
 const checks=[
  {id:'Q01',pass:!s.unqualified.length&&s.idioms<=l.idioms,label:'排除基礎百科線索',details:s.unqualified},
  {id:'Q02',pass:s.geography<=l.geography,label:'國名地名合計不超過 '+l.geography+' 題'},
  {id:'Q03',pass:Object.keys(s.domains).length>=l.domains&&Object.values(s.domains).every(n=>n<=l.domain),label:'至少 '+l.domains+' 類且單類不超過 '+l.domain+' 題'},
  {id:'Q04',pass:s.named<=l.named&&s.institutions<=l.institutions,label:'限制專名與機關集中'},
  {id:'Q05',pass:s.applied>=l.applied,label:'至少 '+l.applied+' 題應用詞義'},
  {id:'Q06',pass:s.contextual>=l.contextual,label:'至少 '+l.contextual+' 題近期事件線索'}
 ];
 return {profile,valid:checks.every(c=>c.pass),checks,limits:l,summary:s};
}
export function editorialReward(existing,added,target,profile){
 if(!profile)return 0;
 const s=editorialSummary(existing),l=editorialLimits(target);
 return added.reduce((score,c)=>{const f=editorialFacts(c);return score+(!s.domains[f.domain]?2:0)+(f.contextual&&s.contextual<l.contextual?3:0)+(f.applied&&s.applied<l.applied?1:0);},0)/added.length;
}
