import {filterCandidateScope} from './news-policy.mjs';
import {checkCandidates} from './model.mjs';

/** Character graph gives necessary conditions only; it is not a layout solver. */
export function analyzeCandidates(candidates, {target=12,minEntries=8}={}) {
  checkCandidates(candidates);
  if (!Number.isInteger(target) || target<2 || target>14 ||
      !Number.isInteger(minEntries) || minEntries<2 || minEntries>target) {
    throw new Error('需符合 2 <= minEntries <= target <= 14');
  }
  const scope=filterCandidateScope(candidates);
  const pool=[...scope.accepted].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const neighbors=new Map(pool.map(c=>[c.id,new Set()]));
  const links=[];
  for(let i=0;i<pool.length;i++) for(let j=i+1;j<pool.length;j++) {
    const b=new Set(Array.from(pool[j].word));
    const shared=[...new Set(Array.from(pool[i].word).filter(ch=>b.has(ch)))];
    if(shared.length) {
      neighbors.get(pool[i].id).add(pool[j].id);
      neighbors.get(pool[j].id).add(pool[i].id);
      links.push({a:pool[i].id,b:pool[j].id,characters:shared});
    }
  }
  const crossable=pool.filter(c=>neighbors.get(c.id).size>0);
  const histogram=items=>Object.fromEntries([2,3,4].map(n=>[n,items.filter(c=>Array.from(c.word).length===n).length]));
  const events=new Map();
  for(const c of crossable) events.set(c.event_id,(events.get(c.event_id)??0)+1);
  const eventCapacity=[...events.values()].reduce((n,count)=>n+Math.min(2,count),0);
  const entryUpperBound=Math.min(crossable.length,eventCapacity);
  const isolated=pool.filter(c=>!neighbors.get(c.id).size).map(c=>({id:c.id,word:c.word,event_id:c.event_id}));
  const seen=new Set(),components=[];
  for(const c of pool) {
    if(seen.has(c.id)) continue;
    const component=[],queue=[c.id];seen.add(c.id);
    for(let i=0;i<queue.length;i++) {
      const id=queue[i];component.push(id);
      for(const other of neighbors.get(id)) if(!seen.has(other)){seen.add(other);queue.push(other);}
    }
    components.push(component);
  }
  const warnings=scope.excluded.map(e=>({code:e.reason,message:e.word+'：'+e.message,ids:[e.candidate_id]}));
  if(isolated.length) warnings.push({code:'NO_SHARED_CHARACTER',message:'有 '+isolated.length+' 個候選沒有共同字，無法滿足至少一個交叉。',ids:isolated.map(c=>c.id)});
  if(entryUpperBound<target) warnings.push({code:'TARGET_CAPACITY_SHORTAGE',message:'可交叉候選及每事件最多兩題的題數上限為 '+entryUpperBound+'，低於目標 '+target+'。'});
  if(entryUpperBound<minEntries) warnings.push({code:'MINIMUM_CAPACITY_SHORTAGE',message:'候選條件下的題數上限低於最低 '+minEntries+' 題，請擴充候選池。'});
  if(eventCapacity<crossable.length) warnings.push({code:'EVENT_LIMIT',message:'每事件最多兩題，將可交叉候選的題數上限由 '+crossable.length+' 降為 '+eventCapacity+'。'});
  const crossableLengths=histogram(crossable);
  for(const n of [2,3,4]) if(crossableLengths[n]<Math.floor(target/3)) warnings.push({
    code:'LENGTH_CAPACITY_SHORTAGE',length:n,
    message:n+' 字可交叉候選僅 '+crossableLengths[n]+' 題，無法達到目標題數的平均分布。'
  });
  return {target,minEntries,candidateCount:pool.length,inputCandidateCount:candidates.length,excluded_candidates:scope.excluded,crossableCount:crossable.length,
    lengthCounts:histogram(pool),crossableLengthCounts:crossableLengths,eventCapacity,entryUpperBound,
    isolated,components,links,warnings,
    note:'共同字與事件題數只提供必要條件及上限；實際字盤是否可排仍須 Solver 與獨立 Validator。'};
}

export function explainUnselected(candidates,puzzle,analysis) {
  const selected=new Set(puzzle?.expected.map(c=>c.id)??[]);
  const isolated=new Set(analysis.isolated.map(c=>c.id));
  const scopeExcluded=new Map((analysis.excluded_candidates??[]).map(c=>[c.candidate_id,c]));
  const events=new Map();
  for(const c of puzzle?.expected??[]) events.set(c.event_id,(events.get(c.event_id)??0)+1);
  return candidates.filter(c=>!selected.has(c.id)).map(c=>{
    if(scopeExcluded.has(c.id))return scopeExcluded.get(c.id);
    const reason=isolated.has(c.id)?'NO_SHARED_CHARACTER':
      (events.get(c.event_id)??0)>=2?'EVENT_LIMIT':'NOT_SELECTED_WITHIN_BUDGET';
    const message={NO_SHARED_CHARACTER:'沒有其他候選能以相同字交叉',
      EVENT_LIMIT:'此方案已達同事件兩題上限',
      NOT_SELECTED_WITHIN_BUDGET:'本次方案未選入；不代表一定排不進'}[reason];
    return {candidate_id:c.id,word:c.word,event_id:c.event_id,reason,message};
  });
}