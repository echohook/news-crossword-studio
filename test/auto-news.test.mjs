import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseFeed,buildBank,fetchFeeds,taipeiDate,articleUrl} from '../news/collector.mjs';
import {SOURCES} from '../news/sources.mjs';
import {LEXICON} from '../news/lexicon.mjs';
import {validateClue} from '../core/clues.mjs';
import {preparePacket} from '../src/worker.mjs';
import {currentBank,loadAutoBank} from '../src/auto-bank.mjs';
import {updateNews} from '../scripts/update-news.mjs';
const now=new Date('2026-10-02T10:00:00Z'),source=SOURCES[0];
const item=(title,id='202610020001',date='Fri, 02 Oct 2026 09:00:00 +0800',path='aipl')=>'<item><title><![CDATA['+title+']]></title><link>https://www.cna.com.tw/news/'+path+'/'+id+'.aspx</link><pubDate>'+date+'</pubDate></item>';
const rss=items=>'<rss version="2.0"><channel><title>新聞</title>'+items+'</channel></rss>';
const xml=rss(item('美國日本商討關稅政策')+item('行政院公布最低工資政策','202610020002'));
const result=()=>({source,events:parseFeed(xml,source,{now})});
const bank=()=>buildBank([result()],{now});
test('Taipei date crosses midnight independently of runner timezone',()=>{
 assert.equal(taipeiDate(new Date('2026-10-01T16:01:00Z')),'2026-10-02');
});
test('RSS intake excludes entertainment, stale news and future timestamps',()=>{
 const events=parseFeed(rss(item('美國演唱會門票')+item('日本電影票房','202610020003')+item('韓國關稅','202609250001','Fri, 25 Sep 2026 09:00:00 +0800')+item('日本關稅','202610030001','Sat, 03 Oct 2026 09:00:00 +0800')+item('美國政策','202610020004','Fri, 02 Oct 2026 23:00:00 +0800')+item('日本關稅','202610020005','Fri, 02 Oct 2026 09:00:00 +0800','amov')+item('美國日本關稅','202610020006')),{...source},{now});
 assert.equal(events.length,1);assert.equal(events[0].event_date,'2026-10-02');
});
test('RSS rejects document entities, malformed roots and oversized input',()=>{
 assert.throws(()=>parseFeed('<!DOCTYPE x [<!ENTITY a "x">]><rss/>',source,{now}));
 assert.throws(()=>parseFeed('<html>error</html>',source,{now}));
 assert.throws(()=>parseFeed('x'.repeat(1024*1024+1),source,{now}));
});
test('article links stay on the actual HTTPS news host',()=>{
 assert.equal(articleUrl('https://www.cna.com.tw.evil.example/news/aipl/202610020001.aspx'),null);
 assert.equal(articleUrl('https://user@www.cna.com.tw/news/aipl/202610020001.aspx'),null);
 assert.equal(articleUrl('http://www.cna.com.tw/news/aipl/202610020001.aspx'),null);
 assert.equal(articleUrl('https://www.cna.com.tw/news/aipl/202610020001.aspx?utm_source=x'),'https://www.cna.com.tw/news/aipl/202610020001.aspx');
});
test('automatic candidates are unique, literal, non-leaking and accepted by all clue checks',()=>{
 const p=bank();preparePacket(p);assert(p.news.candidates.length>=3);
 assert.equal(new Set(p.news.candidates.map(c=>c.word)).size,p.news.candidates.length);
 for(const c of p.news.candidates){
  const e=p.news.events.find(e=>e.event_id===c.event_id);assert(e.title.includes(c.word));
  assert(validateClue(c,e).passed);assert(c.clue.includes('○'));
  assert(!LEXICON.some(a=>c.clue.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'').includes(a.word)));
 }
});
test('longer phrases prevent short-word miscuts and social movement is not sports',()=>{
 const r={source,events:parseFeed(rss(item('美國最低工資調升　青年運動關注鳳梨釋迦')+item('日本關稅公告','202610020004')),source,{now})};
 const words=buildBank([r],{now}).news.candidates.map(c=>c.word);
 assert(words.includes('最低工資'));assert(!words.includes('工資'));assert(!words.includes('運動'));assert(!words.includes('鳳梨'));
});
test('partial source failure preserves remaining sources and deduplicates article URLs',()=>{
 const p=buildBank([result(),{...result(),source:SOURCES[1]},{source:SOURCES[2],error:'HTTP 503'}],{now});
 assert.equal(p.automation.status,'PARTIAL');assert.equal(p.news.events.length,2);assert.equal(p.automation.sources[2].error,'HTTP 503');
});
test('seven-day retained news expires and updated titles replace former versions',()=>{
 const old=bank(),later=new Date('2026-10-10T10:00:00Z'),newXml=rss(item('美國日本關稅政策','202610100001','Sat, 10 Oct 2026 09:00:00 +0800'));
 const p=buildBank([{source,events:parseFeed(newXml,source,{now:later})}],{now:later,previous:old});
 assert(p.news.events.every(e=>e.event_date==='2026-10-10'));assert(!p.news.candidates.some(c=>c.word==='最低工資'));
 const edited=buildBank([{source,events:parseFeed(rss(item('美國日本公布不同關稅')),source,{now})}],{now,previous:old});
 assert.equal(edited.news.events.filter(e=>e.dedup_key.endsWith('202610020001.aspx')).length,1);
 assert(edited.news.events.some(e=>e.title==='美國日本公布不同關稅'));
});
test('all failed or empty sources never create a falsely refreshed bank',()=>{
 assert.throws(()=>buildBank([{source,error:'timeout'}],{now,previous:bank()}),/保留/);
 assert.throws(()=>buildBank([{source,events:[]}],{now,previous:bank()}),/保留/);
});
test('fetch isolates source failures and enforces response size and status',async()=>{
 const results=await fetchFeeds({now,sources:SOURCES.slice(0,3),fetchImpl:async url=>{
  if(url.endsWith('politics'))return new Response(xml);
  if(url.endsWith('intworld'))return new Response('error',{status:503});
  return new Response('x'.repeat(1024*1024+1));
 }});
 assert.equal(results[0].events.length,2);assert.match(results[1].error,/503/);assert.match(results[2].error,/大小/);
});
test('a failed updater leaves the durable last-good bank byte-for-byte intact',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'crossword-auto-test-')),path=join(dir,'bank.json'),bytes=JSON.stringify(bank());
 try{await writeFile(path,bytes);await assert.rejects(updateNews({now,destinationPath:path,fetchImpl:async()=>{throw Error('offline');}}));assert.equal(await readFile(path,'utf8'),bytes);}
 finally{await rm(dir,{recursive:true,force:true});}
});
test('browser loads shared bank automatically and network failure uses last good copy',async()=>{
 const p=bank(),online=await loadAutoBank({fallback:p,now,fetchImpl:async()=>new Response(JSON.stringify(p))});
 assert.equal(online.connection,'ONLINE');
 const offline=await loadAutoBank({fallback:p,now,fetchImpl:async()=>{throw Error('offline');}});
 assert.equal(offline.connection,'OFFLINE');assert.deepEqual(offline.packet.news,online.packet.news);
 const newer=bank();newer.automation.updated_at='2026-10-02T10:01:00Z';
 assert.equal((await loadAutoBank({fallback:newer,now:new Date('2026-10-02T10:02:00Z'),fetchImpl:async()=>new Response(JSON.stringify(p))})).connection,'BUNDLED');
});
test('offline browser advances the window and removes expired answers without changing update time',()=>{
 const p=bank(),r=currentBank(p,{now:new Date('2026-10-10T10:00:00Z')});
 assert.equal(r.news.issue_date,'2026-10-10');assert.equal(r.news.candidates.length,0);assert.equal(r.automation.updated_at,p.automation.updated_at);assert(r.automation.stale);
 assert.throws(()=>currentBank(p,{now:new Date('2026-09-30T10:00:00Z')}),/日期/);
});

test('golf headlines admit both natural names without truncation or answer leakage',()=>{
 const sports=SOURCES.find(s=>s.category==='體育');
 for(const word of ['高爾夫','高爾夫球']){
  const events=parseFeed(rss(item('台灣'+word+'賽事落幕　選手爭冠')+item('日本公布關稅政策','202610020009')),sports,{now});
  const p=buildBank([{source:sports,events}],{now});
  const c=p.news.candidates.find(c=>c.word===word);assert(c,'missing '+word);
  const e=p.news.events.find(e=>e.event_id===c.event_id);
  assert(e.categories.includes('體育'));assert(validateClue(c,e).passed);
  assert(c.clue.endsWith('（'+Array.from(word).length+'字）'));
  assert(!c.clue.includes(word));
  if(word==='高爾夫球')assert(!p.news.candidates.some(c=>c.word==='高爾夫'));
 }
});

test('golf-specific terms become sourced, non-leaking 2-4 character candidates',()=>{
 const sports=SOURCES.find(s=>s.category==='體育');
 const words='果嶺 桿弟 球道 球桿 球洞 沙坑 開球 推桿 揮桿 切桿 鐵桿 木桿 長桿 短桿 旗桿 球車 球座 球位 球痕 小鳥 老鷹 柏忌 標準桿 發球台 開球台 挖起桿 球道木 推桿線 果嶺費 桿弟費 練習場 暫定球 雙柏忌 一桿進洞 練習果嶺 開球木桿 美巡賽 萊德盃'.split(' ');
 for(const word of words){
  const title='高球選手'+(['小鳥','老鷹'].includes(word)?'射下一記':'談')+word+'表現　日本比賽登場';
  const events=parseFeed(rss(item(title)+item('美國日本政策會談','202610020099')),sports,{now});
  const p=buildBank([{source:sports,events}],{now}),c=p.news.candidates.find(c=>c.word===word);
  assert(c,'missing '+word);assert.equal(c.topic,'golf');
  const e=p.news.events.find(e=>e.event_id===c.event_id);assert(validateClue(c,e).passed);
  assert(c.source_support.every(s=>s.evidence.includes(word)));
  assert(!c.clue.includes(word));assert(c.clue.endsWith('（'+Array.from(word).length+'字）'));
 }
});
test('non-golf meanings of old eagle, bird, sandpit, opening and fairway are excluded',()=>{
 const sports=SOURCES.find(s=>s.category==='體育');
 const titles=['公園老鷹捕捉小鳥　沙坑整修　球道更新','棒球名人開球　日本隊登場','高球球場保育老鷹及小鳥　美國考察'];
 const p=buildBank([{source:sports,events:parseFeed(rss(titles.map((t,i)=>item(t,'20261002000'+(i+1))).join('')),sports,{now})}],{now});
 for(const word of ['老鷹','小鳥','沙坑','球道','開球'])assert(!p.news.candidates.some(c=>c.word===word),'false match '+word);
});
test('golf terms in publisher RSS lead are admitted with original literal evidence',()=>{
 const sports=SOURCES.find(s=>s.category==='體育'),lead='（中央社記者測試2日電）選手表示桿弟協助判讀果嶺，推桿表現穩定。';
 const golf=item('美巡賽選手分享心得').replace('</item>','<description><![CDATA['+lead+']]></description></item>');
 const events=parseFeed(rss(golf+item('美國日本政策會談','202610020009')),sports,{now});
 const p=buildBank([{source:sports,events}],{now});
 for(const word of ['桿弟','果嶺','推桿']){
  const c=p.news.candidates.find(c=>c.word===word);assert(c,'missing lead '+word);
  const e=p.news.events.find(e=>e.event_id===c.event_id);assert(!e.title.includes(word));assert(e.rss_lead===lead);
  assert(e.sources[0].excerpt.includes(lead));assert(validateClue(c,e).passed);
 }
});
test('RSS leads neither seed golf terms in other topics nor evade entertainment filters',()=>{
 const sports=SOURCES.find(s=>s.category==='體育');
 const ordinary=item('日本棒球隊分享心得').replace('</item>','<description><![CDATA[觀眾看到小鳥，也參觀公園沙坑。]]></description></item>');
 const excluded=item('高球名人演唱會　桿弟陪同','202610020009').replace('</item>','<description><![CDATA[高球果嶺交流。]]></description></item>');
 const events=parseFeed(rss(ordinary+excluded+item('美國日本政策會談','202610020008')),sports,{now});
 assert.equal(events.length,2);assert.equal(events.find(e=>e.title.includes('棒球')).rss_lead,'');
 const p=buildBank([{source:sports,events}],{now});assert(!p.news.candidates.some(c=>c.topic==='golf'));
});

test('older golf stories within seven days survive the 180-event shared cap',()=>{
 const sports=SOURCES.find(s=>s.category==='體育');
 const old=parseFeed(rss(item('高球桿弟協助選手','202610010001','Thu, 01 Oct 2026 09:00:00 +0800')),sports,{now});
 const recent=parseFeed(rss(Array.from({length:181},(_,i)=>item('美國日本政策消息'+i,'20261002'+String(i+1).padStart(4,'0'))).join('')),SOURCES[0],{now});
 const p=buildBank([{source:SOURCES[0],events:recent}],{now,previous:{news:{events:old}}});
 assert.equal(p.news.events.length,180);assert(p.news.events.some(e=>e.title==='高球桿弟協助選手'));
 assert(p.news.candidates.some(c=>c.word==='桿弟'));
});
test('entertainment cues in golf RSS summaries are rejected too',()=>{
 const sports=SOURCES.find(s=>s.category==='體育');
 const golf=item('高球名人活動').replace('</item>','<description><![CDATA[藝人參加演唱會後在果嶺與桿弟交流。]]></description></item>');
 const events=parseFeed(rss(golf+item('美國日本政策消息','202610020009')),sports,{now});
 assert.equal(events.length,1);assert(!events.some(e=>e.title.includes('高球')));
});
