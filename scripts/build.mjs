import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=async p=>readFile(new URL(p,root),'utf8');
let html=await read('web/index.html');const css=await read('web/style.css');
const sources=await Promise.all(['src/core.mjs','src/zip.mjs','web/demo-data.mjs','web/app.mjs'].map(read));
const js=sources.map(s=>s.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
if(js.toLowerCase().includes('</script'))throw Error('Embedded script close found');
html=html.replace('<link rel="stylesheet" href="style.css">',()=>`<style>${css}</style>`).replace('<script type="module" src="app.mjs"></script>',()=>`<script type="module">${js}</script>`);
await mkdir(new URL('dist/',root),{recursive:true});await writeFile(new URL('dist/port-rewire.html',root),html);console.log(`Built ${Buffer.byteLength(html)}-byte offline HTML`);
