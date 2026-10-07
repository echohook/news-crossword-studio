const meanings={
 '果嶺':{meaning:'每洞終點附近、草修剪得很短的區域',rule:'13'},
 '桿弟':{meaning:'替選手攜帶裝備、協助判讀路線的人',rule:'10'},
 '球桿':{meaning:'用來把小白球擊出去的長柄器具',rule:'4'}
};
/** Golf vocabulary is eligible only when the actual news supplies golf context. */
export const GOLF_LEXICON='果嶺 桿弟 球道 球桿 球洞 沙坑 開球 推桿 揮桿 切桿 鐵桿 木桿 長桿 短桿 旗桿 球車 球座 球位 球痕 小鳥 老鷹 柏忌 標準桿 發球台 開球台 挖起桿 球道木 推桿線 果嶺費 桿弟費 練習場 暫定球 雙柏忌 一桿進洞 練習果嶺 開球木桿 美巡賽 萊德盃'.split(' ').map(word=>({
 word,kind:'高爾夫用語',topic:'golf',...(meanings[word]?{term_reference:{publisher:'R&A 高爾夫規則',url:'https://www.randa.org/zh-TW/rog/the-rules-of-golf/rule-'+meanings[word].rule,meaning:meanings[word].meaning}}:{}),golf_context:['小鳥','老鷹'].includes(word)?'scoring':'required'
}));
export function hasGolfContext(event){
 const text=[event?.title,event?.rss_lead].filter(s=>typeof s==='string').join(' ');
 return /高爾夫|高球|(?:\b(?:LPGA|PGA|DP World Tour|LIV Golf)\b)|美巡賽|萊德盃|果嶺|桿弟|柏忌|推桿|一桿進洞|標準桿/iu.test(text);
}
export function golfTermAllowed(candidate,event){
 if(candidate.topic!=='golf')return true;
 if(!hasGolfContext(event))return false;
 if(candidate.golf_context!=='scoring')return true;
 const text=[event.title,event.rss_lead].filter(Boolean).join(' ');
 const scored=new RegExp('(?:抓下?|射下?|獵|捉|打出|打下|收|轟|一記|兩記|一顆|兩顆)[一二三四五六七八九十百0-9]*[隻記顆個]?'+candidate.word+'|'+candidate.word+'(?:球|推桿|成績)','u');
 return scored.test(text);
}
export const golfNewsText=event=>hasGolfContext(event)&&event.rss_lead?event.title+'\n'+event.rss_lead:event.title;
