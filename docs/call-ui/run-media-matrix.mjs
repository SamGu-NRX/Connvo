// Run after media/UI changes with the real call page on :3105.
import fs from "node:fs/promises";
import { runScenarios } from "../../tools/call-eval/runner/run.mjs";
const result = await runScenarios({
  transports: ["p2p"], scenarios: ["H-01", "H-02", "H-03", "H-04", "H-05", "H-06"],
  seeds: [1, 2, 3], baseUrl: "http://localhost:3105", page: "real", write: false,
});
await fs.writeFile("docs/call-ui/verification/h-final.json", JSON.stringify(result, null, 2) + "\n");
const passed = result.results.filter(item => item.pass).length;
console.log(`${passed}/${result.results.length} passed`);
if (passed !== result.results.length) process.exitCode = 1;
