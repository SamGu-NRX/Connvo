import React from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCallNetwork } from "@/hooks/useCallNetwork";
import { NetworkStatus } from "@/components/call/NetworkStatus";
import type { NetworkQualitySnapshot } from "@/lib/call/network-quality";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function peer(rtt = 0.8) {
  let timestamp = 0;
  let parameters = {
    transactionId: "one",
    codecs: [],
    headerExtensions: [],
    rtcp: {},
    encodings: [
      { active: true, maxBitrate: 1500000, scaleResolutionDownBy: 1 },
    ],
  } as RTCRtpSendParameters;
  const sender = {
    track: { kind: "video" },
    getParameters: () => structuredClone(parameters),
    setParameters: vi.fn(async (next: RTCRtpSendParameters) => {
      parameters = next;
    }),
  };
  return {
    connectionState: "connected",
    getStats: vi.fn(
      async () =>
        new Map([
          [
            "remote",
            {
              id: "remote",
              type: "remote-inbound-rtp",
              timestamp: ++timestamp,
              roundTripTime: rtt,
            },
          ],
        ]),
    ),
    getSenders: () => [sender],
    sender,
  } as unknown as RTCPeerConnection & { sender: typeof sender };
}
it("binds real monitors to peer callbacks, adapts video and stops on peer removal/unmount", async () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useCallNetwork());
  const connection = peer();
  await act(async () => result.current.onPeerConnection("B", connection));
  expect(result.current.peers[0].quality).toBe("unknown");
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(connection.sender.setParameters).toHaveBeenCalledWith(
    expect.objectContaining({
      encodings: [
        expect.objectContaining({
          maxBitrate: 250000,
          scaleResolutionDownBy: 2,
        }),
      ],
    }),
  );
  expect(result.current.peers[0].adaptation).toBe("applied");
  await act(async () => result.current.onPeerConnection("B", null));
  const calls = vi.mocked(connection.getStats).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(result.current.peers).toEqual([]);
  expect(connection.getStats).toHaveBeenCalledTimes(calls);
  const replacement = peer(0.1);
  await act(async () => result.current.onPeerConnection("B", replacement));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(result.current.peers[0].quality).toBe("good");
  vi.mocked(replacement.getStats).mockRejectedValue(
    new Error("Stats unavailable"),
  );
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(result.current.peers[0]).toMatchObject({
    quality: "unknown",
    error: { stage: "stats", message: "Stats unavailable" },
  });
  unmount();
  await vi.advanceTimersByTimeAsync(6000);
  expect(replacement.getStats).toHaveBeenCalledTimes(3);
});
it("announces the weakest peer and distinguishes applied reduction from unavailable adaptation", () => {
  const good: NetworkQualitySnapshot = {
    quality: "good",
    tier: "full",
    sample: { packetLossRatio: 0, roundTripTimeMs: 50 },
    adaptation: "applied",
    error: null,
  };
  const poor: NetworkQualitySnapshot = {
    ...good,
    quality: "poor",
    tier: "low",
  };
  const { rerender } = render(<NetworkStatus peers={[good, poor]} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Poor connection. Video quality reduced",
  );
  expect(screen.getByRole("status")).toHaveAttribute(
    "data-video-reduced",
    "true",
  );
  rerender(<NetworkStatus peers={[{ ...poor, adaptation: "unsupported" }]} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Automatic video quality is unavailable",
  );
  expect(screen.getByRole("status")).toHaveAttribute(
    "data-video-reduced",
    "false",
  );
  rerender(<NetworkStatus peers={[]} />);
  expect(screen.getByRole("status")).toHaveTextContent("Checking connection");
});
it("reports good only when every peer has healthy measurements", () => {
  const good: NetworkQualitySnapshot = {
    quality: "good",
    tier: "full",
    sample: { packetLossRatio: 0, roundTripTimeMs: 50 },
    adaptation: "applied",
    error: null,
  };
  const unknown: NetworkQualitySnapshot = {
    ...good,
    quality: "unknown",
    sample: { packetLossRatio: null, roundTripTimeMs: null },
  };
  const { rerender } = render(<NetworkStatus peers={[good, unknown]} />);
  expect(screen.getByRole("status")).toHaveAttribute("data-quality", "unknown");
  expect(screen.getByRole("status")).toHaveTextContent("Checking connection");
  rerender(
    <NetworkStatus
      peers={[
        { ...unknown, error: { stage: "stats", message: "Stats unavailable" } },
        good,
      ]}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Connection data unavailable",
  );
  rerender(<NetworkStatus peers={[unknown, { ...good, quality: "poor" }]} />);
  expect(screen.getByRole("status")).toHaveTextContent("Poor connection");
  rerender(<NetworkStatus peers={[good, good]} />);
  expect(screen.getByRole("status")).toHaveTextContent("Good connection");
});
