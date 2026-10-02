import {BLOCK, isHan, checkCandidates, lengthBalance} from './model.mjs';

const labels = [
  '所有已宣告答案完整出現', '正式答案無遺漏且恰好配置一次',
  '無額外橫詞', '無額外直詞', '無字衝突或同方向重疊',
  '答案無中斷或越界', '每題至少一個有效交叉', '交叉字一致'
];
const key = e => JSON.stringify([e.direction,e.row,e.col,e.word]);
const cellKey = (r,c) => r + ',' + c;

/** Scan maximal runs directly from the final board. Never imports Solver. */
export function scanBoard(board) {
  const runs = [];
  for (const direction of ['H','V']) {
    const dr = direction === 'V' ? 1 : 0, dc = direction === 'H' ? 1 : 0;
    for (let r=0;r<board.length;r++) for (let c=0;c<board[r].length;c++) {
      if (board[r][c] === BLOCK) continue;
      if (board[r-dr]?.[c-dc] !== undefined && board[r-dr][c-dc] !== BLOCK) continue;
      let word = '', rr = r, cc = c;
      while (board[rr]?.[cc] !== undefined && board[rr][cc] !== BLOCK) {
        word += board[rr][cc]; rr += dr; cc += dc;
      }
      if (Array.from(word).length >= 2) runs.push({word,direction,row:r,col:c});
    }
  }
  return runs;
}

/** expected = selected official answers, NOT the entire input candidate pool.
 * Placements and board are treated as untrusted, independently supplied evidence.
 */
export function validatePuzzle(puzzle) {
  const errors = Array.from({length:8},()=>[]);
  const structural = [];
  const board = puzzle?.board;
  const expected = puzzle?.expected;
  const placements = puzzle?.placements;
  const size = Array.isArray(board) ? board.length : 0;
  if (![8,9,10].includes(size) || !Array.from(board).every(row => Array.isArray(row) && row.length === size && Array.from(row).every(c => c === BLOCK || isHan(c)))) {
    structural.push('盤面必須為 8/9/10 正方形，格子為單一中文字或 ■');
  }
  try { checkCandidates(expected); } catch(e) { structural.push(e.message); }
  if (!Array.isArray(placements) || !Array.from(placements).every(p=>p && typeof p==='object' && !Array.isArray(p) && typeof p.candidate_id==='string')) {
    structural.push('placements 必須是陣列且每項需有文字 candidate_id，不能有空項目');
  }
  if (Array.isArray(expected) && expected.length>14) structural.push('正式答案不得超過 V1 的 14 題上限');
  if (puzzle?.schema_version!==undefined && puzzle.schema_version!=='1.0') structural.push('不支援的 schema_version');
  if (structural.length) return {
    valid:false, status:'INVALID', structural,
    checks:labels.map((label,i)=>({id:'V0'+(i+1),label,pass:false,errors:['輸入結構不合法，無法驗證']})),
    detected:[], intersections:{}, balance:null
  };
  const official = new Map(expected.map(c=>[c.id,c]));
  const detected = scanBoard(board), detectedKeys = new Set(detected.map(key));
  const declarations = [], owners = new Map(), seenIds = new Map();
  const intact = new Set(), intersections = Object.create(null);
  for (const [index,p] of placements.entries()) {
    const candidate = official.get(p?.candidate_id);
    seenIds.set(p?.candidate_id, (seenIds.get(p?.candidate_id) ?? 0)+1);
    if (!candidate) { errors[1].push('未知正式答案 id：'+p?.candidate_id); continue; }
    if (!['H','V'].includes(p.direction) || !Number.isSafeInteger(p.row) || !Number.isSafeInteger(p.col)) {
      errors[0].push(candidate.word+' 座標或方向錯誤'); errors[5].push(candidate.word+' 座標或方向錯誤'); continue;
    }
    const entry = {...p,word:candidate.word,index};
    declarations.push(entry);
    let complete = true;
    const chars = Array.from(candidate.word);
    for (let i=0;i<chars.length;i++) {
      const r=p.row+(p.direction==='V'?i:0), c=p.col+(p.direction==='H'?i:0);
      const actual = board[r]?.[c];
      if (actual === undefined || actual === BLOCK) {
        errors[5].push(candidate.word+' 中斷或越界 @ '+r+','+c); complete=false;
      } else if (actual !== chars[i]) {
        errors[4].push(candidate.word+' 字元衝突 @ '+r+','+c); complete=false;
      }
      const k=cellKey(r,c);
      if (!owners.has(k)) owners.set(k,[]);
      owners.get(k).push({index,id:candidate.id,word:candidate.word,direction:p.direction,char:chars[i],r,c});
    }
    if (!complete || !detectedKeys.has(key(entry))) errors[0].push(candidate.word+' 未以完整連續答案出現在宣告位置');
    else intact.add(index);
  }
  for (const candidate of expected) {
    if (seenIds.get(candidate.id)!==1) errors[1].push(candidate.word+' 配置次數應為 1，實際為 '+(seenIds.get(candidate.id)??0));
    if (!declarations.some(e=>e.candidate_id===candidate.id && intact.has(e.index))) errors[1].push(candidate.word+' 在盤面中遺漏或不完整');
    intersections[candidate.id]=[];
  }
  // Compare coordinate + direction + word, preserving multiplicities.
  for (const direction of ['H','V']) {
    const counts = new Map();
    for (const e of declarations.filter(e=>e.direction===direction)) counts.set(key(e),(counts.get(key(e))??0)+1);
    for (const run of detected.filter(e=>e.direction===direction)) {
      const k=key(run), n=counts.get(k)??0;
      if (!n) errors[direction==='H'?2:3].push('UNEXPECTED ENTRY: '+run.word+' @ '+run.row+','+run.col);
      else counts.set(k,n-1);
    }
  }
  for (const [k, group] of owners) {
    if (group.length < 2) continue;
    if (new Set(group.map(o=>o.char)).size!==1) errors[4].push('不同答案字元衝突 @ '+k);
    if (new Set(group.map(o=>o.direction)).size!==group.length) errors[4].push('同方向答案重疊 @ '+k);
    const h=group.filter(o=>o.direction==='H'), v=group.filter(o=>o.direction==='V');
    for (const a of h) for (const b of v) {
      if (a.char!==b.char || board[a.r]?.[a.c]!==a.char) errors[7].push('交叉字不一致 @ '+k);
      else if (group.length===2 && intact.has(a.index) && intact.has(b.index)) {
        intersections[a.id].push({row:a.r,col:a.c,with:b.id});
        intersections[b.id].push({row:b.r,col:b.c,with:a.id});
      }
    }
  }
  for (const c of expected) if (!intersections[c.id].length) errors[6].push(c.word+' 無有效交叉');
  for (let r=0;r<size;r++) for (let c=0;c<size;c++) {
    if (board[r][c]!==BLOCK && !owners.has(cellKey(r,c))) structural.push('未歸屬正式答案的字格 @ '+r+','+c);
  }
  const eventCounts = new Map();
  for (const c of expected) eventCounts.set(c.event_id,(eventCounts.get(c.event_id)??0)+1);
  for (const [id,count] of eventCounts) if(count>2) structural.push('事件 '+id+' 超過預設 2 題上限');
  const checks = labels.map((label,i)=>({id:'V0'+(i+1),label,pass:errors[i].length===0,errors:[...new Set(errors[i])]}));
  const valid = !structural.length && checks.every(c=>c.pass);
  return {valid,status:valid?'VALID':'INVALID',checks,structural,detected,intersections,balance:lengthBalance(expected)};
}
