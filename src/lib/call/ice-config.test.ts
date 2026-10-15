import { describe, expect, test, vi } from "vitest";
import { connectionPath, sessionIceConfiguration } from "./ice-config";

describe("call-session ICE cache", () => {
  test("deduplicates in-flight loads and refreshes before expiry", async () => {
    let now = 1000;
    const load = vi.fn(async () => ({ iceServers: [{ urls: "turn:localhost", username: "temporary", credential: "temporary" }], expiresAt: now + 3_600_000 }));
    const config = sessionIceConfiguration(load, () => now);
    await Promise.all([config(), config()]);
    expect(load).toHaveBeenCalledTimes(1);
    await config();
    expect(load).toHaveBeenCalledTimes(1);
    now += 3_570_000;
    await config();
    expect(load).toHaveBeenCalledTimes(2);
  });
  test("does not retain expired or failed responses", async () => {
    const load = vi.fn().mockResolvedValueOnce({ iceServers: [{ urls: "stun:localhost" }], expiresAt: 1000 }).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue({ iceServers: [{ urls: "stun:localhost" }], expiresAt: 100_000 });
    const config = sessionIceConfiguration(load, () => 1000);
    await expect(config()).rejects.toThrow("expired");
    await expect(config()).rejects.toThrow("unavailable");
    expect(await config()).toEqual({ iceServers: [{ urls: "stun:localhost" }] });
  });
});

test.each(["host", "relay"])("diagnostics identifies %s without exposing addresses", async (candidateType) => {
  const stats = new Map([
    ["transport", { type: "transport", selectedCandidatePairId: "pair" }],
    ["pair", { type: "candidate-pair", localCandidateId: "local", remoteCandidateId: "remote" }],
    ["local", { candidateType }], ["remote", { candidateType: "host" }],
  ]);
  const pc = { getStats: async () => stats } as unknown as RTCPeerConnection;
  expect(await connectionPath(pc)).toBe(candidateType === "relay" ? "relay" : "direct");
});
