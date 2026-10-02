/** Shared data validation only: no placement or scan logic here. */
export const BLOCK = '■';
export const isHan = value => typeof value === 'string' && /^\p{Script=Han}$/u.test(value);
export function checkCandidates(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) throw new Error('candidates 必須是非空陣列');
  const ids = new Set(), words = new Set();
  for (const c of candidates) {
    if (!c || typeof c.id !== 'string' || !c.id.trim() || ids.has(c.id)) throw new Error('候選 id 必須唯一且非空');
    if (typeof c.event_id !== 'string' || !c.event_id.trim()) throw new Error('每個候選必須有 event_id');
    if (typeof c.word !== 'string') throw new Error('word 必須為文字');
    const chars = Array.from(c.word);
    if (chars.length < 2 || chars.length > 4 || !chars.every(isHan)) throw new Error('答案必須是 2～4 個中文字');
    if (words.has(c.word)) throw new Error('候選答案不可重複：' + c.word);
    ids.add(c.id); words.add(c.word);
  }
  return candidates;
}
export function lengthBalance(answers) {
  const counts = {2:0,3:0,4:0}, n = answers.length;
  for (const c of answers) counts[Array.from(c.word).length]++;
  return {
    counts,
    penalty: [2,3,4].reduce((sum,k) => sum + Math.abs(3 * counts[k] - n), 0),
    withinHalf: n > 0 && Math.max(...Object.values(counts)) * 2 <= n,
    warnings: n && Math.max(...Object.values(counts)) * 2 > n ? ['單一字數超過 50%；候選與搜尋限制下保留合法盤，建議擴充候選池。'] : []
  };
}
