import {BLOCK} from '../model.mjs';
export function makePuzzle(specs,size=8) {
  const board=Array.from({length:size},()=>Array(size).fill(BLOCK));
  const expected=specs.map(([word],i)=>({id:'a'+i,word,event_id:'e'+i,clue:'測試題'}));
  const placements=specs.map(([word,direction,row,col],i)=>({candidate_id:'a'+i,direction,row,col}));
  for(let j=0;j<specs.length;j++) {
    const [word,direction,row,col]=specs[j];
    Array.from(word).forEach((ch,i)=>{board[row+(direction==='V'?i:0)][col+(direction==='H'?i:0)]=ch;});
  }
  return {schema_version:'1.0',board,expected,placements};
}
export const historicSpecs=[
  ['黃金','H',0,0],['金牌','V',0,1],['債市','H',0,3],['債券','V',0,3],
  ['利率','H',1,6],['殖利率','V',0,6],['單槓','H',4,0],['槓桿','V',4,1],
  ['女籃','H',4,3],['籃球','V',4,4],['聯合國','H',7,5],['中國','V',6,7]
];
export const historic=()=>makePuzzle(historicSpecs);
export const tech=()=>makePuzzle([['人工智慧','H',1,0],['無人機','V',0,0]]);
export function extraZhiChe() {
  const p=tech();
  // 人工智慧 has 智 at (1,2); corrupt the blocker below it to create 智撤.
  p.board[2][2]='撤';
  return p;
}
