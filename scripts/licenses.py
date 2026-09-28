"""Capture installed license texts and versions without downloading arbitrary code."""
import importlib.metadata
import json
from pathlib import Path
import shutil

root=Path(__file__).resolve().parent.parent
output=root/'licenses'
output.mkdir(exist_ok=True)
manifest=json.loads((root/'frontend/package.json').read_text(encoding='utf-8-sig'))
records=[]
for name in manifest['dependencies'] | {'tailwindcss':'', 'vite':''}:
    directory=root/'frontend/node_modules'/name
    metadata=json.loads((directory/'package.json').read_text(encoding='utf-8'))
    license_files=[p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(('license','licence','notice'))]
    if not license_files:
        raise RuntimeError(f'License missing: {name}')
    target=output/name.replace('/','_').replace('@','')
    target.mkdir(exist_ok=True)
    for f in license_files:
        shutil.copy2(f,target/f.name)
    records.append({'package':name,'version':metadata['version'],'license':metadata.get('license'),'repository':metadata.get('repository')})
for name in ['fastapi','uvicorn','sqlalchemy','alembic','ortools','pydantic']:
    distribution=importlib.metadata.distribution(name)
    target=output/name
    target.mkdir(exist_ok=True)
    count=0
    for path in distribution.files or []:
        if any(part.lower().startswith(('license','licence','notice')) for part in path.parts) and distribution.locate_file(path).is_file():
            shutil.copy2(distribution.locate_file(path),target/path.name)
            count+=1
    if not count:
        raise RuntimeError(f'License missing: {name}')
    records.append({'package':name,'version':distribution.version,'license':distribution.metadata.get('License-Expression') or distribution.metadata.get('License')})
(output/'versions.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Captured licenses for {len(records)} direct packages.')
