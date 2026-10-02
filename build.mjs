import {build} from 'esbuild';
import {copyFile,mkdir,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const base=fileURLToPath(new URL('.',import.meta.url));
await mkdir(resolve(base,'dist'),{recursive:true});
for(const name of ['worker','app'])await build({entryPoints:[resolve(base,'src/'+name+'.mjs')],outfile:resolve(base,'dist/'+name+'.js'),bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,alias:{'node:crypto':resolve(base,'src/hash.mjs')}});
let bank=resolve(base,'data/auto-news.json');
try{await access(bank);}catch{throw Error('請先執行 npm run update-news 建立自動題庫');}
await copyFile(bank,resolve(base,'dist/packet.json'));
await copyFile(resolve(base,'core/reports/mixed-player.json'),resolve(base,'dist/preview.json'));
console.log('Browser build complete');
