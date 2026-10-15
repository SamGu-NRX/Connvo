import fs from "node:fs/promises";
import { RunContext } from "../../tools/call-eval/runner/context.mjs";
import { joinPair } from "../../tools/call-eval/runner/scenario-kit.mjs";
import { scenario_P_03 } from "../../tools/call-eval/runner/scenarios-p.mjs";
const ctx = new RunContext({transport:"p2p",page:"real",baseUrl:"http://localhost:3105",warmUp:false});
const results=[];
try {
 await ctx.start();ctx.newMeeting("keyboard-diagnostic");
 const {peerA}=await joinPair(ctx);
 const page=peerA.page;
 for(let i=0;i<25;i++) {
   await page.keyboard.press("Tab");
   results.push(await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.getAttribute("data-testid"),html:document.activeElement.outerHTML.slice(0,350)})));
 }
 console.log(JSON.stringify(results,null,2));
 await ctx.closePeers();
 for (const seed of [1,2,3]) {
  ctx.newMeeting(`keyboard-${seed}`);
  results.push({seed,result:await scenario_P_03(ctx)});
 }
} catch(error) {results.push({error:error.message,stack:error.stack});process.exitCode=1;}
finally {await ctx.stop();}
await fs.writeFile("docs/call-ui/verification/keyboard.json",JSON.stringify(results,null,2)+"\n");
console.log(JSON.stringify(results.slice(25),null,2));
