// Compare compiler diagnostics with alpha without modifying either checkout.
import ts from "typescript";
import path from "node:path";
import fs from "node:fs/promises";
import {execFileSync} from "node:child_process";
const base=process.argv[2] ?? "6c0ae81045d02bcc9501221e39b00f5591ee93dd";
const cwd=process.cwd();
const config=ts.readConfigFile("tsconfig.json",ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,cwd);
const changed=execFileSync("git",["diff","--name-only",base,"--"],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
const originals=new Map(changed.map(file=>{
 try {return [path.resolve(file),execFileSync("git",["show",`${base}:${file}`],{encoding:"utf8",stdio:["ignore","pipe","ignore"]})];}
 catch {return [path.resolve(file),null];}
}));
function check(previous){
 const host=ts.createCompilerHost(parsed.options);
 const read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 if(previous){
  host.readFile=file=>originals.has(file)?originals.get(file)??undefined:read(file);
  host.fileExists=file=>originals.has(file)?originals.get(file)!==null:exists(file);
  host.getSourceFile=(file,version)=>{const text=host.readFile(file);return text===undefined?undefined:ts.createSourceFile(file,text,version);};
 }
 const rootNames=parsed.fileNames.filter(file=>!previous||!originals.has(file)||originals.get(file)!==null);
 return ts.getPreEmitDiagnostics(ts.createProgram({rootNames,options:{...parsed.options,incremental:false,noEmit:true},host})).map(d=>({file:d.file?path.relative(cwd,d.file.fileName):null,line:d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start).line+1:null,code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText," ")}));
}
const old=check(true),current=check(false);
const key=d=>JSON.stringify([d.file,d.code,d.message]);
const counts=new Map();for(const d of old)counts.set(key(d),(counts.get(key(d))??0)+1);
const added=current.filter(d=>{const n=counts.get(key(d))??0;if(n){counts.set(key(d),n-1);return false;}return true;});
const report={base,baseCount:old.length,currentCount:current.length,added,baseDiagnostics:old,currentDiagnostics:current};
await fs.writeFile("docs/call-ui/verification/type-baseline.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({base,baseCount:old.length,currentCount:current.length,added},null,2));
if(added.length)process.exitCode=1;
