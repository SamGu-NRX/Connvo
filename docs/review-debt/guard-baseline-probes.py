import pathlib, tempfile, subprocess, json, shutil
root=pathlib.Path(__file__).resolve().parents[2]
node=shutil.which('node')
if node is None: raise SystemExit('node is not on PATH')
# Only source extraction and synthetic binaries. Neither script can find a real CLI.
dir=pathlib.Path(tempfile.mkdtemp(prefix='c42-probe-'))
try:
 env={'HOME':str(dir),'PATH':str(dir) + ':/usr/bin:/bin','LANG':'en_US.UTF-8'}
 fake=dir/'convex'; record=dir/'record.json'
 fake.write_text(f'#!{node}\nimport {{writeFileSync}} from "node:fs";writeFileSync({json.dumps(str(record))},JSON.stringify({{keyReached:!!process.env.CONVEX_DEPLOY_KEY,hookReached:!!process.env.BASH_ENV}}));console.log("{{\\\"meetingId\\\":\\\"synthetic\\\"}}");\n');fake.chmod(0o700)
 # The actual 59c98b7 runner, with only repository location and test export added.
 text=subprocess.check_output(['git','show','59c98b7:tools/call-eval/runner/convex-signaling.mjs'],cwd=root,text=True)
 start=text.index('const REPO =');end=text.index('\nconst CONVEX_BIN',start)
 text=text[:start]+'const REPO = '+json.dumps(str(dir))+';'+text[end:]
 (dir/'node_modules/.bin').mkdir(parents=True)
 (dir/'node_modules/.bin/convex').symlink_to(fake)
 (dir/'runner.mjs').write_text(text+'\nexport {convexRun};\n')
 (dir/'probe.mjs').write_text('import {convexRun} from "./runner.mjs";convexRun("devEval/callMeeting:create",{});')
 r=subprocess.run([node,str(dir/'probe.mjs')],env={**env,'CONVEX_DEPLOYMENT':'local:anonymous-probe','CONVEX_DEPLOY_KEY':'synthetic-probe-key'},capture_output=True)
 assert r.returncode==0
 observed=json.loads(record.read_text());assert observed['keyReached']
 print('59c98b7 runner clean-environment regression: FAIL, synthetic key reached fake CLI',flush=True)
 record.unlink()
 # Extract the actual d42815eb sh + env-set functions, without importing CLI bring-up.
 text=subprocess.check_output(['git','show','d42815eb:tools/call-eval/scripts/local-backend.mjs'],cwd=root,text=True)
 start=text.index('function sh(');end=text.index('\n/**',start)
 sh=text[start:end]
 start=text.index('function runEnvSet(');end=text.index('\n}',start)+2
 npx=dir/'npx';npx.write_text('#!/bin/sh\nexec "'+str(fake)+'" "$@"\n');npx.chmod(0o700)
 startup=dir/'startup.sh';startup.write_text('export CONVEX_DEPLOY_KEY=synthetic-startup-key\n')
 (dir/'shell-probe.mjs').write_text('import {spawnSync} from "node:child_process";const REPO='+json.dumps(str(dir))+';\n'+sh+'\n'+text[start:end]+'\nrunEnvSet("SYNTHETIC","inert");')
 r=subprocess.run([node,str(dir/'shell-probe.mjs')],env={**env,'BASH_ENV':str(startup)},capture_output=True)
 assert r.returncode==0 and json.loads(record.read_text())['keyReached']
 print('d42815eb shell-injection regression: FAIL, synthetic startup key reached fake CLI',flush=True)
finally:
 shutil.rmtree(dir)
