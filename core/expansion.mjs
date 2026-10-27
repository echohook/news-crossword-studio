import {EXPERIENCED_DEFINITIONS,EXPERIENCED_PROFILE} from './experienced-definitions.mjs';
import {EXPANSION_DEFINITIONS,EXPANSION_IDIOMS,WORD_REFERENCES} from './expansion-definitions.mjs';
import {assessNewsScope} from './news-policy.mjs';
const normalize=s=>(s??'').normalize('NFKC').replace(/[\p{P}\p{Z}\p{Cf}\s]/gu,'');
const catalogUrl='https://github.com/echohook/news-crossword-studio/blob/main/core/experienced-definitions.mjs';
const topics=[
 {id:'weather',pattern:/颱風|風災|防災|豪雨|洪水|強降雨/u,anchor:/颱風|風災|防災|豪雨|洪水|強降雨/u,words:'風災 災難 豪雨 暴風圈 颱風眼 土石流 滯洪池 防波堤 堤防 洪水 氣壓 季風 雨量 疏散 撤離 重建 避難所 防災 救災 災損 風險 風聲鶴唳 風起雲湧 未雨綢繆 同舟共濟 臨危不亂 雨過天晴 防患未然 雪中送炭 居安思危'.split(' ')},
 {id:'policy',pattern:/政策|改革|協商|預算/u,anchor:/政策|改革|協商|預算/u,words:'集思廣益 因地制宜 高瞻遠矚 見微知著'.split(' ')},
 {id:'economy',pattern:/投資|股市|金融|產業/u,anchor:/投資|股市|金融|產業/u,words:'風險 見微知著 水到渠成 一葉知秋 管中窺豹 柳暗花明'.split(' ')}
];
export function namedTyphoons(event){
 const text=event?.title??'',words=new Set(),bad=new Set('強烈 中度 輕度 海上 陸上 熱帶 形成 今年 防範'.split(' '));
 for(const m of text.matchAll(/颱風[「『]([\p{Script=Han}]{2,4})[」』]|颱風([\p{Script=Han}]{2})(?=[^\p{Script=Han}]|估|升|將|今|接|來|減|北|持|逼)|([\p{Script=Han}]{2})颱風/gu)){
  const word=m[1]??m[2]??m[3];if(!bad.has(word))words.add(word);
 }
 return [...words];
}
export function typhoonNameClue(event,word){
 if(!namedTyphoons(event).includes(word))return null;
 const title=event.title.replaceAll('颱風「'+word+'」','某颱風').replaceAll('颱風『'+word+'』','某颱風').replaceAll(word+'颱風','某颱風').replaceAll('颱風'+word,'某颱風').replaceAll(word,'某颱風');
 const body='颱風名，據報導，'+title+'。';
 return Array.from(body+'（'+word.length+'字）').length<=60?body:null;
}
export function knowledgeSource(word){
 const definition=EXPERIENCED_DEFINITIONS[word];if(!definition)return null;
 return {publisher:WORD_REFERENCES[word]?'教育部辭典（線索另撰）':'時事填字樂詞義編輯庫',url:WORD_REFERENCES[word]??(EXPANSION_DEFINITIONS[word]?catalogUrl.replace('experienced-definitions','expansion-definitions'):catalogUrl),meaning:definition.body};
}
/** Linkage is not a claim that the derived answer occurred in news. */
export function validateKnowledge(candidate,event){
 const def=EXPERIENCED_DEFINITIONS[candidate?.word],source=knowledgeSource(candidate?.word),r=candidate?.expansion;
 if(!def||!source||!r||!event||!assessNewsScope(event).allowed||candidate.content_kind!=='knowledge'||candidate.clue_profile!==EXPERIENCED_PROFILE||candidate.clue_kind!=='meaning'||candidate.clue_style!=='magazine-v1')return false;
 if(normalize(candidate.clue.replace(/[（(][^）)]*字[）)]\s*$/u,''))!==normalize(def.body)||JSON.stringify(candidate.knowledge_source)!==JSON.stringify(source))return false;
 const s=event.sources?.find(s=>s.source_id===r.source_id);
 if(!s||typeof r.seed_word!=='string'||!r.seed_word||!s.excerpt?.includes(r.seed_word))return false;
 if(r.method==='shared_character'){
  if(!Array.isArray(r.path)||r.path.length<1||r.path.length>2)return false;
  let from=r.seed_word;
  for(const hop of r.path){if(hop.from!==from||!EXPERIENCED_DEFINITIONS[hop.to]||hop.to===from||typeof hop.character!=='string'||Array.from(hop.character).length!==1||!from.includes(hop.character)||!hop.to.includes(hop.character))return false;from=hop.to;}
  return from===candidate.word;
 }
 const rule=topics.find(x=>x.id===r.rule_id);
 return r.method==='topic'&&!!rule&&rule.words.includes(candidate.word)&&rule.anchor.test(r.seed_word);
}
export function expandCandidates(events,candidates,{limit=500}={}){
 const existing=new Set(candidates.map(c=>c.word)),knowledge=[],idioms=[],links=new Map();
 const eligible=events.filter(e=>assessNewsScope(e).allowed);
 // Literal news words are roots; at most two character hops, with no unbounded recursion.
 for(const c of candidates){const event=eligible.find(e=>e.event_id===c.event_id),source=event?.sources?.find(s=>s.excerpt?.includes(c.word));if(!source)continue;
  for(const word of Object.keys(EXPERIENCED_DEFINITIONS)){if(existing.has(word)||links.has(word))continue;const shared=Array.from(word).find(ch=>c.word.includes(ch));if(shared)links.set(word,{event,expansion:{method:'shared_character',seed_word:c.word,shared_character:shared,path:[{from:c.word,to:word,character:shared}],source_id:source.source_id}});}
 }
 // One further character hop supplies partners for newly found words, with a traceable root.
 for(const [seed,{event,expansion}] of [...links])for(const word of Object.keys(EXPERIENCED_DEFINITIONS)){
  if(existing.has(word)||links.has(word))continue;
  const shared=Array.from(word).find(ch=>seed.includes(ch));if(shared)links.set(word,{event,expansion:{...expansion,path:[...expansion.path,{from:seed,to:word,character:shared}]}});
 }
 for(const event of eligible)for(const rule of topics){const source=event.sources?.find(s=>rule.pattern.test(s.excerpt??''));if(!source)continue;const seed=source.excerpt.match(rule.anchor)?.[0];if(!seed)continue;for(const word of rule.words)if(!existing.has(word)&&!links.has(word))links.set(word,{event,expansion:{method:'topic',rule_id:rule.id,seed_word:seed,source_id:source.source_id}});}
 for(const [word,{event,expansion}] of links){
  if(candidates.length+knowledge.length>=limit)break;
  const def=EXPERIENCED_DEFINITIONS[word];if(!def)continue;
  const idiom=EXPANSION_IDIOMS.has(word),id=(idiom?'idiom:':'knowledge:')+word;
  const c={id,event_id:idiom?id:event.event_id,word,content_kind:idiom?'idiom':'knowledge',kind:idiom?'成語':'延伸知識',answer_domain:def.domain,difficulty:'medium',answer_score:84,
   clue:def.body+'（'+word.length+'字）',clue_style:'magazine-v1',clue_kind:'meaning',clue_profile:EXPERIENCED_PROFILE,knowledge_source:knowledgeSource(word),
   ...(idiom?{related_news:{event_id:event.event_id,...expansion}}:{expansion,source_support:[]})};
  if(!idiom&&!validateKnowledge(c,event))continue;
  (idiom?idioms:knowledge).push(c);
 }
 return {knowledge,idioms};
}
