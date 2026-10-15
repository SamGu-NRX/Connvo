import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalMedia } from "@/hooks/useLocalMedia";
import type { CallTransport, TransportEvents } from "@/lib/call/transport";
import { CallRoom } from "@/components/call/CallRoom";
const mocks = vi.hoisted(() => ({ media: null as LocalMedia | null }));
vi.mock("@/hooks/useLocalMedia", () => ({ useLocalMedia: () => mocks.media }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function transport(): CallTransport {
  return {
    name: "test",
    connect: vi.fn(async () => {}),
    publishLocalStream: vi.fn(),
    publishLocalState: vi.fn(),
    leave: vi.fn(async () => {}),
  };
}
const props = {
  meetingId: "meeting",
  self: { id: "A", name: "Guest A" },
  identityToken: async () => "",
  nameFor: () => "Partner",
  exitHref: "/app",
  inviteLink: () => "https://example.test/call",
};
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  mocks.media = {
    status: "ready",
    problem: null,
    stream: null,
    version: 0,
    micOn: true,
    cameraOn: true,
    audioOnly: false,
    devices: { audioinput: [], videoinput: [] },
    selected: { audioinput: null, videoinput: null },
    blurEnabled: false,
    blurStatus: "off",
    blurProblem: null,
    quality: "standard",
    facing: "user",
    start: vi.fn(async () => {}),
    setMicOn: vi.fn(),
    setCameraOn: vi.fn(async () => {}),
    setBlurEnabled: vi.fn(async () => {}),
    setQuality: vi.fn(async () => {}),
    switchCamera: vi.fn(async () => {}),
    selectDevice: vi.fn(async () => {}),
    release: vi.fn(),
  };
});
describe("call room", () => {
  it("announces joins without adding a notification to the Tab order", async () => {
    const t = transport();
    let events!: TransportEvents;
    t.connect = vi.fn(async (_, next) => { events = next; });
    render(<CallRoom {...props} createTransport={async () => t} />);
    fireEvent.click(screen.getByTestId("join-call"));
    await waitFor(() => expect(t.connect).toHaveBeenCalled());
    act(() => events.onRemoteJoined({ participantId: "B" }));
    const announcement = screen.getByText("Partner joined").closest('[role="status"]');
    expect(announcement).toBeInTheDocument();
    expect(announcement!.querySelector('button, a, [tabindex]')).toBeNull();
  });
  it("keeps the network refusal and retry in the call layout", async () => {
    const t = transport();
    t.connect = vi.fn(async (_, events) => {
      events.onError({kind:"network", message:"Can't reach the other person. A network may be blocking calls. Try again or switch networks.",retryable:true});
      events.onPhase("failed");
    });
    render(<CallRoom {...props} createTransport={async () => t} />);
    fireEvent.click(screen.getByTestId("join-call"));
    await waitFor(() => expect(screen.getByTestId("call-root")).toHaveAttribute("data-call-phase","failed"));
    expect(screen.getByTestId("call-error")).toHaveTextContent("Can't reach the other person");
    expect(screen.getByTestId("retry-call")).toBeEnabled();
  });
  it("publishes current mute state when signaling finishes after a capture change", async () => {
    const connected = deferred<void>();
    const t = transport();
    t.connect = vi.fn(() => connected.promise);
    const createTransport = async () => t;
    const view = render(
      <CallRoom {...props} createTransport={createTransport} />,
    );
    fireEvent.click(screen.getByTestId("join-call"));
    await waitFor(() => expect(t.connect).toHaveBeenCalled());
    expect(screen.getByText("Connecting to the call…")).toBeInTheDocument();
    mocks.media = {
      ...mocks.media!,
      micOn: false,
      cameraOn: false,
      version: 1,
    };
    view.rerender(<CallRoom {...props} createTransport={createTransport} />);
    await act(async () => connected.resolve());
    expect(t.publishLocalState).toHaveBeenLastCalledWith({
      micOn: false,
      cameraOn: false,
    });
  });
  it("disposes a transport created after the person has already left", async () => {
    const created = deferred<CallTransport>();
    const t = transport();
    const createTransport = vi.fn(() => created.promise);
    render(<CallRoom {...props} createTransport={createTransport} />);
    fireEvent.click(screen.getByTestId("join-call"));
    await waitFor(() => expect(createTransport).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("leave-call"));
    fireEvent.click(screen.getByTestId("leave-call-confirm"));
    await act(async () => created.resolve(t));
    expect(t.connect).not.toHaveBeenCalled();
    expect(t.leave).toHaveBeenCalledOnce();
    expect(screen.getByTestId("call-root")).toHaveAttribute(
      "data-call-phase",
      "left",
    );
  });
  it("ignores late connect events and publication after unmount", async () => {
    const connected = deferred<void>();
    const t = transport();
    let events!: TransportEvents;
    t.connect = vi.fn((_, next) => {
      events = next;
      return connected.promise;
    });
    const view = render(
      <CallRoom {...props} createTransport={async () => t} />,
    );
    fireEvent.click(screen.getByTestId("join-call"));
    await waitFor(() => expect(t.connect).toHaveBeenCalled());
    view.unmount();
    await act(async () => {
      events.onPhase("connected");
      connected.resolve();
    });
    expect(t.leave).toHaveBeenCalledOnce();
    expect(t.publishLocalStream).not.toHaveBeenCalled();
  });
  it("handles M and V outside editors and dialogs, and renders only one lobby blur control", () => {
    render(<CallRoom {...props} createTransport={async () => transport()} />);
    expect(screen.getAllByTestId("toggle-blur")).toHaveLength(1);
    fireEvent.keyDown(document.body, { key: "m" });
    fireEvent.keyDown(document.body, { key: "v" });
    expect(mocks.media!.setMicOn).toHaveBeenCalledOnce();
    expect(mocks.media!.setCameraOn).toHaveBeenCalledOnce();
    const dialog = document.createElement("dialog");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    fireEvent.keyDown(button, { key: "m" });
    expect(mocks.media!.setMicOn).toHaveBeenCalledOnce();
    dialog.remove();
  });
});
