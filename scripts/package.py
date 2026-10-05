#!/usr/bin/env python3
"""Deterministic source archive and SHA-256 inventory; excludes test toolchains."""
import hashlib,json,pathlib,sys,zipfile
root=pathlib.Path(__file__).resolve().parents[1]
out=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else root/'artifacts'/'release'
out.mkdir(parents=True,exist_ok=True)
excluded={'.git','node_modules','artifacts','__pycache__','.DS_Store'}
files=sorted(p for p in root.rglob('*') if p.is_file() and not any(part in excluded for part in p.relative_to(root).parts) and not p.name.endswith('.pyc'))
manifest={'schema':'port-rewire/source-manifest-1','files':[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
archive=out/'port-rewire-source.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in files:
  info=zipfile.ZipInfo(str(p.relative_to(root)),(2026,10,5,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,p.read_bytes())
manifest['archive']={'name':archive.name,'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
(out/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for source,name in [(root/'dist'/'port-rewire.html','port-rewire.html'),(root/'artifacts'/'demo.zip','port-rewire-example.zip')]:
 if source.exists():(out/name).write_bytes(source.read_bytes())
print(json.dumps({'files':len(files),'archive':manifest['archive']},indent=2))
