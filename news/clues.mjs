/** Authored, complete clue sentences. Unknown terms are skipped instead of masked. */
import {CLUE_STYLE,definitionBody} from '../core/definitions.mjs';
export {CLUE_STYLE,DESCRIPTIONS,GOLF_DESCRIPTIONS} from '../core/definitions.mjs';
export const hasPlaceholder=text=>typeof text==='string'&&/[○◯□]|＿{2,}|_{2,}|補全|缺字/u.test(text);
export const normalized=text=>text.normalize('NFKC').replace(/[\p{P}\p{Z}\p{Cf}\s]/gu,'');
const subjectQuestions={'國家或地區':'哪個國家或地區','地名':'哪個地區','機關或組織':'哪個機關或組織','企業':'哪家公司','人物':'哪位人物','體育項目':'哪個運動項目'};
const subjectPredicate=/^(?:將|擬|宣布|公布|推出|表示|指出|決定|計畫|規劃|評估|考慮|研議|調升|調降|啟動|完成|成立|同意|要求|批准|通過|拒絕|反對|呼籲|邀請|獲|奪|拿下|出訪|訪|赴|捐|推|籲|控|提|估|與|和|對|在)/u;
export function naturalClueOptions(event,entry){
 const {word,kind}=entry,length=Array.from(word).length,body=definitionBody(word);
 const options=[];
 if(body)options.push({clue:body+'（'+length+'字）',clue_style:CLUE_STYLE,clue_kind:'meaning'});
 const question=subjectQuestions[kind];
 const title=typeof event.title==='string'?event.title.trim():'';
 if(question&&title.startsWith(word)){
  const tail=title.slice(word.length).trim();
  if(subjectPredicate.test(tail)&&!tail.includes(word)&&!/[；;]|[。！？!?]/u.test(tail))options.push({
   clue:'據報導，'+question.replace(/^哪(?:個|位)/u,'某').replace('哪家公司','某家公司')+tail+'。（'+length+'字）',clue_style:CLUE_STYLE,clue_kind:'event'
  });
 }
 return options.filter(o=>Array.from(o.clue).length<=60&&!hasPlaceholder(o.clue)&&!normalized(o.clue).includes(normalized(word)));
}
