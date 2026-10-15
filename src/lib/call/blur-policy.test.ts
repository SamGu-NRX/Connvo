import { describe, expect, it } from "vitest";
import { BlurPipelineError, blurFailure, blurFrameHealth } from "./blur-policy";
import { cameraConstraints } from "./camera-quality";

describe("blur frame guardrail", () => {
  it("ignores warmup, tolerates one slow frame, and stops sustained sub-10fps processing", () => {
    let health = { frames: 0, slowFrames: 0 };
    for (let frame = 0; frame < 3; frame++)
      health = blurFrameHealth(health, 500);
    expect(health).toEqual({ frames: 3, slowFrames: 0, shouldStop: false });
    health = blurFrameHealth(health, 150);
    expect(health).toEqual({ frames: 4, slowFrames: 1, shouldStop: false });
    health = blurFrameHealth(health, 30);
    expect(health).toEqual({ frames: 5, slowFrames: 0, shouldStop: false });
    for (let frame = 0; frame < 8; frame++)
      health = blurFrameHealth(health, 150);
    expect(health).toEqual({ frames: 13, slowFrames: 8, shouldStop: true });
  });

  it("reports the actual unsupported, load, or slow failure instead of claiming blur is active", () => {
    expect(
      blurFailure(new BlurPipelineError("unsupported", "No worker")),
    ).toEqual({ status: "unsupported", problem: "No worker" });
    expect(blurFailure(new BlurPipelineError("slow", "Slow video"))).toEqual({
      status: "slow",
      problem: "Slow video",
    });
    expect(blurFailure(new Error("loader"))).toEqual({
      status: "failed",
      problem: "Background blur could not start. Your camera is still on.",
    });
  });
});

describe("camera constraints", () => {
  it("uses explicit selection over facing and keeps capture rate within the selected preset", () => {
    expect(
      cameraConstraints({
        quality: "data-saver",
        deviceId: "rear",
        facing: "user",
      }),
    ).toEqual({
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 15, max: 15 },
      deviceId: { exact: "rear" },
    });
    expect(
      cameraConstraints({
        quality: "hd",
        deviceId: null,
        facing: "environment",
      }),
    ).toEqual({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 30 },
      facingMode: { ideal: "environment" },
    });
  });
});
