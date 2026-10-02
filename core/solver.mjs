import {filterCandidateScope} from './news-policy.mjs';
export function solverSettings(options={}) {
  if (!options || typeof options!=='object' || Array.isArray(options)) throw new Error('options 必須是物件');
  const {target=12,minEntries=8,attempts=48,seed=1,sizes=[8,9,10],contentTargets}=options;
  if(!Number.isInteger(target)||target<2||target>14||!Number.isInteger(minEntries)||minEntries<2||minEntries>target)
    throw new Error('需符合 2 <= minEntries <= target <= 14');
  if(!Number.isInteger(attempts)||attempts<1||attempts>10000||(!Number.isSafeInteger(seed)||seed<0||seed>4294967295)) throw new Error('attempts 或 seed 不合法：seed 需為 0～4294967295 整數');
  if(!Array.isArray(sizes)||!sizes.length||Array.from(sizes).some((n,i)=>![8,9,10].includes(n)||(i&&n<=sizes[i-1]))) throw new Error('sizes 必須遞增且只包含 8、9、10');
  if(contentTargets!==undefined && (!contentTargets || Array.isArray(contentTargets) || typeof contentTargets!=='object' ||
      Object.keys(contentTargets).length!==2 || Object.keys(contentTargets).some(k=>!['news','idiom'].includes(k)) || !['news','idiom'].every(k=>Number.isInteger(contentTargets[k])&&contentTargets[k]>=0) ||
      contentTargets.news+contentTargets.idiom!==target))throw new Error('contentTargets 需含非負整數 news 與 idiom，總和等於 target');
  for(const key of Object.keys(options)) if(!['target','minEntries','attempts','seed','sizes','contentTargets'].includes(key)) throw new Error('未知 Solver 選項：'+key);
  return {target,minEntries,attempts,seed,sizes,...(contentTargets===undefined?{}:{contentTargets:{...contentTargets}})};
}

import {BLOCK, checkCandidates, lengthBalance} from './model.mjs';
import {validatePuzzle} from './validator.mjs';
import {analyzeCandidates,explainUnselected} from './analysis.mjs';
import {anchorEvents,candidatePriority,selectionQuality,compareSelections,selectionDiagnostics,SELECTION_ORDER} from './selection.mjs';

const chars = c => Array.from(c.word);
function rng(seed) {
  let s=seed>>>0;
  return () => {s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296;};
}
function cells(candidate,p) {
  return chars(candidate).map((char,i)=>({r:p.row+(p.direction==='V'?i:0),c:p.col+(p.direction==='H'?i:0),char}));
}
/** Incremental admission rules; independent of Validator's full-board scan. */
export function canPlace(board,placements,candidates,candidate,p) {
  if (!p || !['H','V'].includes(p.direction) || !Number.isSafeInteger(p.row) || !Number.isSafeInteger(p.col) ||
      typeof candidate?.word!=='string' || Array.from(candidate.word).length<2 || Array.from(candidate.word).length>4) return false;
  const n=board.length, dr=p.direction==='V'?1:0, dc=p.direction==='H'?1:0;
  const letters=cells(candidate,p);
  if(letters.some(x=>x.r<0||x.c<0||x.r>=n||x.c>=n)) return false;
  const first=letters[0], last=letters.at(-1);
  const occupied=(r,c)=>board[r]?.[c]!==undefined && board[r][c]!==BLOCK;
  if(occupied(first.r-dr,first.c-dc)||occupied(last.r+dr,last.c+dc)) return false;
  for(const x of letters) {
    if(occupied(x.r,x.c)) {
      if(board[x.r][x.c]!==x.char) return false;
      for(const old of placements) if(old.direction===p.direction &&
        cells(candidates.get(old.candidate_id),old).some(y=>y.r===x.r&&y.c===x.c)) return false;
    } else if(occupied(x.r-dc,x.c-dr)||occupied(x.r+dc,x.c+dr)) return false;
  }
  return true;
}
function apply(state, candidate, p) {
  const board=state.board.map(row=>row.slice());
  for(const x of cells(candidate,p)) board[x.r][x.c]=x.char;
  return {board,placements:[...state.placements,{candidate_id:candidate.id,...p}],expected:[...state.expected,candidate]};
}
function pairs(pool) {
  const result=[];
  for(let a=0;a<pool.length;a++) for(let b=a+1;b<pool.length;b++) {
    for(const [i,x] of chars(pool[a]).entries()) for(const [j,y] of chars(pool[b]).entries()) if(x===y) {
      for(const flip of [false,true]) result.push({a:pool[a],b:pool[b],i,j,flip});
    }
  }
  return result;
}
/** Bounded deterministic multistart search. Failure is NOT proof of impossibility.
 * Components may be disconnected; every component starts with a crossed pair.
 */
export function solve(candidates, options={}) {
  checkCandidates(candidates);
  const {target,minEntries,attempts,seed,sizes,contentTargets}=solverSettings(options);
  const scope=filterCandidateScope(candidates);
  const pool=[...scope.accepted].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const analysis=analyzeCandidates(candidates,{target,minEntries});
  const contentKind=c=>c.content_kind??'news';
  if(contentTargets&&pool.some(c=>!['news','idiom'].includes(contentKind(c))))throw new Error('content_kind 需為 news 或 idiom');
  const anchors=new Set(anchorEvents(pool));
  const map=new Map(pool.map(c=>[c.id,c])), templates=pairs(pool), random=rng(seed);
  let best=null;
  const diagnostics=[];
  for(const size of sizes) {
    let bestHere=null, tries=0, largestAttemptCount=0;
    for(let attempt=0;attempt<attempts;attempt++) {
      tries++;
      let state={board:Array.from({length:size},()=>Array(size).fill(BLOCK)),placements:[],expected:[]};
      while(state.expected.length<target) {
        const used=new Set(state.expected.map(c=>c.id));
        const events=new Map();
        state.expected.forEach(c=>events.set(c.event_id,(events.get(c.event_id)??0)+1));
        const contentCounts={news:0,idiom:0};
        if(contentTargets)state.expected.forEach(c=>contentCounts[contentKind(c)]++);
        const remaining=pool.filter(c=>!used.has(c.id)&&(events.get(c.event_id)??0)<2&&
          (!contentTargets||contentCounts[contentKind(c)]<contentTargets[contentKind(c)]));
        const actions=[];
        // Existing crossing: a single new answer can connect to several entries.
        for(const c of remaining) for(const old of state.placements) {
          const oc=map.get(old.candidate_id), oldCells=cells(oc,old);
          for(const x of oldCells) for(const [i,ch] of chars(c).entries()) if(x.char===ch) {
            const direction=old.direction==='H'?'V':'H';
            const p={direction,row:x.r-(direction==='V'?i:0),col:x.c-(direction==='H'?i:0)};
            if(canPlace(state.board,state.placements,map,c,p)) actions.push({items:[{c,p}]});
          }
        }
        // A new disconnected component must already contain a real crossing.
        if(state.expected.length+2<=target) for(const t of templates) {
          if(used.has(t.a.id)||used.has(t.b.id)) continue;
          if(contentTargets) {
            const additions={news:0,idiom:0};additions[contentKind(t.a)]++;additions[contentKind(t.b)]++;
            if(['news','idiom'].some(k=>contentCounts[k]+additions[k]>contentTargets[k]))continue;
          }
          if((events.get(t.a.event_id)??0)+1+(t.a.event_id===t.b.event_id?1:0)>2 || (events.get(t.b.event_id)??0)+1>2) continue;
          let admitted=0;
          const offset=Math.floor(random()*size*size);
          for(let pos=0;pos<size*size && admitted<3;pos++) {
            const index=(pos+offset)%(size*size), r=Math.floor(index/size), c=index%size;
            const pa=t.flip?{direction:'V',row:r,col:c}:{direction:'H',row:r,col:c};
            const pb=t.flip?{direction:'H',row:r+t.i,col:c-t.j}:{direction:'V',row:r-t.j,col:c+t.i};
            if(!canPlace(state.board,state.placements,map,t.a,pa)) continue;
            const mid=apply(state,t.a,pa);
            if(!canPlace(mid.board,mid.placements,map,t.b,pb)) continue;
            actions.push({items:[{c:t.a,p:pa},{c:t.b,p:pb}]}); admitted++;
          }
        }
        if(!actions.length) break;
        // Deficit-based score steers toward equal 2/3/4 counts; seeded jitter
        // explores different geometries and choices across reproducible runs.
        const count=lengthBalance(state.expected).counts;
        for(const a of actions) {
          let reward=0;
          const projected={...count};
          for(const item of a.items) {const len=chars(item.c).length; reward+=target/3-projected[len]; projected[len]++;}
          const newAnchorEvents=new Set(a.items.filter(item=>anchors.has(item.c.event_id)&&!events.has(item.c.event_id)).map(item=>item.c.event_id));
          a.anchorGain=newAnchorEvents.size;
          a.score=reward/a.items.length + random()*2 + a.items.reduce((n,item)=>n+candidatePriority(item.c),0)/a.items.length/200;
          if(contentTargets)a.score+=a.items.reduce((sum,item)=>sum+(contentTargets[contentKind(item.c)]-contentCounts[contentKind(item.c)])/Math.max(1,contentTargets[contentKind(item.c)]),0)/a.items.length;
        }
        actions.sort((a,b)=>b.anchorGain-a.anchorGain||b.score-a.score);
        for(const item of actions[0].items) state=apply(state,item.c,item.p);
      }
      largestAttemptCount=Math.max(largestAttemptCount,state.expected.length);
      if(state.expected.length>=minEntries) {
        const validation=validatePuzzle(state);
        if(!validation.valid) throw new Error('Solver invariant failed: '+JSON.stringify(validation));
        if(!bestHere || compareSelections(state,bestHere,pool)<0) bestHere=state;
        const quality=selectionQuality(state.expected,pool);
        if(state.expected.length===target && !quality.missing_anchor_event_ids.length &&
           quality.length_balance.penalty===(target%3===0?0:4)) break;
      }
    }
    diagnostics.push({size,attempts:tries,bestCount:largestAttemptCount,meetsMinimum:bestHere!==null,
      selection_quality:selectionQuality(bestHere?.expected??[],pool)});
    if(bestHere && (!best||compareSelections(bestHere,best,pool)<0)) best=bestHere;
    if(bestHere?.expected.length===target) break;
  }
  if(!best) {
    const quality=selectionQuality([],pool);
    return {status:'SEARCH_EXHAUSTED',puzzle:null,diagnostics,analysis,unselected:[...candidates],
    news_scope:{excludeEntertainment:true,excluded_candidates:scope.excluded},selection_quality:quality,selection_order:SELECTION_ORDER,
    selection_warnings:selectionDiagnostics(quality,pool,analysis,target),
    exclusions:explainUnselected(candidates,null,analysis),
    message:'搜尋預算內未找到達最低題數的合法盤；請參考候選分析，不代表數學上無解。'};
  }
  const selected=new Set(best.expected.map(c=>c.id));
  const validation=validatePuzzle(best);
  const quality=selectionQuality(best.expected,pool);
  return {status:best.expected.length===target?'SOLVED':'PARTIAL',puzzle:{schema_version:'1.0',...best},
    validation,diagnostics,analysis,news_scope:{excludeEntertainment:true,excluded_candidates:scope.excluded},selection_quality:quality,selection_order:SELECTION_ORDER,
    selection_warnings:selectionDiagnostics(quality,pool,analysis,target),exclusions:explainUnselected(candidates,best,analysis),
    unselected:candidates.filter(c=>!selected.has(c.id)),
    message:best.expected.length===target?'已達目標題數':'合法但未達目標題數；可增加候選或搜尋次數'};
}