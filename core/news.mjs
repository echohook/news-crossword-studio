import {assessNewsScope} from './news-policy.mjs';
/** Deterministic intake of structured news snapshots; never declares truth from a URL. */
export const EVENT_WEIGHTS={public_impact:25,taiwan_or_global:20,visibility:15,senior_recognition:15,weekly_value:15,diversity:10};
export const ANSWER_WEIGHTS={natural:25,unique_clue:25,familiarity:20,representation:15,length:10,taiwan_usage:5};
export const text=value=>typeof value==='string'&&value.trim().length>0;
const dayMs=86400000;
export function dateDay(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d=new Date(value+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?d.getTime():null;
}
export function newsWindow(issueDate) {
  const end=dateDay(issueDate);
  if(end===null) throw new Error('issue_date 必須是有效 YYYY-MM-DD 日期');
  return {from:new Date(end-6*dayMs).toISOString().slice(0,10),to:issueDate};
}
export function scoreValue(item,key,weights) {
  const components=item?.score_components;
  let computed;
  if(components!==undefined) {
    if(!components||typeof components!=='object'||Array.isArray(components)) return {error:'score_components 格式錯誤'};
    if(Object.keys(components).some(k=>!Object.hasOwn(weights,k))) return {error:'score_components 有未知欄位'};
    for(const [k,max] of Object.entries(weights)) if(typeof components[k]!=='number'||!Number.isFinite(components[k])||components[k]<0||components[k]>max) return {error:k+' 分數需為 0～'+max};
    computed=Object.values(components).reduce((sum,n)=>sum+n,0);
  }
  const value=item?.[key]??computed;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100) return {error:key+' 需為 0～100 分數或完整 score_components'};
  if(computed!==undefined&&item[key]!==undefined&&Math.abs(value-computed)>1e-8) return {error:key+' 與 score_components 總和不一致'};
  return {value};
}
export function sourceUrl(value) {
  try {
    const u=new URL(value);
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password) return null;
    u.hash='';
    for(const key of [...u.searchParams.keys()]) if(key.startsWith('utm_')) u.searchParams.delete(key);
    return u.href;
  } catch {return null;}
}
function sourceValid(s,window,fixture) {
  const published=dateDay(s?.published_at);
  return s && text(s.source_id) && text(s.publisher) && sourceUrl(s.url) && text(s.excerpt) &&
    ['official','newswire','newsroom',...(fixture?['fixture']:[])].includes(s.kind) &&
    published!==null && published>=dateDay(window.from) && published<=dateDay(window.to);
}
/** Explicit dedup_key groups a single event; semantic clustering belongs to an upstream adapter. */
export function collectEvents(events,{issueDate,fixture=false}={}) {
  if(!Array.isArray(events)) throw new Error('events 必須是陣列');
  const window=newsWindow(issueDate), groups=new Map(), inputIds=new Set();
  for(const e of events) {
    if(!e||typeof e!=='object'||Array.isArray(e)||!text(e.event_id)) throw new Error('每個事件必須有 event_id');
    if(inputIds.has(e.event_id)) throw new Error('event_id 重複；不同資料版本請給唯一 event_id 與相同 dedup_key');
    inputIds.add(e.event_id);
    if(e.dedup_key!==undefined&&!text(e.dedup_key)) throw new Error('dedup_key 必須是非空文字');
    const key=e.dedup_key??e.event_id;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(e);
  }
  const aliases=new Map(), reports=[], accepted=[];
  for(const [dedupKey,versions] of [...groups.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0)) {
    const ids=versions.map(e=>e.event_id).sort(),id=ids[0];
    ids.forEach(alias=>aliases.set(alias,id));
    const ordered=[...versions].sort((a,b)=>
      (dateDay(b.updated_at??b.event_date)??-Infinity)-(dateDay(a.updated_at??a.event_date)??-Infinity) ||
      (a.event_id<b.event_id?-1:a.event_id>b.event_id?1:0));
    const current=ordered[0], sourceMap=new Map(), sourceConflicts=[];
    let sourceWithoutId=0;
    for(const version of ordered) {
      for(const s of Array.isArray(version.sources)?version.sources:[]) {
        if(!s || !text(s.source_id)){sourceWithoutId++;continue;}
        if(sourceMap.has(s.source_id)) {
          const old=sourceMap.get(s.source_id);
          if(sourceUrl(old.url)!==sourceUrl(s.url)||old.excerpt!==s.excerpt||old.publisher!==s.publisher||old.kind!==s.kind||old.published_at!==s.published_at) sourceConflicts.push(s.source_id);
        } else sourceMap.set(s.source_id,s);
      }
    }
    const validSources=[...sourceMap.values()].filter(s=>sourceValid(s,window,fixture)).map(s=>({...s,url:sourceUrl(s.url)}));
    const score=scoreValue(current,'event_score',EVENT_WEIGHTS);
    const date=dateDay(current.event_date),updated=dateDay(current.updated_at??current.event_date);
    const scope=assessNewsScope({...current,sources:validSources});
    const checks=[
      {id:'E01',pass:date!==null&&date>=dateDay(window.from)&&date<=dateDay(window.to)&&updated!==null&&updated<=dateDay(window.to)&&updated>=date,
        message:'事件與更新日期必須有效、在本期七天內且不在未來'},
      {id:'E02',pass:validSources.length>0&&sourceConflicts.length===0,message:'至少一筆本期、有識別碼、發布者、網址及摘錄的來源；同來源 ID 不可衝突'},
      {id:'E03',pass:['confirmed','announced','planned','considering','reported'].includes(current.fact_status)&&!['opinion','rumor','advertorial'].includes(current.content_type),
        message:'排除未證實消息、意見文章與未知 fact_status'},
      {id:'E04',pass:!score.error&&score.value>=60,message:score.error??'Event Score 至少 60'},
      {id:'E05',pass:text(current.title)&&text(current.summary)&&Array.isArray(current.categories)&&current.categories.length>0&&Array.from(current.categories).every(text),
        message:'需有標題、摘要與分類'},
      {id:'E06',pass:scope.allowed,message:'排除娛樂新聞，混合分類及重點事件也不例外',details:[...scope.signals,...scope.errors]}
    ];
    const event={...current,event_id:id,dedup_key:dedupKey,aliases:ids,
      sources:validSources,event_score:score.value??null,content_revision:current.event_id};
    const passed=checks.every(c=>c.pass);
    reports.push({event_id:id,aliases:ids,dedup_key:dedupKey,selected_revision:current.event_id,passed,checks,
      news_scope:scope,discarded_source_count:sourceWithoutId+sourceMap.size-validSources.length,source_conflicts:[...new Set(sourceConflicts)]});
    if(passed)accepted.push(event);
  }
  return {window,accepted,reports,aliases,inputCount:events.length,eventCount:groups.size};
}

/** Assemble annotated keywords, append length hints, and attach literal source excerpts.
 * This is a local CandidateGenerator adapter, not language-model extraction.
 */
export function generateCandidates(events) {
  const candidates=[];
  for(const event of events) {
    if(!Array.isArray(event.keywords))continue;
    for(const k of event.keywords) {
      if(!k||typeof k!=='object'||Array.isArray(k))continue;
      const word=k.word,length=typeof word==='string'?Array.from(word).length:0;
      let clue=k.clue??k.clue_draft??'';
      if(typeof clue==='string'&&clue.trim()&&!/[（(][^）)]*字[）)]\s*$/.test(clue)) clue+='（'+length+'字）';
      const support=k.source_support??event.sources.filter(s=>typeof word==='string'&&s.excerpt.includes(word)).map(s=>{
        const evidence=s.excerpt.split(/(?<=[。！？])/).find(line=>line.includes(word))?.trim()??s.excerpt;
        return {source_id:s.source_id,evidence};
      });
      candidates.push({...k,id:k.id??event.event_id+'::'+(word??''),word,event_id:event.event_id,event_revision:event.content_revision,clue,source_support:support});
    }
  }
  return candidates;
}