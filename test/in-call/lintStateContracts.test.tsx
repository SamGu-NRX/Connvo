import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { ScheduleModal } from "@/components/mvp/user-card/schedule-modal";

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
