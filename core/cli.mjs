#!/usr/bin/env node
import {generateEditions,formatEditions} from './editions.mjs';
import {runMixed,formatMixed} from './mixed.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {dirname,resolve} from 'node:path';
import {solve} from './solver.mjs';
import {validatePuzzle} from './validator.mjs';
import {analyzeCandidates} from './analysis.mjs';
import {runBatch,formatBatch} from './batch.mjs';
import {runPipeline,formatPipeline} from './pipeline.mjs';
import {formatSelection} from './selection.mjs';
import {assessQuality,formatQuality} from './quality.mjs';
import {buildWorksheet,formatWorksheet,createAnswerTemplate,gradeAnswers,formatGrade} from './worksheet.mjs';

export function render(puzzle,report) {
  const lines=['時事填字樂 V1.0 — Core Prototype',puzzle.board.length+' × '+puzzle.board.length+' / '+puzzle.expected.length+' 題',''];
  lines.push(...puzzle.board.map(row=>row.join(' ')));
  for(const direction of ['H','V']) {
    lines.push('',direction==='H'?'橫向答案':'直向答案');
    for(const p of puzzle.placements.filter(p=>p?.direction===direction).sort((a,b)=>a.row-b.row||a.col-b.col)) {
      const c=puzzle.expected.find(c=>c.id===p.candidate_id);
      const len=Array.from(c?.word??'').length;
      const endRow=p.row+(direction==='V'?len-1:0),endCol=p.col+(direction==='H'?len-1:0);
      lines.push(direction+' '+(c?.word??p.candidate_id)+' ('+(p.row+1)+','+(p.col+1)+') → ('+(endRow+1)+','+(endCol+1)+') / 交叉 '+(report.intersections[p.candidate_id]?.length??0));
      if(c?.clue) lines.push('  '+c.clue);
    }
  }
  lines.push('','VALIDATION');
  for(const c of report.checks) {
    lines.push(c.id+' '+(c.pass?'PASS':'FAIL')+' — '+c.label);
    lines.push(...c.errors.map(e=>'  '+e));
  }
  lines.push(...report.structural.map(e=>'STRUCTURE FAIL — '+e));
  if(report.balance) {
    lines.push('字數分布：'+JSON.stringify(report.balance.counts)+' / 50% 原則：'+(report.balance.withinHalf?'PASS':'WARNING'));
    lines.push(...report.balance.warnings);
  }
  lines.push('','Puzzle Status: '+report.status);
  return lines.join('\n');
}
export function formatAnalysis(report) {
  const lines=['CANDIDATE ANALYSIS — '+report.candidateCount+' 個候選',
    '可交叉候選：'+report.crossableCount+' / 題數上限：'+report.entryUpperBound,
    '候選字數分布：'+JSON.stringify(report.lengthCounts),
    '可交叉字數分布：'+JSON.stringify(report.crossableLengthCounts),
    '共同字群組：'+report.components.length+'（允許分離的交叉組）'];
  for(const w of report.warnings) lines.push(w.code+' — '+w.message);
  for(const c of report.isolated) lines.push('無共同字：'+c.word+' ['+c.id+']');
  lines.push(report.note);
  return lines.join('\n');
}
const usage='用法：node cli.mjs solve candidates.json [--target 12] [--min 8] [--attempts 48] [--seed 1] [--out puzzle.json] [--json]\n'+
  '      node cli.mjs validate puzzle.json [--out report.json] [--json]\n'+
  '      node cli.mjs analyze candidates.json [--target 12] [--min 8] [--out report.json] [--json]\n'+
  '      node cli.mjs batch manifest.json [--out report.json] [--json]\n'+
  '      node cli.mjs pipeline news-input.json [--target 12] [--min 8] [--attempts 48] [--seed 1] [--clue-max-chars 60] [--out report.json] [--json]';
const trialUsage='\n      node cli.mjs generate input.json [--count 3] [--variant-attempts 3] [--attempts 256] [--seed 2] [--out report.json] [--json]\n      node cli.mjs mixed mixed-input.json [--attempts 256] [--seed 2] [--out report.json] [--json]\n      node cli.mjs worksheet puzzle.json [--answers] [--clue-max-chars 60] [--out worksheet.txt] [--json]\n'+
 '      node cli.mjs answer-template puzzle.json [--out answers.json]\n'+
 '      node cli.mjs grade puzzle.json answers.json [--reveal] [--out grade.json] [--json]\n'+
 '      node cli.mjs quality puzzle-or-report.json [--out quality.json] [--json]';
function parseOptions(command,rest) {
  const numeric={'--count':'count','--variant-attempts':'maxVariantAttempts','--target':'target','--min':'minEntries','--attempts':'attempts','--seed':'seed','--clue-max-chars':'maxClueChars'};
  const allowed=new Set(command==='generate'?Object.keys(numeric):command==='mixed'?['--attempts','--seed']:command==='pipeline'?Object.keys(numeric).filter(k=>!['--count','--variant-attempts'].includes(k)):command==='solve'?Object.keys(numeric).filter(k=>!['--count','--variant-attempts','--clue-max-chars'].includes(k)):command==='analyze'?['--target','--min']:['worksheet','answer-template','grade','quality'].includes(command)?['--clue-max-chars']:[]);
  const options={},seen=new Set();
  let out,json=false;
  for(let i=0;i<rest.length;i++) {
    const flag=rest[i];
    if(seen.has(flag)) throw new Error('選項重複：'+flag);
    seen.add(flag);
    if(flag==='--json'){json=true;continue;}
    if(flag==='--answers'&&command==='worksheet'){options.includeAnswers=true;continue;}
    if(flag==='--reveal'&&command==='grade'){options.reveal=true;continue;}
    if(flag!=='--out' && !allowed.has(flag)) throw new Error('此指令不支援選項：'+flag);
    const value=rest[++i];
    if(value===undefined || value.startsWith('--')) throw new Error('缺少選項值：'+flag);
    if(flag==='--out') out=value;
    else options[numeric[flag]]=Number(value);
  }
  return {options,out,json};
}
export async function main(argv) {
  const [command,input,...rest]=argv;
  if(!['solve','validate','analyze','batch','pipeline','worksheet','answer-template','grade','quality','mixed','generate'].includes(command)||!input)throw new Error(usage+trialUsage);
  const submissionPath=command==='grade'?rest.shift():undefined;
  if(command==='grade'&&(!submissionPath||submissionPath.startsWith('--')))throw new Error(usage+trialUsage);
  const {options,out,json}=parseOptions(command,rest);
  const data=JSON.parse((await readFile(input,'utf8')).replace(/^\uFEFF/,''));
  if(command==='quality') {
    const report=assessQuality(data,{maxClueChars:options.maxClueChars??60});
    console.log(json?JSON.stringify(report,null,2):formatQuality(report));
    if(out)await writeFile(out,JSON.stringify(report,null,2)+'\n','utf8');
    return report.status==='INVALID'?1:0;
  }
  if(command==='worksheet') {
    const report=buildWorksheet(data,{includeAnswers:options.includeAnswers??false,maxClueChars:options.maxClueChars??60});
    const output=json?JSON.stringify(report,null,2):formatWorksheet(report);
    console.log(output);
    if(report.status!=='TRIAL_READY')return 1;
    if(out)await writeFile(out,output+'\n','utf8');
    return 0;
  }
  if(command==='answer-template') {
    const template=createAnswerTemplate(data,{maxClueChars:options.maxClueChars??60});
    console.log(JSON.stringify(template,null,2));
    if(template.status==='INVALID')return 1;
    if(out)await writeFile(out,JSON.stringify(template,null,2)+'\n','utf8');
    return 0;
  }
  if(command==='grade') {
    const submission=JSON.parse((await readFile(submissionPath,'utf8')).replace(/^\uFEFF/,''));
    const report=gradeAnswers(data,submission,{reveal:options.reveal??false,maxClueChars:options.maxClueChars??60});
    console.log(json?JSON.stringify(report,null,2):formatGrade(report));
    if(report.status!=='GRADED')return 1;
    if(out)await writeFile(out,JSON.stringify(report,null,2)+'\n','utf8');
    return 0;
  }
  if(command==='generate') {
    const {count=1,maxVariantAttempts=3,maxClueChars=60,...solverOptions}=options;
    const report=generateEditions(data,{count,maxVariantAttempts,maxClueChars,solverOptions});
    console.log(json?JSON.stringify(report,null,2):formatEditions(report));
    if(out)await writeFile(out,JSON.stringify(report,null,2)+'\n','utf8');
    return report.status==='COMPLETE'?0:3;
  }
  if(command==='mixed') {
    const report=runMixed(data,{solverOptions:options});
    console.log(json?JSON.stringify(report,null,2):formatMixed(report)+(report.puzzle?'\n\n'+render(report.puzzle,report.grid_validation):''));
    if(out)await writeFile(out,JSON.stringify(report,null,2)+'\n','utf8');
    return report.status==='REVIEW_REQUIRED'?0:2;
  }
  if(command==='pipeline') {
    const {maxClueChars=60,...solverOptions}=options;
    const report=runPipeline(data,{solverOptions,maxClueChars});
    console.log(json?JSON.stringify(report,null,2):formatPipeline(report)+(report.puzzle?'\n\n'+render(report.puzzle,report.grid_validation):''));
    if(out) await writeFile(out,JSON.stringify(report,null,2)+'\n','utf8');
    return {REVIEW_REQUIRED:0,INVALID:1,SEARCH_EXHAUSTED:2,PARTIAL:3,NO_ELIGIBLE_CANDIDATES:4}[report.status]??2;
  }
  if(command==='batch') {
    const report=await runBatch(data,{baseDir:dirname(resolve(input))});
    console.log(json?JSON.stringify(report,null,2):formatBatch(report));
    if(out) await writeFile(out,JSON.stringify(report,null,2)+'\n','utf8');
    return report.passed?0:1;
  }
  if(command==='analyze') {
    const report=analyzeCandidates(Array.isArray(data)?data:data?.candidates,options);
    console.log(json?JSON.stringify(report,null,2):formatAnalysis(report));
    if(out) await writeFile(out,JSON.stringify(report,null,2)+'\n','utf8');
    return 0;
  }
  if(command==='validate') {
    const report=validatePuzzle(data);
    console.log(json || report.balance===null?JSON.stringify(report,null,2):render(data,report));
    if(out) await writeFile(out,JSON.stringify(report,null,2)+'\n','utf8');
    return report.valid?0:1;
  }
  const result=solve(Array.isArray(data)?data:data?.candidates,options);
  if(json) console.log(JSON.stringify(result,null,2));
  else {
    console.log(result.status+' — '+result.message);
    console.log('搜尋：'+JSON.stringify(result.diagnostics.map(({selection_quality,...d})=>d)));
    console.log(formatSelection(result.selection_quality,result.selection_warnings));
    console.log(formatAnalysis(result.analysis));
    if(result.puzzle) console.log(render(result.puzzle,result.validation));
    console.log('未選入候選：');
    for(const c of result.exclusions) console.log('  '+c.word+' — '+c.message);
  }
  if(result.puzzle && out) await writeFile(out,JSON.stringify(result.puzzle,null,2)+'\n','utf8');
  if(!result.puzzle) return 2;
  return result.status==='SOLVED'?0:3;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(e=>{console.error('ERROR: '+e.message);process.exitCode=2;});
}