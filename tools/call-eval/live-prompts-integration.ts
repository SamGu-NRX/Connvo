/** Local-backend acceptance check. Never connects to a hosted deployment. */
import assert from "node:assert/strict";
import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

async function main() {
  const state = JSON.parse(
    readFileSync("tools/call-eval/out/state.json", "utf8"),
  );
  const config = JSON.parse(
    readFileSync(".convex/local/default/config.json", "utf8"),
  );
  const url = new URL(state.convexUrl);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(Number(url.port), config.ports.cloud);
  const meetingId = state.meetingId as Id<"meetings">;
  const key = createPrivateKey({
    key: JSON.parse(
      readFileSync("tools/call-eval/.local/keys/private.jwk.json", "utf8"),
    ),
    format: "jwk",
  });
  const token = (who: string) => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const body = `${encode({ alg: "RS256", typ: "JWT", kid: "connvo-local-test-1" })}.${encode({ sub: `local-test-${who.toLowerCase()}`, iss: "https://connvo-local-test.invalid", aud: "client_connvo_local_dummy", iat: now, exp: now + 600 })}`;
    return `${body}.${createSign("RSA-SHA256").update(body).sign(key).toString("base64url")}`;
  };
  const clients = ["A", "B", "O"].map((who) => {
    const client = new ConvexClient(url.origin, { logger: false });
    client.setAuth(async () => token(who));
    return client;
  });
  const [a, b, outsider] = clients;
  const observations: Array<{
    peer: string;
    content: string | null;
    paused: boolean;
    used: boolean;
  }> = [];
  const unsubscribe = [a, b].map((client, index) =>
    client.onUpdate(api.prompts.live.current, { meetingId }, (view) => {
      observations.push({
        peer: index === 0 ? "A" : "B",
        content: view.prompt?.content ?? null,
        paused: view.autoPaused,
        used: view.prompt?.used ?? false,
      });
    }),
  );
  try {
    const before = await a.query(api.prompts.live.current, { meetingId });
    assert.equal(
      before.prompt,
      null,
      "Use a freshly seeded meeting to keep this check bounded",
    );
    const start = performance.now();
    const picked = await Promise.all(
      [a, b].map((client) =>
        client.action(api.prompts.live.pick, { meetingId, automatic: true }),
      ),
    );
    const latencyMs = Math.round(performance.now() - start);
    assert.equal(picked.filter((p) => p.status === "shown").length, 1);
    const view = await a.query(api.prompts.live.current, { meetingId });
    assert.ok(view.prompt);
    assert.deepEqual(
      (await b.query(api.prompts.live.current, { meetingId })).prompt,
      view.prompt,
    );
    await b.mutation(api.prompts.live.markUsed, {
      meetingId,
      promptId: view.prompt.id,
    });
    await a.mutation(api.prompts.live.pauseAuto, { meetingId, paused: true });
    assert.equal(
      (await b.query(api.prompts.live.current, { meetingId })).autoPaused,
      true,
    );
    await assert.rejects(
      outsider.action(api.prompts.live.pick, { meetingId, automatic: false }),
      /Not a meeting participant/,
    );
    await assert.rejects(
      outsider.query(api.prompts.live.current, { meetingId }),
      /Not a meeting participant/,
    );
    const history = await a.query(api.history.queries.getMeetingHistory, {
      meetingId,
    });
    assert.equal(
      history.prompts.filter((p) => p.content === view.prompt!.content).length,
      1,
    );
    const deadline = Date.now() + 5000;
    while (
      !["A", "B"].every((peer) =>
        observations.some(
          (o) =>
            o.peer === peer &&
            o.used &&
            o.paused &&
            o.content === view.prompt!.content,
        ),
      )
    ) {
      if (Date.now() > deadline)
        throw new Error("Both subscriptions did not receive shared state");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const result = {
      passed: true,
      concurrentStatuses: picked.map((p) => p.status),
      latencyMs,
      prompt: view.prompt.content,
      sharedSubscriptions: 2,
      usedInRecap: true,
      outsiderDenied: true,
      paidRequestsUpperBound: 1,
    };
    writeFileSync(
      "docs/live-prompts/integration.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result));
  } finally {
    unsubscribe.forEach((stop) => stop());
    await Promise.all(clients.map((client) => client.close()));
  }
}
void main();
