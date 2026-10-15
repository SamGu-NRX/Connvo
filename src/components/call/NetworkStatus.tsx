"use client";
import type { NetworkQualitySnapshot } from "@/lib/call/network-quality";
import styles from "./call.module.css";

// A healthy peer cannot establish that a peer with missing stats is healthy.
const rank = { good: 0, unknown: 1, fair: 2, poor: 3 };
export function NetworkStatus({ peers }: { peers: NetworkQualitySnapshot[] }) {
  const worst = peers.reduce<NetworkQualitySnapshot | undefined>(
    (current, peer) =>
      !current || rank[peer.quality] > rank[current.quality] ? peer : current,
    undefined,
  );
  const quality = worst?.quality ?? "unknown";
  const reduced = peers.some(
    (peer) => peer.tier !== "full" && peer.adaptation === "applied",
  );
  const unavailable = peers.some(
    (peer) => peer.adaptation === "unsupported" || peer.adaptation === "failed",
  );
  const label = {
    unknown: peers.some((peer) => peer.error?.stage === "stats")
      ? "Connection data unavailable"
      : "Checking connection",
    good: "Good connection",
    fair: "Unstable connection",
    poor: "Poor connection",
  }[quality];
  const detail = unavailable
    ? "Automatic video quality is unavailable."
    : reduced
      ? "Video quality reduced to keep the call connected."
      : "Video quality adjusts to the connection.";
  return (
    <span
      className={styles.networkStatus}
      data-testid="network-status"
      data-quality={quality}
      data-video-reduced={reduced}
      role="status"
      aria-live="polite"
      title={`${label}. ${detail}`}
    >
      <span className={styles.networkDot} aria-hidden />
      <span>
        {label}
        <span className="sr-only">. {detail}</span>
      </span>
    </span>
  );
}
