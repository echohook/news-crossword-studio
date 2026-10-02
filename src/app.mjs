import {assertPrintableReport} from './pdf.mjs';
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
let packet,report=null,preview=null,mode='player',editionIndex=0,worker,active=false;
let nextId=1;const pending=new Map();
function startWorker(){worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.type==='error'?p.reject(Error(data.message)):p.resolve(data);};worker.onerror=()=>{for(const p of pending.values())p.reject(Error('產題程式未能載入，請重新整理再試。'));pending.clear();};}
function askWorker(data){const id=nextId++;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,...data});});}
export const chineseNumber=n=>n<10?'零一二三四五六七八九'[n]:n===10?'十':'十'+'零一二三四五六七八九'[n-10];
export function displayEntries(sheet){return Object.fromEntries(['H','V'].map(d=>[d,[...sheet.clues[d]].sort((a,b)=>a.row-b.row||a.col-b.col).map((e,i)=>({...e,label:d==='H'?String(i+1):chineseNumber(i+1)}))]));}
function drawWorksheet(sheet){
 const entries=displayEntries(sheet),starts=new Map();
 for(const d of ['H','V'])for(const e of entries[d]){const key=e.row+','+e.col;const labels=starts.get(key)??{};labels[d]=e.label;starts.set(key,labels);}
 $('board').replaceChildren();$('board').style.setProperty('--size',sheet.size);
 for(const [r,row]of sheet.board.entries())for(const[c,v]of row.entries()){
  const cell=el('div','cell'+(v.block?' block':''));
  if(!v.block){const labels=starts.get(r+','+c)??{};if(labels.H)cell.append(el('span','num',labels.H));if(labels.V)cell.append(el('span','num'+(labels.H?' right':''),labels.V));if(v.value)cell.append(el('span','letter',v.value));}
  $('board').append(cell);
 }
 $('clues').replaceChildren();
 for(const d of ['H','V']){const column=el('div');column.append(el('h3',null,(d==='H'?'橫向':'直向')+(mode==='player'?'題目':'答案')+(d==='H'?' →':' ↓')));
  for(const e of entries[d]){const row=el('div','clue');row.append(el('b',null,e.label+(d==='H'?'.':'、')),el('span',null,mode==='answers'?e.answer:e.clue));column.append(row);} $('clues').append(column);}
}
function selectEdition(i){editionIndex=i;updatePreview();}
function updatePreview(){
 $('mode-player').classList.toggle('active',mode==='player');$('mode-answer').classList.toggle('active',mode==='answers');
 const e=report?.editions[editionIndex];const sheet=e?(mode==='player'?e.player:e.answers):preview;
 if(sheet)drawWorksheet(sheet);
 $('preview-title').textContent=e?'第 '+e.edition_number+' 份':'盤面預覽';
 if(e?.content_summary){const c=e.content_summary.selected;$('quota-news').textContent=c.news;$('quota-idiom').textContent=c.idiom;}else if(packet){$('quota-news').textContent=packet.mix.news;$('quota-idiom').textContent=packet.mix.idiom;}
 $('edition-buttons').replaceChildren();for(const [i,e]of (report?.editions??[]).entries()){const b=el('button',i===editionIndex?'active':'','第 '+e.edition_number+' 份');b.onclick=()=>selectEdition(i);$('edition-buttons').append(b);}
 $('checks').replaceChildren();if(e){for(const c of e.grid_validation.checks)$('checks').append(el('span','check',c.id+' 通過'));$('checks').append(el('span','check','無重複題目'));}
 const ready=report?.status==='COMPLETE';$('download-pdf').disabled=!ready;$('download-report').disabled=!report;$('mode-answer').disabled=!report?.editions.length;
}
function updatePool(window){
 const m=packet.mix;$('quota-news').textContent=m.news;$('quota-idiom').textContent=m.idiom;
 $('pool-count').textContent=packet.news.candidates.length+' 時事／'+packet.idioms.length+' 成語';
 const cap=Math.min(Math.floor((packet.news.candidates.length+Math.min(packet.idioms.length,m.idiom*7))/(m.news+m.idiom)),Math.floor(packet.news.candidates.length/m.news),7);
 $('capacity').textContent='依候選數量，最多可供 '+cap+' 份；成語不足以時事補足，仍須通過題目與盤面檢查。';
 $('notice').textContent='新聞期間：'+window.from+' ～ '+window.to+'。內附固定快照；更新後請核對來源與提示，再列印。';
}
async function generate(count=Number($('count').value)){
 if(active)throw Error('正在產題中，請稍候。');
 if(!Number.isInteger(count)||count<1||count>7)throw Error('一次產出份數需為 1～7。');
 active=true;$('generate').disabled=true;$('cancel').hidden=false;
 $('progress').textContent='正在排盤並檢查每份題目…';$('download-pdf').disabled=true;
 try {
  const result=await askWorker({type:'generate',packet,count});report=result.report;packet=result.packet;editionIndex=0;mode='player';
  $('result-status').classList.toggle('error',report.status!=='COMPLETE');
  $('result-status').textContent=report.status==='COMPLETE'?'已完成 '+report.generated_count+' 份；各份驗證通過，題目與答案不重複。':'指定 '+count+' 份，完成 '+report.generated_count+' 份。'+(report.shortage?'剩餘題庫不足，請新增題目後再試。':'搜尋未找到足夠的合法盤面，請調整題庫後再試。');
  if(report.editions.some(e=>e.content_summary?.fallback))$('result-status').textContent+=' 成語不足或無法排入的部分已改用時事題。';
  if(report.shortage)$('result-status').textContent+=' 下一份需 '+report.shortage.needed_for_next.total+' 題，剩餘 '+report.shortage.available.total+' 題。';
  updatePreview();onGenerated(report);return {requested:count,generated:report.generated_count,status:report.status};
 }finally{active=false;$('generate').disabled=false;$('cancel').hidden=true;$('progress').textContent='';}
}
function onGenerated(r){addRecord(r);}
function downloadBlob(bytes,type,name){const a=el('a');const url=URL.createObjectURL(new Blob([bytes],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('generate').onclick=()=>generate().catch(e=>{$('progress').textContent=e.message;});
$('cancel').onclick=()=>{worker.terminate();for(const p of pending.values())p.reject(Error('已取消產題。'));pending.clear();startWorker();};
$('mode-player').onclick=()=>{mode='player';updatePreview();};$('mode-answer').onclick=()=>{mode='answers';updatePreview();};
$('download-report').onclick=()=>downloadBlob(JSON.stringify(report,null,2),'application/json','時事填字樂_'+report.issue_date+'_題目.json');
function switchPane(name){for(const n of ['create','bank','records']){$('pane-'+n).hidden=n!==name;$('tab-'+n).classList.toggle('active',n===name);$('tab-'+n).setAttribute('aria-selected',String(n===name));}}
for(const name of ['create','bank','records'])$('tab-'+name).onclick=()=>switchPane(name);
startWorker();
const ready=(async()=>{const [raw,sheet]=await Promise.all([fetch('./packet.json').then(r=>r.json()),fetch('./preview.json').then(r=>r.json())]);const prepared=await askWorker({type:'prepare',packet:raw});packet=prepared.packet;preview=sheet;updatePool(prepared.window);updatePreview();$('generate').disabled=false;})();
ready.catch(e=>{$('notice').textContent='載入失敗：'+e.message;});

let bankDraft=null,bankDirty=false;const records=[];
function markDirty(){bankDirty=true;$('bank-status').textContent='尚未套用修改';}
function sourceLink(url,label){try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))return null;const a=el('a',null,label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';return a;}catch{return null;}}
function withHint(clue,length){return clue.trim().replace(/[（(]\s*[234二三四]\s*字\s*[）)]\s*$/u,'')+'（'+length+'字）';}
function drawBank(reset=false){
 if(reset||!bankDraft){bankDraft=structuredClone(packet);bankDirty=false;$('bank-status').textContent='已套用；請下載保存';}
 $('issue-date').value=bankDraft.news.issue_date;
 const kind=$('bank-filter').value,items=kind==='news'?bankDraft.news.candidates:bankDraft.idioms;
 $('bank-list').replaceChildren();
 for(const c of items){
  const row=el('article','bank-row');
  const wordLabel=el('label',null,'答案');const word=el('input');word.value=c.word;word.setAttribute('aria-label','答案 '+c.word);word.oninput=()=>{c.word=word.value.trim();markDirty();};
  wordLabel.append(word);
  const clueLabel=el('label',null,'題目提示');const clue=el('textarea');clue.value=c.clue;clue.setAttribute('aria-label','提示 '+c.word);clue.oninput=()=>{c.clue=clue.value;markDirty();};clueLabel.append(clue);
  row.append(wordLabel,clueLabel);
  const source=el('div','source');
  if(kind==='news'){const event=bankDraft.news.events.find(e=>e.event_id===c.event_id);source.append(el('span',null,(event?.title??'新聞事件')+'　'));for(const s of event?.sources??[]){const a=sourceLink(s.url,s.publisher);if(a)source.append(a);}}
  else{const a=sourceLink(c.knowledge_source?.url,c.knowledge_source?.publisher??'辭典來源');if(a)source.append(a);source.append(el('span',null,c.knowledge_source?.meaning??''));}
  const remove=el('button',null,'移除此題');remove.onclick=()=>{const idx=items.indexOf(c);if(idx>=0)items.splice(idx,1);markDirty();drawBank();};source.append(remove);row.append(source);$('bank-list').append(row);
 }
 if(!items.length)$('bank-list').append(el('p','empty','尚無這類題目，請新增或匯入。'));
}
async function applyPacket(raw){
 if(active)throw Error('作業進行中，請完成或取消後再更新題庫。');
 const prepared=await askWorker({type:'prepare',packet:raw});
 packet=prepared.packet;report=null;editionIndex=0;mode='player';updatePool(prepared.window);drawBank(true);updatePreview();
 $('result-status').classList.remove('error');$('result-status').textContent='題庫已更新，請重新產題。';
 return prepared;
}
async function saveBank(){
 for(const c of bankDraft.news.candidates){const event=bankDraft.news.events.find(e=>e.event_id===c.event_id);c.clue=withHint(c.clue,Array.from(c.word).length);if(event)c.source_support=(event.sources??[]).filter(s=>s.excerpt?.includes(c.word)).map(s=>({source_id:s.source_id,evidence:s.excerpt}));}
 for(const c of bankDraft.idioms)c.clue=withHint(c.clue,4);
 const prepared=await applyPacket(bankDraft);$('bank-message').textContent='修改已套用。下載題庫檔即可保存；產題時仍會檢查提示及來源。';return prepared;
}
$('issue-date').onchange=()=>{bankDraft.news.issue_date=$('issue-date').value;markDirty();};
$('bank-filter').onchange=()=>drawBank();
$('save-bank').onclick=()=>saveBank().catch(e=>{$('bank-message').textContent=e.message;});
$('export-bank').onclick=async()=>{try{if(bankDirty)await saveBank();downloadBlob(JSON.stringify(packet,null,2),'application/json','時事填字樂_'+packet.news.issue_date+'_題庫.json');$('bank-message').textContent='題庫檔已下載。可在這裡重新匯入，或交給其他出題者。';}catch(e){$('bank-message').textContent=e.message;}};
$('import-bank').onclick=()=>{$('bank-file').value='';$('bank-file').click();};
$('bank-file').onchange=async()=>{try{const file=$('bank-file').files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('題庫檔上限為 2 MB。');
 const raw=JSON.parse((await file.text()).replace(/^\uFEFF/,''));let p;
 if(raw.news&&(raw.idioms===undefined||Array.isArray(raw.idioms)))p=raw;
 else if(raw.issue_date&&Array.isArray(raw.events)){p=structuredClone(packet);p.news=raw;}
 else if(raw.content_type==='idiom_collection'&&Array.isArray(raw.candidates)){p=structuredClone(packet);p.idioms=raw.candidates;}
 else throw Error('請匯入完整題庫、新聞題庫或成語題庫；題目成果檔請從「本次成果」匯入。');
 await applyPacket(p);$('bank-message').textContent='題庫已匯入，可以檢查或修改內容後產題。';
 }catch(e){$('bank-message').textContent='匯入失敗：'+e.message;}};
$('idiom-form').onsubmit=async event=>{
 event.preventDefault();try{
 if(bankDirty)await saveBank();
 const word=$('idiom-word').value.trim();if(!/^\p{Script=Han}{4}$/u.test(word))throw Error('成語請填完整的四個中文字。');
 if(!sourceLink($('idiom-url').value,'來源'))throw Error('來源需為有效的 http 或 https 網址。');
 const clue=$('idiom-clue').value.trim(),id='idiom-'+crypto.randomUUID(),p=structuredClone(packet);
 p.idioms.push({id,event_id:id,word,content_kind:'idiom',categories:['文化'],difficulty:'easy',answer_score:85,
  clue:withHint(clue.startsWith('【成語】')?clue:'【成語】'+clue,4),
  knowledge_source:{publisher:$('idiom-publisher').value.trim(),url:$('idiom-url').value.trim(),meaning:$('idiom-meaning').value.trim()}});
 await applyPacket(p);$('bank-filter').value='idiom';drawBank();$('idiom-form').reset();$('bank-message').textContent='成語題已加入。請下載題庫檔保存。';
 }catch(e){$('bank-message').textContent=e.message;}
};
$('news-form').onsubmit=async event=>{
 event.preventDefault();try{
 if(bankDirty)await saveBank();
 const word=$('news-word').value.trim();if(!/^\p{Script=Han}{2,4}$/u.test(word))throw Error('答案請填 2～4 個中文字。');
 const url=$('news-url').value.trim();if(!sourceLink(url,'來源'))throw Error('來源需為有效的 http 或 https 網址。');
 const excerpt=$('news-excerpt').value.trim();if(!excerpt.includes(word))throw Error('來源摘錄需包含答案，才能核對用字。');
 const id='event-'+crypto.randomUUID(),sid='source-'+crypto.randomUUID(),p=structuredClone(packet);
 const source={source_id:sid,publisher:$('news-publisher').value.trim(),kind:$('news-source-kind').value,url,published_at:$('news-published').value,excerpt};
 const record={event_id:id,event_date:$('news-date').value,title:$('news-title').value.trim(),summary:$('news-summary').value.trim(),categories:[$('news-category').value],fact_status:$('news-fact').value,event_score:Number($('news-score').value),anchor_event:false,sources:[source]};
 p.news.events.push(record);p.news.candidates.push({id:id+'::'+word,event_id:id,event_revision:id,word,clue:withHint($('news-clue').value,Array.from(word).length),answer_score:85,difficulty:'easy',source_support:[{source_id:sid,evidence:excerpt}]});
 await applyPacket(p);$('bank-filter').value='news';drawBank();$('news-form').reset();$('bank-message').textContent='新聞題已加入。若不在本期七天內，產題時會排除。請下載題庫檔保存。';
 }catch(e){$('bank-message').textContent=e.message;}
};
function addRecord(r){
 records.unshift({id:crypto.randomUUID(),created:new Date().toISOString(),report:structuredClone(r)});if(records.length>20)records.pop();drawRecords();
}
function drawRecords(){
 $('records-list').classList.toggle('empty',!records.length);$('records-list').replaceChildren();
 if(!records.length){$('records-list').textContent='還沒有本次產題成果。';return;}
 for(const rec of records){const row=el('div','record'),info=el('div');info.append(el('strong',null,(rec.report.issue_date??'未標日期')+'　'+rec.report.generated_count+'／'+rec.report.requested_count+' 份'));
 info.append(el('p',null,new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}).format(new Date(rec.created))+'　'+(rec.report.status==='COMPLETE'?'完整批次':'尚未完成指定份數')));
 const actions=el('div','records-actions'),view=el('button',null,'檢視'),save=el('button',null,'下載題目檔');
 view.onclick=()=>{report=structuredClone(rec.report);editionIndex=0;mode='player';$('result-status').textContent='已載入保存的 '+report.generated_count+'／'+report.requested_count+' 份成果。';updatePreview();switchPane('create');};
 save.onclick=()=>downloadBlob(JSON.stringify(rec.report,null,2),'application/json','時事填字樂_'+rec.report.issue_date+'_題目.json');
 actions.append(view,save);row.append(info,actions);$('records-list').append(row);}
}
$('import-report').onclick=()=>{$('report-file').value='';$('report-file').click();};
$('report-file').onchange=async()=>{try{const file=$('report-file').files[0];if(!file)return;if(file.size>5*1024*1024)throw Error('題目檔上限為 5 MB。');
 const r=JSON.parse((await file.text()).replace(/^\uFEFF/,''));if(!['COMPLETE','INCOMPLETE'].includes(r.status)||!Number.isInteger(r.requested_count)||r.requested_count<1||r.requested_count>7||!Number.isInteger(r.generated_count)||r.generated_count<1||r.generated_count>r.requested_count)throw Error('題目檔格式不符或沒有可預覽的盤面。');
 assertPrintableReport({...r,status:'COMPLETE',requested_count:r.generated_count});report=r;addRecord(r);editionIndex=0;mode='player';updatePreview();$('record-message').textContent='題目檔已匯入，並重新通過盤面與不重複檢查。';
 }catch(e){$('record-message').textContent='匯入失敗：'+e.message;}};
let fontsPromise;
async function fonts(){
 if(!fontsPromise)fontsPromise=Promise.all(['Regular','Bold'].map(async name=>{const r=await fetch('./NotoSansTC-'+name+'.ttf');if(!r.ok)throw Error('中文字型未能載入，請稍後重試。');return r.arrayBuffer();})).then(([regular,bold])=>({regular,bold})).catch(e=>{fontsPromise=null;throw e;});return fontsPromise;
}
$('download-pdf').onclick=async()=>{if(active)return;active=true;$('generate').disabled=true;$('download-pdf').disabled=true;$('download-pdf').textContent='準備 PDF 中…';
 try{const result=await askWorker({type:'pdf',report,fonts:await fonts()});downloadBlob(result.bytes,'application/pdf','時事填字樂_'+report.issue_date+'_'+report.generated_count+'份.pdf');}
 catch(e){$('progress').textContent='PDF 未產出：'+e.message;}
 finally{active=false;$('generate').disabled=false;$('download-pdf').textContent='下載 A4 PDF';$('download-pdf').disabled=report?.status!=='COMPLETE';}
};
ready.then(()=>{drawBank(true);$('issue-date').max=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());registerTools();});
function registerTools(){
 const context=document.modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
 const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 register({name:'read_crossword_workbench',title:'讀取出題狀態',description:'讀取本期日期、候選題數與目前產題狀態。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},
 execute:async input=>{if(!input||Object.keys(input).length)throw Error('不接受參數。');await ready;return {issue_date:packet.news.issue_date,news_candidates:packet.news.candidates.length,idiom_candidates:packet.idioms.length,max_editions:7,status:report?.status??'NOT_GENERATED'};}});
 register({name:'generate_crossword_editions',title:'產生填字題目',description:'依目前題庫產生 1～7 份不重複填字題，更新可見預覽。題庫不足時回傳實際完成份數。',inputSchema:{type:'object',properties:{count:{type:'integer',minimum:1,maximum:7}},required:['count'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},
 execute:async input=>{if(!input||Object.keys(input).length!==1||!Number.isInteger(input.count)||input.count<1||input.count>7)throw Error('份數需為 1～7。');await ready;$('count').value=String(input.count);return generate(input.count);}});
 register({name:'update_crossword_clues',title:'更新題目提示',description:'依候選題目識別碼修改多個提示，套用到目前題庫並清除舊預覽。',inputSchema:{type:'object',properties:{changes:{type:'array',minItems:1,maxItems:500,items:{type:'object',properties:{id:{type:'string'},clue:{type:'string'}},required:['id','clue'],additionalProperties:false}}},required:['changes'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},
 execute:async input=>{await ready;if(!input||Object.keys(input).length!==1||!Array.isArray(input.changes)||!input.changes.length||input.changes.length>500)throw Error('需提供提示修改清單。');const p=structuredClone(packet),pool=[...p.news.candidates,...p.idioms],ids=new Set();
 for(const change of input.changes){if(!change||Object.keys(change).length!==2||typeof change.id!=='string'||typeof change.clue!=='string'||!change.clue.trim()||ids.has(change.id))throw Error('提示修改格式錯誤。');const c=pool.find(c=>c.id===change.id);if(!c)throw Error('找不到題目 '+change.id);ids.add(change.id);c.clue=change.clue;}
 await applyPacket(p);switchPane('bank');return {updated:ids.size};}});
}
