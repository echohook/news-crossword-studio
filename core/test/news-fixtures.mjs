const definitions={
  "台積電": "台灣晶圓代工企業的常用簡稱。",
  "電競": "電子競技的常用簡稱。",
  "半導體": "導電性介於導體與絕緣體之間的材料。",
  "團體競速": "自行車場地賽中由多名選手共同完成的速度項目。",
  "人工智慧": "讓電腦模擬人類智慧的技術領域。",
  "無人機": "不需機上駕駛操作的飛行器。",
  "美軍": "美國的武裝部隊常用簡稱。",
  "撤軍": "將部隊從原駐地退出的行動。",
  "黃金": "常用於首飾、呈黃色的貴金屬。",
  "金牌": "競賽第一名通常獲頒的獎牌。",
  "債市": "固定收益證券交易市場的常用簡稱。",
  "債券": "政府或企業發行、約定還本付息的證券。",
  "利率": "借貸成本常以本金百分比表示的金融指標。",
  "殖利率": "投資收益與市場價格相比所得的報酬率指標。",
  "單槓": "體操選手在一根水平橫桿上完成動作的器械項目。",
  "槓桿": "以支點放大作用力，也用來比喻借貸放大投資的機制。",
  "女籃": "女子代表隊參加的投籃球類項目常用簡稱。",
  "籃球": "兩隊將球投入高處球框、以得分競勝的運動。",
  "聯合國": "成立於一九四五年的全球性國際組織。",
  "中國": "首都為北京的亞洲國家。",
  "智慧城市": "運用數位技術改善交通、能源等公共服務的都市。",
  "城市": "人口密集、商業與公共服務集中的聚落。",
  "再生能源": "利用陽光、風力等可持續補充來源取得的能量。",
  "能源": "可用來供熱、發電或提供動力的資源。",
  "國際合作": "多個國家共同協力處理議題的行動。",
  "合作社": "成員共同出資、共同管理的互助組織。",
  "全民運動": "鼓勵所有民眾持續參與體育活動的理念。",
  "運動員": "接受訓練並參加體育競賽的人。"
};
export function packetForWords(words) {
  return {issue_date:'2026-10-01',dataset_mode:'fixture',note:'合成邏輯測試，不代表真實新聞',
    events:words.map((word,i)=>{
      const event_id='event-'+String(i+1).padStart(2,'0');
      return {event_id,event_date:new Date(Date.UTC(2026,8,25+i%7)).toISOString().slice(0,10),
        title:'合成事件：'+word,summary:'測試事件與候選資料關聯。',categories:[i%2?'國際':'科技'],
        fact_status:'confirmed',event_score:90,anchor_event:i===0,
        sources:[{source_id:'source-'+i,publisher:'合成測試資料',kind:'fixture',
          url:'https://example.invalid/fixture/'+event_id,published_at:'2026-10-01',
          excerpt:'本事件以「'+word+'」作為測試詞彙。'}],
        keywords:[{word,clue_draft:definitions[word]??'本合成事件對應的指定詞語。',answer_score:90,difficulty:'medium'}]};
    })};
}
export const fullPacket=()=>packetForWords(Object.keys(definitions));
export function badPacket() {
  const p=packetForWords(['人工智慧','無人機']);
  p.events[0].keywords[0].clue_draft='人工智慧是模擬人類思考的技術。';
  p.events[1].keywords[0].clue_draft='不需機上駕駛操作的飛行器。（2字）';
  return p;
}