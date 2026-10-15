export type BlurStatus =
  | "off"
  | "loading"
  | "active"
  | "unsupported"
  | "failed"
  | "slow";
export type BlurFailure = Extract<
  BlurStatus,
  "unsupported" | "failed" | "slow"
>;

export class BlurPipelineError extends Error {
  constructor(
    public readonly reason: BlurFailure,
    message: string,
  ) {
    super(message);
    this.name = "BlurPipelineError";
  }
}

/**
 * Guardrail, not a benchmark result: eight frames over 100ms means blur is
 * spending sustained time below 10fps. Ignore the first three warmup frames.
 */
export function blurFrameHealth(
  previous: { frames: number; slowFrames: number },
  elapsedMs: number,
) {
  const frames = previous.frames + 1;
  const slowFrames =
    frames > 3 && elapsedMs > 100 ? previous.slowFrames + 1 : 0;
  return { frames, slowFrames, shouldStop: slowFrames >= 8 };
}

export function blurFailure(error: unknown): {
  status: BlurFailure;
  problem: string;
} {
  if (error instanceof BlurPipelineError) {
    return { status: error.reason, problem: error.message };
  }
  return {
    status: "failed",
    problem: "Background blur could not start. Your camera is still on.",
  };
}
