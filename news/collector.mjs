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
  const id='cna-'+hash(url),sid='rss-'+hash(url+title);
  events.push({event_id:id,dedup_key:url,event_date:date,updated_at:date,published_at:pub.toISOString(),title,
   summary:title,categories:[source.category],fact_status:'reported',content_type:'news',event_score:80,anchor_event:false,
   sources:[{source_id:sid,publisher:source.publisher,kind:'newswire',url,published_at:date,excerpt:title,section:source.category}]});
 }
 return events;
}
function clueFor(title,{word,kind},lexicon){
 const chars=Array.from(word);
 // A missing letter hint must distinguish this word from every known word of the same type.
 const options=chars.map((_,i)=>({i,pattern:chars.map((c,j)=>i===j?'○':c).join('')}));
 const choice=options.find(({i})=>!lexicon.some(a=>a.word!==word&&a.kind===kind&&Array.from(a.word).length===chars.length&&Array.from(a.word).every((c,j)=>j===i||c===chars[j])));
 if(!choice)return null;
 const start=title.indexOf(word),prefix=Array.from(title.slice(0,start)).slice(-6).join(''),suffix=Array.from(title.slice(start+word.length)).slice(0,14).join('');
 let context=prefix+word+suffix;
 // Keep the original title as evidence; mask answer words only in the player-facing hint.
 for(const a of [...lexicon].sort((a,b)=>b.word.length-a.word.length)){
  const replacement=a.word===word?choice.pattern:'○'.repeat(Array.from(a.word).length);
  context=context.split(a.word).join(replacement);
 }
 const label=kind.endsWith('用語')?'用語':kind;
 const clue='據報導「'+context+'」，補全'+label+'。（'+chars.length+'字）';
 const normalized=s=>s.normalize('NFKC').replace(/[\p{P}\p{Z}\p{Cf}\s]/gu,'');
 if(Array.from(clue).length>60||lexicon.some(a=>normalized(clue).includes(normalized(a.word))))return null;
 return clue;
}
export function buildBank(feedResults,{now=new Date(),previous,idioms=[],lexicon=LEXICON}={}){
 const issue=taipeiDate(now),window=newsWindow(issue),map=new Map();
 const successful=feedResults.filter(r=>!r.error),fresh=successful.flatMap(r=>r.events??[]);
 if(!successful.length||!fresh.length)throw Error('本次沒有取得七天內的新聞；保留上一批題庫。');
 for(const e of previous?.news?.events??[]){
  if(e.event_date>=window.from&&e.event_date<=window.to&&e.published_at&&new Date(e.published_at)<=now&&articleUrl(e.sources?.[0]?.url)&&!entertainment.test(e.title))map.set(e.dedup_key??e.sources[0].url,structuredClone(e));
 }
 for(const e of fresh)map.set(e.dedup_key,e);
 const events=[...map.values()].sort((a,b)=>b.published_at.localeCompare(a.published_at)||a.event_id.localeCompare(b.event_id)).slice(0,180);
 for(const e of events)e.keywords=lexicon.filter(a=>e.title.includes(a.word)&&
  !lexicon.some(b=>b.word.length>a.word.length&&b.word.includes(a.word)&&e.title.includes(b.word))&&
  !(a.word==='鳳梨'&&e.title.includes('鳳梨釋迦'))&&
  !(a.word==='運動'&&/青年運動|學生運動|社會運動|革命運動|工人運動|政治運動/u.test(e.title))).map(a=>({
  word:a.word,clue:clueFor(e.title,a,lexicon),answer_score:80+Array.from(a.word).length*3,difficulty:'easy'
 })).filter(a=>a.clue);
 const collected=collectEvents(events,{issueDate:issue}),eventMap=new Map(collected.accepted.map(e=>[e.event_id,e])),seen=new Set();
 const candidates=generateCandidates(collected.accepted).sort((a,b)=>eventMap.get(b.event_id).published_at.localeCompare(eventMap.get(a.event_id).published_at)||b.answer_score-a.answer_score||a.id.localeCompare(b.id)).filter(c=>{
  if(seen.has(c.word)||!validateClue(c,eventMap.get(c.event_id)).passed)return false;
  seen.add(c.word);return true;
 }).slice(0,500);
 if(candidates.length<2||!candidates.some(c=>fresh.some(e=>e.event_id===c.event_id)))throw Error('本次沒有取得足夠合格的新題目；保留上一批題庫。');
 return {news:{issue_date:issue,dataset_mode:'news',events:collected.accepted,candidates},idioms:structuredClone(idioms),mix:{news:8,idiom:4},
  automation:{enabled:true,updated_at:now.toISOString(),window,interval_hours:6,source_count:successful.length,candidate_count:candidates.length,
   sources:feedResults.map(r=>({id:r.source.id,publisher:r.source.publisher,category:r.source.category,url:r.source.url,count:r.events?.length??0,error:r.error??null})),
   status:successful.length===feedResults.length?'UPDATED':'PARTIAL',method:'RSS 標題用字擷取與缺字提示；不擷取全文或圖片'}};
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
