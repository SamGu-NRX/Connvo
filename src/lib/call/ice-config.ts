export interface IceCredentials {
  iceServers: RTCIceServer[];
  expiresAt: number;
}

/** Each call-page session owns one cache; credentials never enter persistent storage. */
export function sessionIceConfiguration(
  load: () => Promise<IceCredentials>,
  now = Date.now,
) {
  let cached: IceCredentials | null = null;
  let pending: Promise<RTCConfiguration> | null = null;
  return async (): Promise<RTCConfiguration> => {
    if (cached && cached.expiresAt > now() + 30_000)
      return { iceServers: cached.iceServers };
    if (pending) return pending;
    pending = (async () => {
      const next = await load();
      if (
        !Number.isFinite(next.expiresAt) ||
        next.expiresAt <= now() + 30_000 ||
        !next.iceServers.length
      )
        throw new Error("The call connection credentials expired. Try again.");
      cached = next;
      return { iceServers: next.iceServers };
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}

/** Only candidate types leave getStats; addresses and credentials stay private. */
export async function connectionPath(
  pc: RTCPeerConnection,
): Promise<"relay" | "direct" | "unknown"> {
  const stats = await pc.getStats();
  let pair: RTCStats | undefined;
  stats.forEach((row) => {
    if (row.type === "transport" && row.selectedCandidatePairId)
      pair = stats.get(row.selectedCandidatePairId);
  });
  if (!pair)
    stats.forEach((row) => {
      if (
        row.type === "candidate-pair" &&
        row.state === "succeeded" &&
        row.nominated
      )
        pair = row;
    });
  if (!pair) return "unknown";
  const local =
    "localCandidateId" in pair && typeof pair.localCandidateId === "string"
      ? stats.get(pair.localCandidateId)
      : undefined;
  const remote =
    "remoteCandidateId" in pair && typeof pair.remoteCandidateId === "string"
      ? stats.get(pair.remoteCandidateId)
      : undefined;
  if (!local || !remote) return "unknown";
  return local.candidateType === "relay" || remote.candidateType === "relay"
    ? "relay"
    : "direct";
}

/** A participant refusal is actionable only by changing account or meeting. */
export class IceAccessError extends Error {}

/** Convex can encode structured action errors as JSON strings. */
export function isIceAccessRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  let data: unknown = error.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return false;
    }
  }
  return Boolean(
    data &&
      typeof data === "object" &&
      "code" in data &&
      (data.code === "FORBIDDEN" || data.code === "UNAUTHORIZED"),
  );
}
