import {definitionBody} from '../core/definitions.mjs';
import {naturalClueOptions,CLUE_STYLE,normalized} from './clues.mjs';
import {clueKey} from '../core/edition-policy.mjs';
import {hasGolfContext,golfTermAllowed,golfNewsText} from './golf.mjs';
import {XMLParser} from 'fast-xml-parser';
import {createHash} from 'node:crypto';
import {SOURCES} from './sources.mjs';
import {LEXICON} from './lexicon.mjs';
import {newsWindow,collectEvents,generateCandidates} from '../core/news.mjs';
import {validateClue} from '../core/clues.mjs';
const MAX_BYTES=1024*1024;
const entertainment=/藝人|影帝|影后|演唱會|金馬|金鐘|金曲|綜藝|偶像|票房|粉絲|娛樂|戲劇|電影|歌手|男星|女星|實境秀/u;
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,20);
export const taipeiDate=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function articleUrl(raw){
 try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname==='www.cna.com.tw'&&!u.username&&!u.password&&/^\/news\/a[a-z]+\/\d{12}\.aspx$/.test(u.pathname)&&!u.pathname.startsWith('/news/amov/')?u.origin+u.pathname:null;}catch{return null;}
}
const plain=s=>typeof s==='string'?s.replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f\u007f]/g,' ').trim():'';
export function parseFeed(xml,source,{now=new Date()}={}){
 if(typeof xml!=='string'||Buffer.byteLength(xml)>MAX_BYTES||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('RSS 格式或大小不符');
 const parsed=new XMLParser({ignoreAttributes:false,processEntities:true,trimValues:true}).parse(xml);
 if(!parsed?.rss?.channel||typeof parsed.rss.channel!=='object')throw Error('來源未回傳 RSS 新聞');
 const items=parsed.rss.channel.item??[], window=newsWindow(taipeiDate(now)), events=[];
 for(const item of Array.isArray(items)?items:[items]){
  const title=plain(item?.title),url=articleUrl(item?.link),pub=new Date(item?.pubDate);
  if(!url||!title||Array.from(title).length>160||entertainment.test(title)||!Number.isFinite(pub.getTime())||pub>now)continue;
  const date=taipeiDate(pub);if(date<window.from||date>window.to)continue;
  const rawLead=plain(item?.description),lead=rawLead.length<=1200&&hasGolfContext({title,rss_lead:rawLead})?rawLead:'';
  if(lead&&entertainment.test(lead))continue;
  const excerpt=lead?title+'\n'+lead:title;
  const id='cna-'+hash(url),sid='rss-'+hash(url+excerpt);
  events.push({event_id:id,dedup_key:url,event_date:date,updated_at:date,published_at:pub.toISOString(),title,
   rss_lead:lead,summary:title,categories:[source.category],fact_status:'reported',content_type:'news',event_score:80,anchor_event:false,
   sources:[{source_id:sid,publisher:source.publisher,kind:'newswire',url,published_at:date,excerpt,section:source.category}]});
 }
 return events;
}
export function buildBank(feedResults,{now=new Date(),previous,idioms=[],lexicon=LEXICON}={}){
 const issue=taipeiDate(now),window=newsWindow(issue),map=new Map();
 const successful=feedResults.filter(r=>!r.error),fresh=successful.flatMap(r=>r.events??[]);
 if(!successful.length||!fresh.length)throw Error('本次沒有取得七天內的新聞；保留上一批題庫。');
 for(const e of previous?.news?.events??[]){
  if(e.event_date>=window.from&&e.event_date<=window.to&&e.published_at&&new Date(e.published_at)<=now&&articleUrl(e.sources?.[0]?.url)&&!entertainment.test(e.title))map.set(e.dedup_key??e.sources[0].url,structuredClone(e));
 }
 for(const e of fresh)map.set(e.dedup_key,e);
 const ordered=[...map.values()].sort((a,b)=>b.published_at.localeCompare(a.published_at)||a.event_id.localeCompare(b.event_id));
 // Keep up to 24 recent golf stories before filling the shared limit with other topics.
 const retainedGolf=ordered.filter(hasGolfContext).slice(0,24),selected=new Map(retainedGolf.map(e=>[e.event_id,e]));
 for(const e of ordered){if(selected.size>=180)break;selected.set(e.event_id,e);}
 const events=[...selected.values()].sort((a,b)=>b.published_at.localeCompare(a.published_at)||a.event_id.localeCompare(b.event_id));
 for(const e of events){const content=golfNewsText(e);e.keywords=lexicon.filter(a=>content.includes(a.word)&&golfTermAllowed(a,e)&&
  !lexicon.some(b=>b.word.length>a.word.length&&b.word.includes(a.word)&&content.includes(b.word)&&golfTermAllowed(b,e))&&
  !(a.word==='鳳梨'&&e.title.includes('鳳梨釋迦'))&&
  !(a.word==='運動'&&/青年運動|學生運動|社會運動|革命運動|工人運動|政治運動/u.test(e.title))).map(a=>({
  word:a.word,...(a.topic?{topic:a.topic}:{}),...(a.term_reference?{term_reference:a.term_reference}:{}),clue_options:naturalClueOptions(e,a),answer_score:80+Array.from(a.word).length*3,difficulty:'easy'
 })).filter(a=>a.clue_options.length).map(a=>({...a,clue:a.clue_options[0].clue}));}
 const collected=collectEvents(events,{issueDate:issue}),eventMap=new Map(collected.accepted.map(e=>[e.event_id,e])),seen=new Set(),usedClues=new Set(),candidates=[];
 const proposed=generateCandidates(collected.accepted).sort((a,b)=>eventMap.get(b.event_id).published_at.localeCompare(eventMap.get(a.event_id).published_at)||b.answer_score-a.answer_score||a.id.localeCompare(b.id));
 for(const c of proposed){
  if(seen.has(c.word)||candidates.length>=500)continue;
  for(const option of c.clue_options??[]){
   const candidate={...c,...option};delete candidate.clue_options;
   const clueText=normalized(candidate.clue);
   if(usedClues.has(clueKey(candidate.clue))||candidates.some(old=>clueText.includes(normalized(old.word))||normalized(old.clue).includes(normalized(c.word))))continue;
   if(!validateClue(candidate,eventMap.get(c.event_id)).passed)continue;
   candidates.push(candidate);seen.add(c.word);usedClues.add(clueKey(candidate.clue));break;
  }
 }
if(candidates.length<2||!candidates.some(c=>fresh.some(e=>e.event_id===c.event_id)))throw Error('本次沒有取得足夠合格的新題目；保留上一批題庫。');
 const styledIdioms=structuredClone(idioms).map(c=>{const body=definitionBody(c.word);return body?{...c,clue:body+'（4字）',clue_style:CLUE_STYLE,clue_kind:'meaning',
  ...(c.word==='半途而廢'?{knowledge_source:{...c.knowledge_source,publisher:'教育部《成語典》',url:'https://dict.idioms.moe.edu.tw/idiomView.jsp?ID=152&webMd=1'}}:{})}:c;});
 return {news:{issue_date:issue,dataset_mode:'news',events:collected.accepted,candidates},idioms:styledIdioms,mix:{news:8,idiom:4},
  automation:{enabled:true,updated_at:now.toISOString(),window,interval_hours:6,source_count:successful.length,candidate_count:candidates.length,
   sources:feedResults.map(r=>({id:r.source.id,publisher:r.source.publisher,category:r.source.category,url:r.source.url,count:r.events?.length??0,error:r.error??null})),
   clue_style:CLUE_STYLE,status:successful.length===feedResults.length?'UPDATED':'PARTIAL',method:'RSS 新聞來源核對；精簡敘述、詞義與比喻線索；不擷取全文或圖片'}};
}
export async function fetchFeeds({sources=SOURCES,fetchImpl=fetch,now=new Date()}={}){
 return Promise.all(sources.map(async source=>{
  try{
   const response=await fetchImpl(source.url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'NewsCrosswordStudio/1.9 (+https://echohook.github.io/news-crossword-studio/)'}});
   if(!response.ok)throw Error('HTTP '+response.status);
   const reader=response.body?.getReader();let xml='';
   if(reader){const decoder=new TextDecoder();let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error('RSS 超出大小上限');}xml+=decoder.decode(value,{stream:true});}xml+=decoder.decode();}
   else xml=await response.text();
   return {source,events:parseFeed(xml,source,{now})};
  }catch(e){return {source,events:[],error:String(e.message).slice(0,120)};}
 }));
}
