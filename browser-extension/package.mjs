import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url));
const output=resolve(process.argv[2]||fileURLToPath(new URL('dist/IABT-Master-Control-0.1.0.zip',import.meta.url)));
const result=spawnSync('python3',['-c',String.raw`
import hashlib,json,pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1]); output=pathlib.Path(sys.argv[2]); output.parent.mkdir(parents=True,exist_ok=True)
extension=root/'browser-extension'; entries={}
for name in ['manifest.json','panel.html','panel.css','panel.js','ui.js','core.js','state.js','worker.js','page.js','native.js']:
 entries['extension/'+name]=(extension/name).read_bytes()
for path in sorted((extension/'icons').glob('*.png')): entries['extension/icons/'+path.name]=path.read_bytes()
for path in sorted((root/'native-companion'/'windows').glob('*')):
 if path.suffix in ['.cs','.ps1']: entries['windows-companion/'+path.name]=path.read_bytes()
entries['README-FIRST.md']=(extension/'README.md').read_bytes()
entries['ACCEPTANCE.md']=(root/'docs'/'IABT_MASTER_CONTROL_ACCEPTANCE.md').read_bytes()
entries['CHECKSUMS.sha256']=(''.join(hashlib.sha256(data).hexdigest()+'  '+name+'\n' for name,data in sorted(entries.items()))).encode()
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as archive:
 for name,data in sorted(entries.items()): archive.writestr(name,data)
with zipfile.ZipFile(output) as archive:
 assert archive.testzip() is None
 assert json.loads(archive.read('extension/manifest.json'))['name']=='IABT Master Control'
print(json.dumps({'file':str(output),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'files':len(entries)}))
`,root,output],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
