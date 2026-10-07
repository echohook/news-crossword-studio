import {knownDefinitionClue} from './definitions.mjs';
const normalized=s=>s.normalize('NFKC').replace(/[\p{P}\p{Z}\p{Cf}\s]/gu,'');
const label={C01:'題目未洩漏答案',C02:'題目完整且長度合適',C03:'正確字數提示',
  C04:'沒有已知同字數替代答案',C05:'保留事實狀態限定語',C06:'來源摘錄對應候選'};
export function validateClue(candidate,event,{maxChars=60}={}) {
  if(!Number.isInteger(maxChars)||maxChars<10||maxChars>300) throw new Error('maxChars 需為 10～300 整數');
  const word=typeof candidate?.word==='string'?candidate.word:'';
  const clue=typeof candidate?.clue==='string'?candidate.clue:'';
  const length=Array.from(word).length;
  const meaningful=clue.replace(/[（(][^）)]*字[）)]\s*$/,'').trim();
  const hint=clue.normalize('NFKC').match(/\(([234二三四])字\)\s*$/);
  const hintLength=hint?({'二':2,'三':3,'四':4}[hint[1]]??Number(hint[1])):null;
  const alternatives=candidate?.alternative_answers??[];
  const competing=Array.isArray(alternatives)?alternatives.filter(a=>typeof a==='string'&&a!==word&&Array.from(a).length===length):[];
  const status=event?.fact_status;
  const qualifiers={considering:/評估|考慮|研議|傳出/,planned:/計畫|規劃|預計|擬|將/,reported:/據|報導|傳出|消息/};
  const qualifier=Object.hasOwn(qualifiers,status)?qualifiers[status]:null;
  const knownMeaning=knownDefinitionClue(candidate,meaningful);
  const overclaim=(status==='considering'||status==='planned')&&/已(?:決定|定案|設廠|完成|實施|確定)|確定(?:設廠|完成|實施)/.test(normalized(clue));
  const support=candidate?.source_support, sources=new Map((Array.isArray(event?.sources)?event.sources:[]).filter(s=>s&&typeof s.source_id==='string').map(s=>[s.source_id,s]));
  const invalidSupport=[];
  if(!Array.isArray(support)||!support.length) invalidSupport.push('缺少 source_support');
  else for(const s of support) {
    const source=s&&typeof s==='object'?sources.get(s.source_id):null;
    const evidence=typeof s?.evidence==='string'?s.evidence:'';
    if(!source||!evidence.trim()||!word||!normalized(evidence).includes(normalized(word))||
       !normalized(source.excerpt??'').includes(normalized(evidence))) invalidSupport.push('來源 ID、原文摘錄或答案文字不一致');
  }
  const conditions={
    C01:word.length>0&&!normalized(clue).includes(normalized(word)),
    C02:Array.from(meaningful).length>=4&&Array.from(clue).length<=maxChars,
    C03:hintLength===length,
    C04:Array.isArray(alternatives)&&alternatives.every(a=>typeof a==='string')&&competing.length===0,
    C05:['confirmed','announced','considering','planned','reported'].includes(status)&&(knownMeaning||!qualifier||qualifier.test(normalized(clue)))&&!overclaim,
    C06:invalidSupport.length===0
  };
  const checks=Object.entries(conditions).map(([id,pass])=>({id,label:label[id],pass,
    details:id==='C04'?competing:id==='C06'?[...new Set(invalidSupport)]:[]}));
  return {candidate_id:candidate?.id??null,passed:checks.every(c=>c.pass),checks,
    semantic_review:'REQUIRED',note:'機械檢查不證明題目唯一性、新聞真實性、台灣用語或政治中立；仍需複核。'};
}