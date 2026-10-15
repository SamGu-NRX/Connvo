import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import { createTestEnvironment } from "../../../test/convex/helpers";
import { iceProvider, turnRestCredential } from "../../../src/server/call/ice-provider";

afterEach(() => vi.unstubAllEnvs());

describe("ICE credentials", () => {
  test("matches RFC 2202 HMAC-SHA1 vector 2", async () => {
    expect(await turnRestCredential("Jefe", "what do ya want for nothing?")).toBe("7/zfauXrL6LSdBbV8YTfnCWafHk=");
  });
  test("uses only STUN when no provider is configured", async () => {
    expect(await iceProvider({}, () => 1_700_000_000_000).issue("member")).toEqual({
      iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }], expiresAt: 1_700_003_600_000,
    });
  });
  test("coturn username expires after one hour and password signs exactly that username", async () => {
    const result = await iceProvider({ TURN_SHARED_SECRET: "test-only-secret", TURN_URLS: "turn:localhost:3478?transport=udp,turns:localhost:5349" }, () => 1_700_000_000_999).issue("meeting:member");
    expect(result.expiresAt).toBe(1_700_003_600_000);
    expect(result.iceServers[0].username).toBe("1700003600:meeting:member");
    expect(result.iceServers[0].credential).toBe(await turnRestCredential("test-only-secret", "1700003600:meeting:member"));
  });
  test("fails loudly on partial provider settings", () => {
    expect(() => iceProvider({ TURN_SHARED_SECRET: "x" })).toThrow("TURN_SHARED_SECRET and TURN_URLS");
    expect(() => iceProvider({ TURN_CLOUDFLARE_KEY_ID: "x" })).toThrow("TURN_CLOUDFLARE_KEY_ID and TURN_CLOUDFLARE_API_TOKEN");
  });
  test("Cloudflare wins when configured and requests one-hour credentials", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ iceServers: [{ urls: ["turn:turn.cloudflare.com:3478"], username: "temporary", credential: "temporary" }] }), { status: 201 }));
    const provider = iceProvider({ TURN_CLOUDFLARE_KEY_ID: "test-key", TURN_CLOUDFLARE_API_TOKEN: "test-token", TURN_SHARED_SECRET: "x", TURN_URLS: "turn:localhost" }, () => 1000, request);
    expect((await provider.issue("member")).expiresAt).toBe(3_601_000);
    expect(request).toHaveBeenCalledWith("https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers", expect.objectContaining({ method: "POST", body: '{"ttl":3600}' }));
  });
  test("provider error never reveals its response body", async () => {
    const request = vi.fn().mockResolvedValue(new Response("private-provider-detail", { status: 403 }));
    await expect(iceProvider({ TURN_CLOUDFLARE_KEY_ID: "x", TURN_CLOUDFLARE_API_TOKEN: "x" }, Date.now, request).issue("member")).rejects.toThrow("The call connection service refused credentials. Try again.");
  });
});

test("only a meeting participant receives ICE configuration", async () => {
  for (const name of ["TURN_CLOUDFLARE_KEY_ID", "TURN_CLOUDFLARE_API_TOKEN", "TURN_SHARED_SECRET", "TURN_URLS"]) vi.stubEnv(name, "");
  const t = createTestEnvironment();
  const meetingId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { workosUserId: "ice-member", email: "member@ice.test", isActive: true, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("users", { workosUserId: "ice-outsider", email: "outsider@ice.test", isActive: true, createdAt: 1, updatedAt: 1 });
    const id = await ctx.db.insert("meetings", { organizerId: userId, title: "ICE access", state: "active", participantCount: 1, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("meetingParticipants", { meetingId: id, userId, role: "host", presence: "joined", createdAt: 1 });
    return id;
  });
  await expect(t.action(api.meetings.webrtc.ice.configuration, { meetingId })).rejects.toThrow("Authentication required");
  await expect(t.withIdentity({ subject: "ice-outsider" }).action(api.meetings.webrtc.ice.configuration, { meetingId })).rejects.toThrow("Not a meeting participant");
  expect((await t.withIdentity({ subject: "ice-member" }).action(api.meetings.webrtc.ice.configuration, { meetingId })).iceServers).toEqual([{ urls: ["stun:stun.cloudflare.com:3478"] }]);
});
