export const MAX_EDITIONS = 7;
/** Content-only validation; independent of Solver and board geometry checks. */
export const answerKey=value=>typeof value==='string'?value.normalize('NFKC').trim():'';
export const clueKey=value=>typeof value==='string'?value.normalize('NFKC')
 .replace(/^\s*【成語】/u,'').replace(/[（(]\s*[234二三四]\s*字\s*[）)]/gu,'')
 .replace(/[\p{P}\p{Z}\p{Cf}\s]/gu,''):'';

export function validateEditionDiversity(editions) {
 const errors=[],words=new Map(),clues=new Map();
 if(!Array.isArray(editions)||!editions.length)return {valid:false,errors:[{code:'D00',message:'需有至少一份題目'}]};
 for(const [i,edition] of editions.entries()) {
  const entries=edition?.puzzle?.expected;
  if(!Array.isArray(entries)||!entries.length){errors.push({code:'D00',edition:i+1,message:'題目資料不完整'});continue;}
  for(const [j,c] of entries.entries()) {
   const word=answerKey(c?.word),clue=clueKey(c?.clue),position={edition:i+1,entry:j+1};
   if(!word||!clue){errors.push({code:'D00',...position,message:'需有非空答案與提示'});continue;}
   for(const [key,map,code,label] of [[word,words,'D01','答案'],[clue,clues,'D02','題目提示']]) {
    if(map.has(key))errors.push({code,...position,first:map.get(key),message:label+'重複'});
    else map.set(key,position);
   }
  }
 }
 return {valid:errors.length===0,errors};
}
