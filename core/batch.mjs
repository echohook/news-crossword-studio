import {formatSelection} from './selection.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {solve} from './solver.mjs';
import {validatePuzzle} from './validator.mjs';
import {runPipeline} from './pipeline.mjs';

const statuses=new Set(['SOLVED','PARTIAL','SEARCH_EXHAUSTED','VALID','INVALID','INPUT_ERROR','REVIEW_REQUIRED','NO_ELIGIBLE_CANDIDATES']);
function checkExpect(expect) {
  if(expect===undefined) return;
  if(!expect || typeof expect!=='object' || Array.isArray(expect)) throw new Error('expect 必須是物件');
  for(const k of Object.keys(expect)) if(!['status','valid','size','entryCount','lengthCounts'].includes(k)) throw new Error('未知 expect 欄位：'+k);
  if(expect.status!==undefined && !statuses.has(expect.status)) throw new Error('expect.status 不合法');
  if(expect.valid!==undefined && typeof expect.valid!=='boolean') throw new Error('expect.valid 必須是布林值');
  if(expect.size!==undefined && ![8,9,10].includes(expect.size)) throw new Error('expect.size 必須為 8/9/10');
  if(expect.entryCount!==undefined && (!Number.isInteger(expect.entryCount)||expect.entryCount<0)) throw new Error('expect.entryCount 不合法');
  if(expect.lengthCounts!==undefined) {
    const counts=expect.lengthCounts;
    if(!counts || typeof counts!=='object' || Array.isArray(counts) ||
       Object.keys(counts).some(k=>!['2','3','4'].includes(k)) ||
       [2,3,4].some(k=>!Number.isInteger(counts[k])||counts[k]<0)) throw new Error('expect.lengthCounts 需包含 2、3、4 的非負整數');
  }
}
function assertExpect(result,expect,operation) {
  const errors=[];
  if(expect===undefined) {
    if(result.status!==(operation==='solve'?'SOLVED':operation==='pipeline'?'REVIEW_REQUIRED':'VALID')) errors.push('未達預設成功條件：'+result.status);
    return errors;
  }
  for(const k of ['status','valid','size','entryCount']) if(expect[k]!==undefined && result[k]!==expect[k]) errors.push(k+' 預期 '+expect[k]+'，實際 '+result[k]);
  if(expect.lengthCounts && [2,3,4].some(k=>expect.lengthCounts[k]!==result.lengthCounts?.[k])) errors.push('字數分布與預期不符');
  return errors;
}
/** Each case is isolated. Expected INVALID is a passing regression, not success of the grid. */
export async function runBatch(manifest,{baseDir='.'}={}) {
  if(!manifest || !Array.isArray(manifest.cases) || !manifest.cases.length) throw new Error('批次檔需有非空 cases 陣列');
  const ids=new Set();
  for(const c of manifest.cases) {
    if(!c || typeof c.id!=='string' || !c.id.trim() || ids.has(c.id)) throw new Error('批次案例 id 必須唯一且非空');
    if(!['solve','validate','pipeline'].includes(c.operation)) throw new Error('operation 需為 solve、validate 或 pipeline');
    if((Object.hasOwn(c,'data')?1:0)+(Object.hasOwn(c,'input')?1:0)!==1) throw new Error('每個案例必須指定 data 或 input，且不能同時指定');
    if(c.input!==undefined && (typeof c.input!=='string' || !c.input.trim())) throw new Error('input 必須是非空路徑');
    checkExpect(c.expect);
    if(c.expect && !Object.keys(c.expect).length) throw new Error('expect 不可空白');
    ids.add(c.id);
  }
  const results=[];
  for(const c of manifest.cases) {
    let result;
    try {
      const data=Object.hasOwn(c,'input')
        ?JSON.parse((await readFile(resolve(baseDir,c.input),'utf8')).replace(/^\uFEFF/,'')):c.data;
      if(c.operation==='pipeline') {
        if(c.options!==undefined&&(!c.options||typeof c.options!=='object'||Array.isArray(c.options)))throw new Error('options 必須是物件');
        const {maxClueChars=60,...solverOptions}=c.options??{};
        const report=runPipeline(data,{solverOptions,maxClueChars});
        result={status:report.status,valid:report.grid_validation?.valid??null,
          size:report.puzzle?.board.length??null,entryCount:report.puzzle?.expected.length??0,
          lengthCounts:report.grid_validation?.balance?.counts??null,
          puzzle:report.puzzle,validation:report.grid_validation,pipeline_report:report,message:report.note};
      } else if(c.operation==='solve') {
        const solved=solve(Array.isArray(data)?data:data?.candidates,c.options??{});
        // Batch independently validates again; an invalid result cannot be reported SOLVED.
        const validation=solved.puzzle?validatePuzzle(solved.puzzle):null;
        if(validation && !validation.valid) throw new Error('Solver 回傳的盤面未通過獨立驗證');
        result={status:solved.status,valid:validation?.valid??null,size:solved.puzzle?.board.length??null,
          entryCount:solved.puzzle?.expected.length??0,lengthCounts:validation?.balance?.counts??null,
          puzzle:solved.puzzle,validation,diagnostics:solved.diagnostics,
          analysis:solved.analysis,exclusions:solved.exclusions,message:solved.message,
          selection_quality:solved.selection_quality,selection_warnings:solved.selection_warnings,selection_order:solved.selection_order};
      } else {
        const validation=validatePuzzle(data);
        result={status:validation.status,valid:validation.valid,
          size:validation.balance!==null?data.board.length:null,
          entryCount:validation.balance!==null?data.expected.length:0,
          lengthCounts:validation.balance?.counts??null,validation};
      }
    } catch(e) {
      result={status:'INPUT_ERROR',valid:null,size:null,entryCount:0,lengthCounts:null,message:e.message};
    }
    const mismatches=assertExpect(result,c.expect,c.operation);
    results.push({id:c.id,operation:c.operation,passed:mismatches.length===0,mismatches,...result});
  }
  const passed=results.filter(r=>r.passed).length;
  const statusCounts=Object.fromEntries([...statuses].map(s=>[s,results.filter(r=>r.status===s).length]));
  return {schema_version:'1.0',passed:passed===results.length,
    summary:{total:results.length,passed,failed:results.length-passed,statusCounts},cases:results};
}
export function formatBatch(report) {
  const lines=['BATCH '+(report.passed?'PASS':'FAIL')+' — '+report.summary.passed+'/'+report.summary.total+' 案例符合預期',''];
  for(const c of report.cases) {
    lines.push((c.passed?'PASS':'FAIL')+' '+c.id+' / '+c.status+' / '+(c.size??'-')+'×'+(c.size??'-')+' / '+c.entryCount+' 題');
    lines.push(...c.mismatches.map(m=>'  '+m));
    if(c.message) lines.push('  '+c.message);
    const quality=c.selection_quality??c.pipeline_report?.solver_result?.selection_quality;
    const warnings=c.selection_warnings??c.pipeline_report?.solver_result?.selection_warnings;
    if(quality)lines.push(...formatSelection(quality,warnings).split('\n').map(line=>'  '+line));
    if(c.pipeline_report?.quality_summary?.anchor_coverage) {
      const coverage=c.pipeline_report.quality_summary.anchor_coverage;
      lines.push('  本期合格重點新聞涵蓋：'+coverage.covered+'/'+coverage.required);
      for(const e of c.pipeline_report.quality_summary.missing_anchors)lines.push('  Anchor 未入盤：'+e.title);
    }
    if(c.pipeline_report) {
      const p=c.pipeline_report; lines.push('  事件合格 '+p.event_summary.admitted+' / 候選合格 '+p.candidate_summary.admitted+' / 內容待複核');
      for(const a of p.candidate_reports.filter(x=>!x.passed)) lines.push('  排除 '+(a.word??a.candidate_id)+': '+a.errors.map(e=>e.code+' '+e.message).join('；'));
    }
    for(const v of c.validation?.checks??[]) if(!v.pass) lines.push('  '+v.id+' FAIL: '+v.errors.join('；'));
    for(const s of c.validation?.structural??[]) lines.push('  STRUCTURE FAIL: '+s);
    for(const w of c.analysis?.warnings??[]) lines.push('  '+w.code+': '+w.message);
  }
  return lines.join('\n');
}