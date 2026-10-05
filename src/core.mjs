/* PortRewire: own-source bounded Pd text parser. Never executes patch contents. */
export const LIMITS = Object.freeze({fileBytes: 524288, totalBytes: 4194304, callers: 20, records: 20000, depth: 32, ports: 64, instances: 512, connections: 5000});
const enc = new TextEncoder();
export class RewireError extends Error { constructor(code, detail='') { super(detail || code); this.name='RewireError'; this.code=code; } }
const fail = (code, detail) => { throw new RewireError(code, detail); };
export function textFromBytes(bytes) {
  if (bytes.byteLength > LIMITS.fileBytes) fail('LIMIT', 'File exceeds 512 KiB');
  try { return new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes); } catch { fail('ENCODING','Use valid UTF-8 Pd files'); }
}
export function validText(text) {
  if (typeof text !== 'string' || enc.encode(text).length > LIMITS.fileBytes) fail('LIMIT','File exceeds 512 KiB');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uFEFF]/u.test(text) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) fail('ENCODING','Unsupported control or invalid Unicode');
  return text;
}
export async function sha256(text) { return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',enc.encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function atoms(text,start,end) {
  const out=[]; let i=start;
  while(i<end) {
    while(i<end && /[ \t\r\n]/.test(text[i])) i++;
    if(i>=end) break;
    const a=i; let value='', escaped=false;
    if(text[i]===',') { out.push({raw:',',value:',',start:i,end:++i}); continue; }
    while(i<end && !/[ \t\r\n]/.test(text[i]) && text[i]!==',') {
      if(text[i]==='\\') { if(i+1>=end) fail('RECORD','Dangling escape'); escaped=true; value+=text[i+1]; i+=2; }
      else value+=text[i++];
    }
    const raw=text.slice(a,i);
    if(enc.encode(raw).length>=1000) fail('ATOM','Atoms must be shorter than 1000 UTF-8 bytes');
    out.push({raw,value,start:a,end:i,escaped});
  }
  return out;
}
function records(text) {
  const result=[]; let start=0, escape=false;
  for(let i=0;i<text.length;i++) {
    if(escape) {escape=false; continue;}
    if(text[i]==='\\') {escape=true;continue;}
    if(text[i]===';') {
      const tokens=atoms(text,start,i); if(!tokens.length) fail('RECORD','Empty record');
      result.push({start,end:i+1,tokens,number:result.length+1}); start=i+1;
      if(result.length>LIMITS.records) fail('LIMIT','Too many records');
    }
  }
  if(/[^ \t\r\n]/.test(text.slice(start))) fail('RECORD','Unterminated record');
  if(!result.length) fail('RECORD','Empty patch'); return result;
}
const int = (t, max=1000000, signed=false) => {
  if(!t || t.escaped || !(signed?/^-?\d+$/:/^\d+$/).test(t.raw) || !Number.isSafeInteger(Number(t.raw)) || Math.abs(Number(t.raw))>max) fail('INDEX','Invalid integer');
  return Number(t.raw);
};
function coordinate(t) {
  if(!t||t.escaped||! /^-?\d+$/.test(t.raw)||!Number.isInteger(Number(t.raw))||Number(t.raw)<-32768||Number(t.raw)>32767) fail('COORDINATE','Graphical coordinates must fit signed 16-bit pixels');
  return Number(t.raw);
}
function contentTokens(t) { // Pd's optional ", f N" is presentation metadata, not an argument.
  const comma=t.findIndex(a=>a.raw===',');
  if(comma===-1) return t;
  if(comma!==t.length-3 || t[comma+1].raw!=='f') fail('RECORD','Unsupported object metadata');
  int(t[comma+2],10000); return t.slice(0,comma);
}
export function parsePatch(text) {
  validText(text); const list=records(text), canvases=[], stack=[]; let root;
  for(const r of list) {
    const t=r.tokens, v=t.map(a=>a.value), lead=v[0], kind=v[1];
    if(t[0].escaped || t[1]?.escaped) fail('RECORD','Escaped record selectors are unsupported');
    if(lead==='#N' && kind==='canvas') {
      if((!root && t.length!==7) || (root && t.length!==8)) fail('CANVAS','Unsupported canvas header');
      for(let i=2;i<=5;i++) int(t[i],1000000,true);
      if(root) int(t[7],1); else int(t[6],100);
      const parent=stack.at(-1);
      if(root && !parent) fail('CANVAS','Multiple root canvases');
      if(stack.length>=LIMITS.depth) fail('LIMIT','Canvas nesting too deep');
      const c={id:parent?`${parent.id}/${parent.objects.length}`:'root',label:parent?v[6]:'root',objects:[],connections:[],record:r,parent:parent?.id ?? null};
      canvases.push(c);stack.push(c);root??=c;continue;
    }
    const c=stack.at(-1); if(!c || lead!=='#X') fail('RECORD',`Unsupported record ${lead} ${kind}`);
    if(kind==='restore') {
      const q=contentTokens(t);
      if(stack.length<2 || q.length!==6 || q[4].raw!=='pd' || q[5].value!==c.label) fail('CANVAS','Malformed canvas restore');
      coordinate(q[2]); coordinate(q[3]);
      stack.pop(); const parent=stack.at(-1);
      parent.objects.push({kind:'restore',index:parent.objects.length,record:r,child:c.id,connectable:true,x:Number(q[2].raw),y:Number(q[3].raw)});continue;
    }
    if(kind==='connect') {
      if(t.length!==6) fail('RECORD','Malformed connection');
      const [source,outlet,target,inlet]=t.slice(2).map(a=>int(a,65535));
      if(!c.objects[source]?.connectable||!c.objects[target]?.connectable) fail('INDEX','Connection endpoints must already exist in the current canvas');
      c.connections.push({record:r,source,outlet,target,inlet});continue;
    }
    if(kind==='coords') {
      if(t.length<9 || t.length>11 || t.slice(2).some(a=>a.escaped || !/^-?\d+(?:\.\d+)?$/.test(a.raw) || !Number.isFinite(Number(a.raw)))) fail('RECORD','Unsupported coords');
      continue;
    }
    if(kind==='f') { if(t.length!==3 || !c.objects.length) fail('RECORD','Malformed width'); int(t[2],10000); continue; }
    if(!['obj','msg','text','floatatom','symbolatom','listbox'].includes(kind)) fail('RECORD',`Unsupported #X ${kind}`);
    if(t.length<4) fail('RECORD','Object missing coordinates');
    const x=coordinate(t[2]), y=coordinate(t[3]);
    const q=contentTokens(t);
    if(kind==='obj' && q.length<5) fail('RECORD','Object missing class');
    if(['floatatom','symbolatom','listbox'].includes(kind) && (q.length<11 || q.length>13)) fail('RECORD','Unsupported atom box');
    const cls=kind==='obj'?q[4].value:null;
    if(kind==='obj'&&(q[4].escaped||q[4].raw.includes('$'))) fail('UNSUPPORTED','Escaped or parameterized object classes are unsupported');
    if(cls==='clone' || cls==='declare') fail('UNSUPPORTED',`${cls} is outside the supported subset`);
    if(kind==='msg' && q.some(a=>/^pd(?:-|$)/.test(a.value)) && q.some(a=>a.raw==='\\;')) fail('UNSUPPORTED','Dynamic canvas messages are unsupported');
    if(['s','send','r','receive'].includes(cls) && q.slice(5).some(a=>/^pd(?:-|$)/.test(a.value))) fail('UNSUPPORTED','Dynamic canvas messaging is unsupported');
    c.objects.push({kind,index:c.objects.length,record:r,x,y,className:cls,classRaw:kind==='obj'?q[4].raw:null,args:q.slice(5).map(a=>a.value),connectable:kind!=='text'});
  }
  if(stack.length!==1) fail('CANVAS','Unclosed nested canvas');
  for(const c of canvases) for(const edge of c.connections) {
    const source=c.objects[edge.source],target=c.objects[edge.target];
    if(!source || !target || !source.connectable || !target.connectable) fail('INDEX',`Invalid object index in ${c.id}`);
  }
  return {text,canvases,root,records:list};
}
export function inspectPorts(text) {
  const p=parsePatch(text), inputs=[], outputs=[];
  for(const o of p.root.objects) {
    if(o.className==='inlet~'||o.className==='outlet~') fail('SIGNAL','Signal ports are unsupported');
    if(o.className==='inlet'||o.className==='outlet') {
      if(o.args.length) fail('PORT','Only argument-free ordinary control ports are supported');
      const context=p.root.objects.filter(c=>c.kind==='text' && Math.abs(c.x-o.x)<=90 && Math.abs(c.y-o.y)<=55).map(c=>c.record.tokens.slice(4).map(a=>a.value).join(' ')).slice(0,3);
      (o.className==='inlet'?inputs:outputs).push({x:o.x,y:o.y,objectIndex:o.index,context});
    }
  }
  for(const ports of [inputs,outputs]) {
    if(ports.length>LIMITS.ports) fail('LIMIT','At most 64 ports per direction');
    ports.sort((a,b)=>a.x-b.x);
    if(ports.some((p,i)=>i && p.x===ports[i-1].x)) fail('AMBIGUOUS','Equal-X ports have ambiguous ordering');
    ports.forEach((p,index)=>p.index=index);
  }
  if(!inputs.length && !outputs.length) fail('PORT','No ordinary control ports');
  return {inputs,outputs};
}
export function validateMap(map,n,label='ports') {
  if(!Array.isArray(map)||map.length!==n||new Set(map).size!==n||Array.from(map).some(v=>!Number.isInteger(v)||v<0||v>=n)) fail('MAP',`Provide a complete bijection for ${label}`);
  return map;
}
export function filename(name) {
  if(typeof name!=='string'||!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\.pd$/.test(name)||/\.\.|\.$/.test(name)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name)) fail('FILENAME','Use a plain safe .pd filename');
  return name;
}
export function abstractionName(name) {
  filename(name); const stem=name.slice(0,-3);
  if(!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(stem)) fail('FILENAME','Use an unqualified abstraction name');
  return stem;
}
export function listInstances(text,name) {
  const patch=parsePatch(text);
  return patch.canvases.flatMap(c=>c.objects.filter(o=>o.kind==='obj'&&o.classRaw===name).map(o=>({canvas:c.id,canvasLabel:c.label,index:o.index,x:o.x,y:o.y,args:o.args})));
}
export const instanceKey = (file,instance) => `${file}::${instance.canvas}::${instance.index}`;
function sourceCheck(oldModule,newModule,callers) {
  filename(oldModule?.name);filename(newModule?.name); const name=abstractionName(oldModule.name);
  if(!Array.isArray(callers)||!callers.length||callers.length>LIMITS.callers) fail('LIMIT','Choose 1–20 caller files');
  const names=new Set([oldModule.name.toLowerCase()]); let size=enc.encode(validText(oldModule.text)).length+enc.encode(validText(newModule.text)).length;
  for(const file of callers) { filename(file?.name); if(names.has(file.name.toLowerCase())) fail('FILENAME','Output filenames collide'); names.add(file.name.toLowerCase());size+=enc.encode(validText(file.text)).length; }
  if(size>LIMITS.totalBytes) fail('LIMIT','Bundle exceeds 4 MiB');
  if(callers.reduce((n,f)=>n+listInstances(f.text,name).length,0)>LIMITS.instances) fail('LIMIT','At most 512 matching instances per bundle');
  if(callers.reduce((n,f)=>n+parsePatch(f.text).canvases.reduce((m,c)=>m+c.connections.length,0),0)>LIMITS.connections) fail('LIMIT','At most 5000 connections per bundle');
  const oldPorts=inspectPorts(oldModule.text),newPorts=inspectPorts(newModule.text);
  if(oldPorts.inputs.length!==newPorts.inputs.length||oldPorts.outputs.length!==newPorts.outputs.length) fail('COUNT','Port counts must stay equal');
  return {name,oldPorts,newPorts};
}
export async function createPlan({oldModule,newModule,callers,inputMap,outputMap,selected}) {
  const {name,oldPorts,newPorts}=sourceCheck(oldModule,newModule,callers);
  validateMap(inputMap,oldPorts.inputs.length,'inputs');validateMap(outputMap,oldPorts.outputs.length,'outputs');
  const available=callers.flatMap(file=>listInstances(file.text,name).map(i=>instanceKey(file.name,i)));
  if(available.length>LIMITS.instances) fail('LIMIT','At most 512 matching instances per bundle');
  const chosen=selected===undefined?available:selected;
  if(!Array.isArray(chosen)||!chosen.length||new Set(chosen).size!==chosen.length||chosen.some(k=>!available.includes(k))) fail('SELECTION','Select valid exact-name instances');
  const plan={schema:'port-rewire/migration-1',target:name,oldModule:{name:oldModule.name,sha256:await sha256(oldModule.text)},newModule:{name:oldModule.name,sha256:await sha256(newModule.text)},inputMap:[...inputMap],outputMap:[...outputMap],callers:[]};
  for(const file of callers) plan.callers.push({name:file.name,sha256:await sha256(file.text),instances:listInstances(file.text,name).filter(i=>chosen.includes(instanceKey(file.name,i))).map(({canvas,index})=>({canvas,index}))});
  return plan;
}
const isHash = v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const recordObject = v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function validateContractShape(plan) {
  if(!recordObject(plan)||!recordObject(plan.oldModule)||!recordObject(plan.newModule)||!Array.isArray(plan.callers)) fail('PLAN','Malformed migration contract');
  for(const caller of plan.callers) {
    if(!recordObject(caller)||typeof caller.name!=='string'||!isHash(caller.sha256)||!Array.isArray(caller.instances)) fail('PLAN','Malformed caller contract');
    for(const instance of caller.instances) {
      if(!recordObject(instance)||typeof instance.canvas!=='string'||!/^root(?:\/(?:0|[1-9]\d*))*$/.test(instance.canvas)||!Number.isSafeInteger(instance.index)||instance.index<0||instance.index>65535) fail('SELECTION','Invalid instance reference');
    }
  }
}
export async function applyPlan({plan,oldModule,newModule,callers}) {
  validateContractShape(plan);
  const {name,oldPorts}=sourceCheck(oldModule,newModule,callers);
  if(!plan||plan.schema!=='port-rewire/migration-1'||plan.target!==name||plan.oldModule?.name!==oldModule.name||plan.newModule?.name!==oldModule.name||!Array.isArray(plan.callers)||plan.callers.length!==callers.length) fail('PLAN','Incompatible migration plan');
  if(!isHash(plan.oldModule.sha256)||!isHash(plan.newModule.sha256)||await sha256(oldModule.text)!==plan.oldModule.sha256||await sha256(newModule.text)!==plan.newModule.sha256) fail('HASH','Abstraction source hash does not match');
  validateMap(plan.inputMap,oldPorts.inputs.length,'inputs');validateMap(plan.outputMap,oldPorts.outputs.length,'outputs');
  const planNames=new Set(plan.callers.map(c=>c.name)); if(planNames.size!==callers.length) fail('PLAN','Duplicate caller plan');
  const files=[],changes=[]; let selectedCount=0;
  for(const file of callers) {
    const bound=plan.callers.find(c=>c.name===file.name);
    if(!bound||!isHash(bound.sha256)||await sha256(file.text)!==bound.sha256) fail('HASH',`Changed or already-migrated caller: ${file.name}`);
    if(!Array.isArray(bound.instances)) fail('SELECTION','Invalid selection');
    const available=listInstances(file.text,name),keys=bound.instances.map(i=>instanceKey(file.name,i));
    if(new Set(keys).size!==keys.length||keys.some(k=>!available.some(i=>instanceKey(file.name,i)===k))) fail('SELECTION','Selected instance no longer exists');
    selectedCount+=keys.length;
    const patch=parsePatch(file.text),edits=[];
    for(const canvas of patch.canvases) {
      const selected=new Set(bound.instances.filter(i=>i.canvas===canvas.id).map(i=>i.index));
      for(const edge of canvas.connections) {
        const before=[edge.source,edge.outlet,edge.target,edge.inlet],after=[...before];
        if(selected.has(edge.source)) { if(edge.outlet>=plan.outputMap.length) fail('INDEX','Selected outlet is out of range');after[1]=plan.outputMap[edge.outlet]; }
        if(selected.has(edge.target)) { if(edge.inlet>=plan.inputMap.length) fail('INDEX','Selected inlet is out of range');after[3]=plan.inputMap[edge.inlet]; }
        for(const i of [1,3]) if(before[i]!==after[i]) { const atom=edge.record.tokens[i+2]; edits.push({start:atom.start,end:atom.end,value:String(after[i])}); }
        if(before.some((v,i)=>v!==after[i])) changes.push({file:file.name,canvas:canvas.id,record:edge.record.number,before,after});
      }
    }
    let output=file.text;for(const edit of edits.sort((a,b)=>b.start-a.start)) output=output.slice(0,edit.start)+edit.value+output.slice(edit.end);
    files.push({name:file.name,text:output,beforeSha256:bound.sha256,afterSha256:await sha256(output),changedTokens:edits.length});
  }
  if(!selectedCount) fail('SELECTION','No selected instances');
  const contractId=await sha256(JSON.stringify(plan));
  const receipt={schema:'port-rewire/receipt-1',contractId,target:name,selectedInstances:selectedCount,changedConnections:changes.length,changedTokens:files.reduce((n,f)=>n+f.changedTokens,0),files:files.map(({text,...f})=>f),changes,limits:'Control-port wiring permutation only. No behavioral-equivalence guarantee. Imported patches were not executed.'};
  return {files:[{name:oldModule.name,text:newModule.text},...files],plan,receipt,changes};
}
export function receiptText(result) {
  const r=result.receipt;
  return `PortRewire migration receipt\nContract SHA-256: ${r.contractId}\nAbstraction: ${r.target}.pd\nSelected instances: ${r.selectedInstances}\nChanged connections: ${r.changedConnections}\nChanged endpoint tokens: ${r.changedTokens}\n\n${r.files.map(f=>`${f.name}\n  before: ${f.beforeSha256}\n  after:  ${f.afterSha256}\n  changed tokens: ${f.changedTokens}`).join('\n')}\n\n${r.changes.map(c=>`${c.file} / ${c.canvas} / record ${c.record}: ${c.before.join(' ')} -> ${c.after.join(' ')}`).join('\n')}\n\nOnly selected inlet/outlet integer tokens were rewritten. Connection order, object indices, and all other caller bytes were preserved.\nPort counts and plain control-port syntax were checked; port meaning and arbitrary behavior were not.\nKeep your originals. Load the bundle into a separate folder and verify it in your own Pd project before replacing production files.\nThe app does not execute imported patches. Native evidence uses only synthetic fixtures.\n`;
}
