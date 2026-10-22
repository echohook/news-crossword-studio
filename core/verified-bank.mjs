import {createHash} from 'node:crypto';
import {generateEditions} from './editions.mjs';
export function bankFingerprint(packet){
 return createHash('sha256').update(JSON.stringify({news:packet.news,idioms:packet.idioms??[],mix:packet.mix,editorial_policy:packet.editorial_policy})).digest('hex');
}
export function verifiedCapacity(packet){
 const check=packet.automation?.generation_check;
 return check?.issue_date===packet.news?.issue_date&&check.fingerprint===bankFingerprint(packet)?check.generated_count:null;
}
/** A random batch may use the known tested seed if a later edition dead-ends. */
export function generateVerifiedEditions(packet,{count=1,seed=2,attempts=32,onProgress=null}={}){
 const result=generateEditions(packet,{count,solverOptions:{seed,attempts},onProgress});
 if(result.status==='COMPLETE'||seed===2||(verifiedCapacity(packet)??0)<count)return result;
 onProgress?.({phase:'verified-fallback',generated_count:result.generated_count,requested_count:count});
 const fallback=generateEditions(packet,{count,solverOptions:{seed:2,attempts:16},onProgress});
 if(fallback.generated_count<result.generated_count)return result;
 fallback.batch_search.verified_seed_fallback=true;fallback.batch_search.requested_seed=seed;
 return fallback;
}
