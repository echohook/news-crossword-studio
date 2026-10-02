import {createReportPdf} from './pdf.mjs';
import {generateEditions} from '../core/editions.mjs';
import {collectEvents,generateCandidates} from '../core/news.mjs';
import {checkCandidates} from '../core/model.mjs';
export function preparePacket(raw) {
 const p=structuredClone(raw);
 if(!p||typeof p!=='object'||!p.news||!Array.isArray(p.news.events)||!Array.isArray(p.idioms))throw Error('請匯入包含新聞與成語的題庫檔案。');
 if(p.news.events.length>200||p.idioms.length>300)throw Error('題庫過大，請分成數期匯入。');
 const collected=collectEvents(p.news.events,{issueDate:p.news.issue_date,fixture:p.news.dataset_mode==='fixture'});
 if(p.news.candidates===undefined)p.news.candidates=generateCandidates(collected.accepted);
 if(!Array.isArray(p.news.candidates)||p.news.candidates.length>500)throw Error('每期新聞候選上限為 500 題。');
 if(p.idioms.length)checkCandidates(p.idioms);
 if(p.news.candidates.length)checkCandidates(p.news.candidates);
 p.mix??={news:8,idiom:4};
 if(!Number.isInteger(p.mix.news)||!Number.isInteger(p.mix.idiom)||p.mix.news<1||p.mix.idiom<1||p.mix.news+p.mix.idiom>14)throw Error('新聞及成語題數需為正整數，合計不超過 14 題。');
 return {packet:p,window:collected.window,excluded_events:collected.reports.filter(e=>!e.passed).length};
}
if(typeof self!=='undefined')self.onmessage=async({data})=>{
 try {
  if(data.type==='pdf'){const bytes=await createReportPdf(data.report,data.fonts);self.postMessage({id:data.id,type:'pdf',bytes},[bytes.buffer]);return;}
  const prepared=preparePacket(data.packet);
  if(data.type==='prepare'){self.postMessage({id:data.id,type:'prepared',...prepared});return;}
  if(data.type!=='generate')throw Error('未知操作。');
  const report=generateEditions(prepared.packet,{count:data.count,solverOptions:{attempts:256,seed:2}});
  self.postMessage({id:data.id,type:'result',report,packet:prepared.packet});
 }catch(e){self.postMessage({id:data.id,type:'error',message:e.message});}
};
