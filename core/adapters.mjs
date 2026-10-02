import {readFile} from 'node:fs/promises';
import {collectEvents,generateCandidates,newsWindow} from './news.mjs';
import {runPipeline} from './pipeline.mjs';

export class JsonSnapshotCollector {
  constructor(path){this.path=path;}
  async collect() {
    const data=JSON.parse((await readFile(this.path,'utf8')).replace(/^\uFEFF/,''));
    const events=Array.isArray(data)?data:data.events;
    if(!Array.isArray(events))throw new Error('新聞快照需為 events 陣列或含 events 的物件');
    return events;
  }
}
export class StructuredCandidateGenerator {
  async generate(events){return generateCandidates(events);}
}
/** Every adapter output re-enters the same gates. Adapters cannot bypass Validator. */
export async function runFromAdapters(settings,{collector,candidateGenerator=new StructuredCandidateGenerator(),solverOptions={},maxClueChars=60}={}) {
  if(typeof collector?.collect!=='function'||typeof candidateGenerator?.generate!=='function')throw new Error('需提供 collector.collect 與 candidateGenerator.generate');
  const window=newsWindow(settings.issue_date);
  const events=await collector.collect(window);
  const prepared=collectEvents(events,{issueDate:settings.issue_date,fixture:settings.dataset_mode==='fixture'});
  const candidates=await candidateGenerator.generate(prepared.accepted);
  return runPipeline({...settings,events,candidates},{solverOptions,maxClueChars});
}