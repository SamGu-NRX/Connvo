import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { ScheduleModal } from "@/components/mvp/user-card/schedule-modal";
import { ToastContainer } from "@/components/video-meeting/toast";

const stream = vi.hoisted(() => ({
  user: { id: "first", firstName: "First", email: "first@example.test" },
  loading: false,
  clients: [] as Array<{ disconnectUser: ReturnType<typeof vi.fn> }>,
}));
vi.mock("@/hooks/useWorkOSAuth", () => ({
  useWorkOSAuth: () => ({ user: stream.user, loading: stream.loading }),
}));
vi.mock("@/actions/stream.actions", () => ({ tokenProvider: vi.fn() }));
vi.mock("@stream-io/video-react-sdk", () => ({
  StreamVideoClient: class {
    disconnectUser = vi.fn().mockResolvedValue(undefined);
    constructor() {
      stream.clients.push(this);
    }
  },
  StreamVideo: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stream-provider">{children}</div>
  ),
}));
vi.stubEnv("NEXT_PUBLIC_STREAM_API_KEY", "test-only-public-key");
const { default: StreamVideoProvider } = await import(
  "@/providers/StreamClientProvider"
);
afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("scheduling availability stays fixed while the topic changes", () => {
  let call = 0;
  vi.spyOn(Math, "random").mockImplementation(() => (++call % 2 ? 0.1 : 0.9));
  render(
    <ScheduleModal
      isOpen
      onClose={() => {}}
      name="Peer"
      avatar={null}
      onSchedule={() => {}}
    />,
  );
  const slots = () =>
    screen
      .getAllByRole("button")
      .filter((button): button is HTMLButtonElement =>
        button instanceof HTMLButtonElement &&
        /\d:\d\d [AP]M/.test(button.textContent ?? ""),
      );
  const initial = slots().map((button) => button.disabled);
  expect(initial).toHaveLength(8);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Project" },
  });
  expect(slots().map((button) => button.disabled)).toEqual(initial);
});

test("toast portal stays absent during SSR and registers/removes its client event handler", () => {
  expect(renderToString(<ToastContainer />)).toBe("");
  const { unmount } = render(<ToastContainer />);
  act(() => window.addToast({ message: "Ready", duration: 60000 }));
  expect(screen.getByText("Ready")).toBeInTheDocument();
  unmount();
  expect(window.addToast).toBeUndefined();
});

test("Stream setup publishes a usable client and disconnects every replaced client", () => {
  const { rerender, unmount } = render(
    <StreamVideoProvider>
      <p>Call</p>
    </StreamVideoProvider>,
  );
  expect(screen.getByTestId("stream-provider")).toBeInTheDocument();
  expect(stream.clients).toHaveLength(1);
  stream.user = {
    id: "second",
    firstName: "Second",
    email: "second@example.test",
  };
  rerender(
    <StreamVideoProvider>
      <p>Call</p>
    </StreamVideoProvider>,
  );
  expect(stream.clients).toHaveLength(2);
  expect(stream.clients[0].disconnectUser).toHaveBeenCalledOnce();
  unmount();
  expect(stream.clients[1].disconnectUser).toHaveBeenCalledOnce();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useParams: () => ({ id: "test-meeting" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/video-meeting/top-bar", () => ({
  TopBar: ({
    showTimeLeft,
    isAlmostOutOfTime,
    onToggleTimeDisplay,
  }: {
    showTimeLeft: boolean;
    isAlmostOutOfTime: boolean;
    onToggleTimeDisplay: () => void;
  }) => (
    <button
      onClick={onToggleTimeDisplay}
      data-testid="clock"
      data-warning={String(isAlmostOutOfTime)}
    >
      {String(showTimeLeft)}
    </button>
  ),
}));
vi.mock("@/components/video-meeting/video-area", () => ({
  VideoArea: ({
    activeVideo,
    onVideoClick,
  }: {
    activeVideo: string | null;
    onVideoClick: (id: string) => void;
  }) => (
    <button
      data-testid="active-video"
      onClick={() => onVideoClick("saved-peer")}
    >
      {activeVideo ?? "none"}
    </button>
  ),
}));
vi.mock("@/components/mvp/user-card", () => ({ default: () => null }));
vi.mock("@/components/video-meeting/chat-dialog", () => ({
  ChatDialog: () => null,
}));
vi.mock("@/components/video-meeting/settings-dialog", () => ({
  SettingsDialog: () => null,
}));
vi.mock("@/components/video-meeting/end-call-dialog", () => ({
  EndCallDialog: () => null,
}));
vi.mock("@/components/video-meeting/time-manager", () => ({
  TimeManager: class {
    time = 61;
    getRemainingTime() {
      return this.time;
    }
    decrementTime() {
      this.time = Math.max(0, this.time - 1);
    }
  },
}));
const { default: VideoMeeting } = await import("@/app/videocall/[id]/page");

test("simulated call restores the expanded video and preserves manual clock toggles until the next warning tick", () => {
  vi.useFakeTimers();
  localStorage.setItem("connvo:call:activeVideo", JSON.stringify("saved-peer"));
  const { unmount } = render(<VideoMeeting />);
  expect(screen.getByTestId("active-video")).toHaveTextContent("saved-peer");
  fireEvent.click(screen.getByTestId("active-video"));
  expect(screen.getByTestId("active-video")).toHaveTextContent("none");
  expect(localStorage.getItem("connvo:call:activeVideo")).toBe("null");
  expect(screen.getByTestId("clock")).toHaveTextContent("false");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByTestId("clock")).toHaveAttribute("data-warning", "true");
  expect(screen.getByTestId("clock")).toHaveTextContent("true");
  fireEvent.click(screen.getByTestId("clock"));
  expect(screen.getByTestId("clock")).toHaveTextContent("false");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByTestId("clock")).toHaveTextContent("true");
  unmount();
});
