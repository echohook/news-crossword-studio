import {MAX_BANK_BYTES} from '../core/limits.mjs';
import {assessBankReadiness} from '../news/readiness.mjs';
import {EXPERIENCED_PROFILE} from '../core/experienced-definitions.mjs';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchFeeds,buildBank} from '../news/collector.mjs';
const base=fileURLToPath(new URL('../',import.meta.url)),destination=resolve(base,'data/auto-news.json');
export async function updateNews({now=new Date(),fetchImpl=fetch,destinationPath=destination}={}){
 let previous;try{previous=JSON.parse(await readFile(destinationPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const template=JSON.parse(await readFile(resolve(base,'core/examples/mixed-input.json'),'utf8'));
 const results=await fetchFeeds({now,fetchImpl});
 const packet=buildBank(results,{now,previous,idioms:template.idioms,profile:EXPERIENCED_PROFILE});
 packet.automation.generation_check=assessBankReadiness(packet);
 const serialized=JSON.stringify(packet,null,2)+'\n';
 if(Buffer.byteLength(serialized)>MAX_BANK_BYTES)throw Error('完整題庫超過下載容量上限；保留上一批題庫。');
 await mkdir(resolve(destinationPath,'..'),{recursive:true});
 const temporary=destinationPath+'.tmp';
 await writeFile(temporary,serialized,'utf8');await rename(temporary,destinationPath);
 console.log(JSON.stringify({status:packet.automation.status,updated_at:packet.automation.updated_at,window:packet.automation.window,events:packet.news.events.length,candidates:packet.news.candidates.length,verified_editions:packet.automation.generation_check.generated_count,failed_sources:results.filter(r=>r.error).map(r=>r.source.id)}));
 return packet;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))updateNews().catch(e=>{console.error('自動題庫更新失敗：'+e.message);process.exitCode=1;});
