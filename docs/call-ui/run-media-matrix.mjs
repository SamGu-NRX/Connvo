// Real-page acceptance matrices after merging alpha, with the app on :3105.
import fs from "node:fs/promises";
import { runScenarios } from "../../tools/call-eval/runner/run.mjs";
for (const [suite, count] of [["H",6],["P",5]]) {
 const result = await runScenarios({
  transports:["p2p"], scenarios:Array.from({length:count},(_,i)=>`${suite}-${String(i+1).padStart(2,"0")}`),
  seeds:[1,2,3],baseUrl:"http://localhost:3105",page:"real",write:false,
 });
 await fs.writeFile(`docs/call-ui/verification/${suite.toLowerCase()}-final.json`,JSON.stringify(result,null,2)+"\n");
 const passed=result.results.filter(item=>item.pass).length;
 console.log(`${suite}: ${passed}/${result.results.length} passed`);
 if(passed!==result.results.length)process.exitCode=1;
}
