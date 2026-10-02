export const AUTO_BANK_URL='https://raw.githubusercontent.com/echohook/news-crossword-studio/main/data/auto-news.json';
export const currentDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function currentBank(raw,{now=new Date()}={}){
 if(!raw?.automation?.enabled||!Array.isArray(raw.news?.events)||!Array.isArray(raw.news?.candidates)||!Array.isArray(raw.idioms)||raw.news.events.length>200||raw.news.candidates.length>500||raw.idioms.length>300)throw Error('自動題庫格式不符');
 const updated=new Date(raw.automation.updated_at),day=currentDay(now);
 if(!Number.isFinite(updated.getTime())||updated.getTime()>now.getTime()+900000||raw.news.issue_date>day)throw Error('自動題庫日期不符');
 const p=structuredClone(raw),from=new Date(Date.parse(day+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
 p.news.issue_date=day;
 p.news.events=p.news.events.filter(e=>e.event_date>=from&&e.event_date<=day&&(e.sources??[]).some(s=>s.published_at>=from&&s.published_at<=day));
 const ids=new Set(p.news.events.map(e=>e.event_id));p.news.candidates=p.news.candidates.filter(c=>ids.has(c.event_id));
 p.automation.window={from,to:day};p.automation.stale=now-updated>18*3600000;p.automation.candidate_count=p.news.candidates.length;
 return p;
}
export async function loadAutoBank({fallback,fetchImpl=fetch,now=new Date()}={}){
 try{
  const r=await fetchImpl(AUTO_BANK_URL+'?t='+now.getTime(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('HTTP '+r.status);
  const text=await r.text();if(text.length>2*1024*1024)throw Error('題庫檔過大');
  const remote=currentBank(JSON.parse(text),{now});
  if(fallback?.automation?.updated_at>remote.automation.updated_at)return {packet:currentBank(fallback,{now}),connection:'BUNDLED'};
  return {packet:remote,connection:'ONLINE'};
 }catch(error){
  return {packet:currentBank(fallback,{now}),connection:'OFFLINE',error:'連線未完成，使用網站內附的最近一次題庫'};
 }
}
