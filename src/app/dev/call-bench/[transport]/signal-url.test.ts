// @vitest-environment node
//
// The runner hands the spawned signaling server's address to the bench page
// as an additive `?signal=` query param (tools/call-eval/runner/
// reference-signaling.mjs). Only ws:// URLs are accepted; everything else is
// treated as absent so the transport falls back to its env default.
import { describe, expect, it } from "vitest";

import { signalUrlFromParam } from "./signal-url";

describe("signalUrlFromParam", () => {
  it("accepts ws:// URLs and normalizes them", () => {
    expect(signalUrlFromParam("ws://127.0.0.1:9305")).toBe("ws://127.0.0.1:9305/");
    expect(signalUrlFromParam("ws://localhost:9310")).toBe("ws://localhost:9310/");
  });

  it("takes the first value of a repeated param", () => {
    expect(signalUrlFromParam(["ws://127.0.0.1:9302", "ws://127.0.0.1:9303"])).toBe(
      "ws://127.0.0.1:9302/",
    );
  });

  it("rejects non-ws schemes", () => {
    expect(signalUrlFromParam("wss://127.0.0.1:9301")).toBeNull();
    expect(signalUrlFromParam("http://127.0.0.1:9301")).toBeNull();
    expect(signalUrlFromParam("https://evil.example/call")).toBeNull();
    expect(signalUrlFromParam("file:///etc/passwd")).toBeNull();
  });

  it("treats garbage and absence as no override", () => {
    expect(signalUrlFromParam("not a url")).toBeNull();
    expect(signalUrlFromParam("::")).toBeNull();
    expect(signalUrlFromParam(undefined)).toBeNull();
    expect(signalUrlFromParam("")).toBeNull();
    expect(signalUrlFromParam([])).toBeNull();
  });
});
