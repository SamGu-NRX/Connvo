import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { CallRoom } from "@/components/call/CallRoom";
import type { CallTransport, TransportEvents } from "@/lib/call/transport";

// Browser capture is outside this test; the real controls update hook state.
vi.mock("@/hooks/useLocalMedia", async () => {
  const { useState } = await import("react");
  const start = async () => {};
  return {
    useLocalMedia() {
      const [micOn, setMicOn] = useState(true);
      const [cameraOn, setCameraOn] = useState(true);
      return {
        status: "ready",
        problem: null,
        stream: null,
        version: 0,
        micOn,
        cameraOn,
        screenSharing: false,
        screenTrack: null,
        screenSupported: true,
        screenProblem: null,
        setScreenSharing: async () => {},
        audioOnly: false,
        devices: { audioinput: [], videoinput: [] },
        selected: { audioinput: null, videoinput: null },
        start,
        setMicOn,
        setCameraOn,
        selectDevice: async () => {},
        release: () => {},
      };
    },
  };
});

test("joining publishes the current controls after a delayed credential request", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const publishLocalState = vi.fn<CallTransport["publishLocalState"]>();
  const transport: CallTransport = {
    name: "p2p",
    connect: async (_context, events: TransportEvents) => {
      events.onPhase("joining");
      await pending;
      events.onPhase("connected");
    },
    publishLocalStream: vi.fn(),
    publishLocalState,
    leave: async () => {},
  };
  render(
    <CallRoom
      meetingId="meeting"
      self={{ id: "A", name: "Alex" }}
      createTransport={async () => transport}
      identityToken={async () => ""}
      nameFor={(id) => id}
      exitHref="/app"
      inviteLink={() => "https://example.test/call"}
    />,
  );
  fireEvent.click(screen.getByTestId("join-call"));
  await act(async () => {});
  fireEvent.click(screen.getByTestId("toggle-mic"));
  fireEvent.click(screen.getByTestId("toggle-camera"));
  await act(async () => {
    finish();
    await pending;
  });
  expect(publishLocalState).toHaveBeenLastCalledWith({
    micOn: false,
    cameraOn: false,
    screenSharing: false,
  });
  expect(document.querySelector("[data-call-phase]")).toHaveAttribute(
    "data-call-phase",
    "connected",
  );
});
