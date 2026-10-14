// These probes execute only the synthetic CLI fixture, never Convex.
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { convexRun } from "./convex-signaling.mjs";
import {
  pickConvexUrlFromEnvText,
  selectedLocalBackend,
} from "../scripts/local-backend-core.mjs";
/** @type {string[]} */
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), "connvo-target-"));
  dirs.push(cwd);
  mkdirSync(path.join(cwd, ".convex/local/default"), { recursive: true });
  writeFileSync(
    path.join(cwd, ".convex/local/default/config.json"),
    JSON.stringify({
      deploymentName: "anonymous-probe",
      ports: { cloud: 3210 },
    }),
  );
  const cli = path.join(cwd, "convex");
  const output = path.join(cwd, "spawn.json");
  writeFileSync(
    cli,
    `import {writeFileSync} from 'node:fs';
    writeFileSync(${JSON.stringify(output)},JSON.stringify({noKey:process.env.CONVEX_DEPLOY_KEY==='', noHook:!process.env.BASH_ENV, deployment:process.env.CONVEX_DEPLOYMENT, args:process.argv.slice(2)}));
    console.log('{"meetingId":"synthetic-meeting"}');`,
  );
  return {
    cwd,
    cli,
    output,
    env: {
      HOME: cwd,
      PATH: cwd,
      CONVEX_DEPLOYMENT: "local:anonymous-probe",
      NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210",
    },
  };
}
it("refuses cloud or mismatched URLs before a probe or runner spawn", () => {
  const f = fixture();
  expect(selectedLocalBackend(f)).toEqual({
    deployment: "anonymous:anonymous-probe",
    url: "http://127.0.0.1:3210",
  });
  expect(pickConvexUrlFromEnvText("CONVEX_URL=http://127.0.0.1:3210\nNEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210")).toEqual({source: "NEXT_PUBLIC_CONVEX_URL", value: "http://127.0.0.1:3210"});
  for (const url of [
    "https://synthetic-cloud.convex.cloud",
    "http://127.0.0.1:9999",
    "http://localhost:3210",
  ]) {
    expect(() =>
      convexRun(
        "devEval/callMeeting:create",
        {},
        { ...f, env: { ...f.env, NEXT_PUBLIC_CONVEX_URL: url } },
      ),
    ).toThrow();
  }
  expect(existsSync(f.output)).toBe(false);
  expect(() =>
    pickConvexUrlFromEnvText(
      "NEXT_PUBLIC_CONVEX_URL=https://synthetic-cloud.convex.cloud\nCONVEX_URL=http://127.0.0.1:3210",
    ),
  ).toThrow();
  expect(() =>
    selectedLocalBackend({
      ...f,
      env: { ...f.env, CONVEX_URL: "http://127.0.0.1:9999" },
    }),
  ).toThrow();
});
it("runner rejects inherited keys and sends only checked settings to a fake convex on PATH", () => {
  const f = fixture();
  expect(() =>
    convexRun(
      "devEval/callMeeting:create",
      {},
      { ...f, env: { ...f.env, CONVEX_DEPLOY_KEY: "synthetic-cloud-key" } },
    ),
  ).toThrow(/CONVEX_DEPLOY_KEY/);
  expect(existsSync(f.output)).toBe(false);
  expect(
    convexRun(
      "devEval/callMeeting:create",
      { title: "literal; no shell" },
      { ...f, env: { ...f.env, BASH_ENV: "/synthetic/startup" } },
    ),
  ).toBe('{"meetingId":"synthetic-meeting"}\n');
  expect(JSON.parse(readFileSync(f.output, "utf8"))).toEqual({
    noKey: true,
    noHook: true,
    deployment: "anonymous:anonymous-probe",
    args: [
      "run",
      "devEval/callMeeting:create",
      '{"title":"literal; no shell"}',
    ],
  });
});
