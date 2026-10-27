#!/usr/bin/env python3
"""Build the personal APK using an existing Android SDK and a private signing key.
Never put signing keys/passwords in this repository. No deploy or network calls.
"""
import argparse,os,pathlib,subprocess,zipfile
parser=argparse.ArgumentParser()
for flag in ['build-tools','android-jar','ecj','keystore','out']:parser.add_argument('--'+flag,required=True)
args=parser.parse_args();root=pathlib.Path(__file__).resolve().parent;build=root/'build'
for d in ['classes','dex','generated']: (build/d).mkdir(parents=True,exist_ok=True)
tools=pathlib.Path(args.build_tools).resolve();android=str(pathlib.Path(args.android_jar).resolve())
def run(*cmd):subprocess.run([str(x)for x in cmd],check=True,cwd=root)
if not os.environ.get('JERICHO_PHONE_SIGNING_PASSWORD'):raise SystemExit('Set the private signing password in JERICHO_PHONE_SIGNING_PASSWORD.')
run(tools/'aapt2','compile','--dir',root/'res','-o',build/'resources.zip')
run(tools/'aapt2','link','-I',android,'--manifest',root/'AndroidManifest.xml','--min-sdk-version','26','--target-sdk-version','35','--java',build/'generated','-A',root/'assets','-o',build/'unsigned.apk',build/'resources.zip')
run('java','-jar',pathlib.Path(args.ecj).resolve(),'-8','-warn:none','-classpath',android,'-d',build/'classes',root/'src/org/insuredspending/jerichopersonal/MainActivity.java')
run(tools/'d8','--min-api','26','--lib',android,'--output',build/'dex',*sorted((build/'classes').rglob('*.class')))
with zipfile.ZipFile(build/'unsigned.apk','a')as z:
 for f in (build/'dex').glob('*.dex'):z.write(f,f.name)
run(tools/'zipalign','-f','-p','4',build/'unsigned.apk',build/'aligned.apk')
run(tools/'apksigner','sign','--ks',pathlib.Path(args.keystore).resolve(),'--ks-key-alias','jericho-personal','--ks-pass','env:JERICHO_PHONE_SIGNING_PASSWORD','--out',pathlib.Path(args.out).resolve(),build/'aligned.apk')
run(tools/'apksigner','verify','--verbose',pathlib.Path(args.out).resolve())
run(tools/'zipalign','-c','-p','4',pathlib.Path(args.out).resolve())
print('Personal APK built and signature/alignment verified. Device acceptance is still required.')
