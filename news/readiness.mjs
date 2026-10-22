import {generateEditions} from '../core/editions.mjs';
import {bankFingerprint} from '../core/verified-bank.mjs';
import {validatePuzzle} from '../core/validator.mjs';
import {validateEditionDiversity} from '../core/edition-policy.mjs';
import {validateEditorialSelection} from '../core/editorial.mjs';
export function assessBankReadiness(packet,{count=7,attempts=16}={}){
 const report=generateEditions(packet,{count,solverOptions:{seed:2,attempts}});
 if(!report.generated_count)throw Error('本次題庫無法實際完成一份合法題目；保留上一批題庫。');
 if(!validateEditionDiversity(report.editions).valid||report.editions.some(e=>!validatePuzzle(e.puzzle).valid||!validateEditorialSelection(e.puzzle.expected).valid))throw Error('自動試排未通過獨立驗證；保留上一批題庫。');
 return {issue_date:packet.news.issue_date,tested_count:count,generated_count:report.generated_count,seed:2,attempts,fingerprint:bankFingerprint(packet),grid_valid:true,editorial_valid:true,nonrepeating:true};
}
