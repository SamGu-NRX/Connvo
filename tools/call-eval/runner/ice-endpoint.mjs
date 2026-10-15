/** Local-only deployment env changes for H-17. Values never reach command output. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runConvexCommand } from "../scripts/local-backend-process.mjs";
import { selectedLocalBackend } from "../scripts/local-backend-core.mjs";
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(cwd, "node_modules/convex/bin/main.js");
/** @param {Record<string, string>} values */
export async function setLocalIceEnvironment(values) {
  const target = selectedLocalBackend({ cwd, env: process.env });
  const env = { ...process.env, CONVEX_DEPLOYMENT: target.deployment };
  /** @param {string[]} args */
  const command = (args) => {
    const result = runConvexCommand({ node: process.execPath, cli, cwd, env, args });
    if (result.status !== 0) throw new Error("Local ICE environment command failed.");
    return (result.stdout ?? "").trim();
  };
  const names = ["TURN_CLOUDFLARE_KEY_ID", "TURN_CLOUDFLARE_API_TOKEN", "TURN_SHARED_SECRET", "TURN_URLS"];
  const previous = new Map(names.map((name) => [name, command(["env", "get", name])]));
  const restore = async () => {
    for (const name of names) {
      const old = previous.get(name);
      command(old ? ["env", "set", name, old] : ["env", "remove", name]);
    }
  };
  try {
    for (const name of names) command(values[name] ? ["env", "set", name, values[name]] : ["env", "remove", name]);
  } catch (error) { await restore(); throw error; }
  return restore;
}
