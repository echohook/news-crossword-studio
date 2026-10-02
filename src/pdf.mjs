import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {validatePuzzle} from '../core/validator.mjs';
import {buildWorksheet} from '../core/worksheet.mjs';
import {MAX_EDITIONS,validateEditionDiversity} from '../core/edition-policy.mjs';
import {newsWindow} from '../core/news.mjs';

export function assertPrintableReport(r) {
 if(!r||r.status!=='COMPLETE'||!Number.isInteger(r.requested_count)||r.requested_count<1||r.requested_count>MAX_EDITIONS||r.generated_count!==r.requested_count||r.editions?.length!==r.requested_count)throw Error('指定份數未全部完成，不能匯出 PDF。');
 const repeat=validateEditionDiversity(r.editions);
 if(!repeat.valid)throw Error('題目或答案重複，不能匯出 PDF。');
 for(const [i,e]of r.editions.entries()) {
  if(e.edition_number!==i+1||!validatePuzzle(e.puzzle).valid)throw Error('盤面未通過獨立驗證，不能匯出 PDF。');
  for(const [key,includeAnswers]of [['player',false],['answers',true]]) {
   const sheet=buildWorksheet(e.puzzle,{includeAnswers,maxClueChars:r.render_settings?.maxClueChars??60});
   if(sheet.status!=='TRIAL_READY'||sheet.clue_warnings.length||JSON.stringify(sheet)!==JSON.stringify(e[key]))throw Error('作答或答案資料不一致，不能匯出 PDF。');
  }
 }
 return true;
}
const cn=n=>n<10?'零一二三四五六七八九'[n]:n===10?'十':'十'+'零一二三四五六七八九'[n-10];
export const numbered=sheet=>Object.fromEntries(['H','V'].map(d=>[d,[...sheet.clues[d]].sort((a,b)=>a.row-b.row||a.col-b.col).map((e,i)=>({...e,label:d==='H'?String(i+1):cn(i+1)}))]));
export async function createReportPdf(report,{regular,bold}) {
 assertPrintableReport(report);
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const font=await doc.embedFont(regular,{subset:false}),heavy=await doc.embedFont(bold,{subset:false});
 const supported=new Set(font.getCharacterSet());
 function supportedText(text){for(const ch of text)if(!supported.has(ch.codePointAt(0)))throw Error('中文字型未包含「'+ch+'」，請調整用字後再試。');}
 const W=595.2756,H=841.8898,M=36.85;
 const period=report.issue_date?newsWindow(report.issue_date):null;
 const periodText=period?'新聞期間：'+period.from.replaceAll('-','.')+' - '+period.to.replaceAll('-','.'):'';
 const sheets=[...report.editions.map(e=>({sheet:e.player,edition:e.edition_number})),...report.editions.map(e=>({sheet:e.answers,edition:e.edition_number}))];
 for(const [index,{sheet,edition}]of sheets.entries()) {
  const page=doc.addPage([W,H]),entries=numbered(sheet),starts=new Map();
  const draw=(text,x,y,size=13.5,isBold=false)=>{supportedText(text);page.drawText(text,{x,y,size,font:isBold?heavy:font,color:rgb(0,0,0)});};
  const right=(text,x,y,size,isBold=false)=>draw(text,x-(isBold?heavy:font).widthOfTextAtSize(text,size),y,size,isBold);
  draw('時事填字樂',M,H-48,27,true);
  right('第 '+edition+' 份・'+(sheet.mode==='player'?'作答頁':'答案頁'),W-M,H-46,14,true);
  const subtitle=periodText+(sheet.mode==='player'?(periodText?'　　':'')+'填答日期：________________':'');
  if(font.widthOfTextAtSize(subtitle,10.5)>W-2*M)throw Error('日期列超出版面。');
  draw(subtitle,M,H-70,10.5);
  for(const d of ['H','V'])for(const e of entries[d]){const key=e.row+','+e.col;const a=starts.get(key)??{};a[d]=e.label;starts.set(key,a);}
  const cell=({8:12,9:11.5,10:10.5}[sheet.size])*2.8346457;
  const left=(W-cell*sheet.size)/2,top=H-98,bottom=top-cell*sheet.size;
  for(const [r,row]of sheet.board.entries())for(const [c,value]of row.entries()) {
   const x=left+c*cell,y=top-(r+1)*cell;
   page.drawRectangle({x,y,width:cell,height:cell,color:value.block?rgb(.24,.24,.24):rgb(1,1,1),borderWidth:.75,borderColor:rgb(0,0,0)});
   if(value.block)continue;
   const labels=starts.get(r+','+c)??{};
   if(labels.H)draw(labels.H,x+2.7,y+cell-10,9,true);
   if(labels.V){const lx=labels.H?x+cell-2.7-heavy.widthOfTextAtSize(labels.V,9):x+2.7;draw(labels.V,lx,y+cell-10,9,true);}
   if(sheet.mode==='answers')draw(value.value,x+(cell-font.widthOfTextAtSize(value.value,20))/2,y+4.5,20);
  }
  const width=(W-2*M-19.84)/2,cols=[M,M+width+19.84],head=bottom-25;
  function wrap(text,max,size) {
   const lines=[];let line='';
   for(const ch of text.match(/（[234]字）|./gu)??[]) {
    if(line&&font.widthOfTextAtSize(line+ch,size)>max) {
     if('，。！？、；：）】》」』％'.includes(ch)&&Array.from(line).length>1){const a=Array.from(line);lines.push(a.slice(0,-1).join(''));line=a.at(-1)+ch;}
     else{lines.push(line);line=ch;}
    }else line+=ch;
   }
   if(line)lines.push(line);
   for(let i=0;i<lines.length-1;i++)if('（【《「『'.includes(lines[i].at(-1))){const a=Array.from(lines[i]);lines[i]=a.slice(0,-1).join('');lines[i+1]=a.at(-1)+lines[i+1];}
   if(lines.some(l=>font.widthOfTextAtSize(l,size)>max+.01))throw Error('題目提示太長，請縮短後重試。');
   return lines;
  }
  for(const [di,d]of ['H','V'].entries()) {
   const x=cols[di];draw((d==='H'?'橫向':'直向')+(sheet.mode==='player'?'題目':'答案')+(d==='H'?' →':' ↓'),x,head,15,true);
   page.drawLine({start:{x,y:head-7},end:{x:x+width,y:head-7},thickness:.5,color:rgb(.55,.55,.55)});
   let y=head-28;
   for(const e of entries[d]) {
    const prefix=e.label+(d==='H'?'.':'、');
    if(sheet.mode==='player') {
     draw(prefix,x,y,13.5,true);
     for(const line of wrap(e.clue,width-30,13.5)){draw(line,x+30,y,13.5);y-=18;}y-=4;
    }else{draw(prefix,x,y,15,true);draw(e.answer,x+32,y,17,true);if(e.clue.startsWith('【成語】'))draw('【成語】',x+32+heavy.widthOfTextAtSize(e.answer,17)+8,y,10);y-=32;}
   }
   if(y<54)throw Error('題目超出 A4 版面，請縮短提示後重新產題。');
  }
  page.drawLine({start:{x:M,y:42},end:{x:W-M,y:42},thickness:.4,color:rgb(.65,.65,.65)});
  draw(sheet.mode==='player'?'時事與成語':'答案頁請另行保管，勿與作答頁同時發放。',M,27,9);
  right((index+1)+' / '+sheets.length,W-M,27,9);
 }
 doc.setTitle('時事填字樂');doc.setAuthor('時事填字樂');doc.setSubject('各份題目與答案不重複；作答頁在前，答案頁在後');
 return doc.save();
}
