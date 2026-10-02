export const SOURCES = [
 ['politics','台灣'],['intworld','國際'],['mainland','國際'],
 ['finance','財經'],['technology','科技'],['lifehealth','生活'],
 ['social','台灣'],['local','台灣'],['sport','體育']
].map(([key,category])=>({id:'cna-'+key,publisher:'中央通訊社',category,
 url:'https://feeds.feedburner.com/rsscna/'+key}));
export const SOURCE_POLICY_URL='https://www.cna.com.tw/about/rss.aspx';
