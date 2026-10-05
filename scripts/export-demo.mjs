import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createPlan,applyPlan,receiptText} from '../src/core.mjs';
import {zipFiles} from '../src/zip.mjs';
const root=new URL('../',import.meta.url), read=async path=>readFile(new URL(path,root),'utf8');
const manifest=JSON.parse(await read('fixtures/manifest.json'));
export const demo={oldModule:{name:'triplet.pd',text:await read(manifest.oldModule)},newModule:{name:'triplet.pd',text:await read(manifest.newModule)},callers:[...await Promise.all(manifest.callers.map(async c=>({name:c.name,text:await read(c.source)}))),{name:'triplet-extra.pd',text:await read(manifest.support[0])}],inputMap:manifest.inputMap,outputMap:manifest.outputMap};
await writeFile(new URL('web/demo-data.mjs',root),`export const DEMO = ${JSON.stringify(demo)};\n`);
for(const [name,maps] of [['demo',{}],['identity',{inputMap:[0,1,2],outputMap:[0,1]}]]){
 const a={...demo,...maps},plan=await createPlan(a),r=await applyPlan({...a,plan}),files=[...r.files,{name:'migration.json',text:JSON.stringify(plan,null,2)+'\n'},{name:'receipt.json',text:JSON.stringify(r.receipt,null,2)+'\n'},{name:'receipt.txt',text:receiptText(r)}],out=new URL(`artifacts/${name}/`,root);
 await mkdir(out,{recursive:true});for(const f of files)await writeFile(new URL(f.name,out),f.text);await writeFile(new URL(`artifacts/${name}.zip`,root),zipFiles(files));
 console.log(`${name}: ${r.receipt.selectedInstances} instances, ${r.receipt.changedConnections} connections, ${r.receipt.changedTokens} tokens`);
}
