import { useSyncExternalStore } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { MeetingList } from "@/components/history/MeetingList";

const pages = vi.hoisted(() => ({
  snapshot: { results: [] as never[], status: "CanLoadMore" },
  listeners: new Set<() => void>(),
  requests: 0,
  cached: false,
  allowedRequests: 5,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  usePaginatedQuery: () => {
    const state = useSyncExternalStore(
      (listener) => {
        pages.listeners.add(listener);
        return () => {
          pages.listeners.delete(listener);
        };
      },
      () => pages.snapshot,
    );
    return { ...state, loadMore };
  },
}));

function loadMore() {
  pages.requests++;
  if (pages.requests > pages.allowedRequests)
    throw new Error("Pagination exceeded its automatic request budget");
  if (pages.cached) {
    pages.snapshot = { results: [], status: "CanLoadMore" };
    pages.listeners.forEach((listener) => listener());
  } else {
    pages.snapshot = { results: [], status: "LoadingMore" };
    pages.listeners.forEach((listener) => listener());
    queueMicrotask(() => {
      pages.snapshot = { results: [], status: "CanLoadMore" };
      pages.listeners.forEach((listener) => listener());
    });
  }
}

beforeEach(() => {
  pages.snapshot = { results: [], status: "CanLoadMore" };
  pages.listeners.clear();
  pages.requests = 0;
  pages.cached = false;
  pages.allowedRequests = 5;
});

test("five short empty async pages settle instead of fetching forever", async () => {
  render(<MeetingList />);
  expect(await screen.findByTestId("meeting-list-empty")).toBeInTheDocument();
  expect(screen.queryByTestId("meeting-list-loading")).not.toBeInTheDocument();
  expect(pages.requests).toBe(5);
});

test("five cached empty pages settle even without an observed LoadingMore render", async () => {
  pages.cached = true;
  render(<MeetingList />);
  expect(await screen.findByTestId("meeting-list-empty")).toBeInTheDocument();
  expect(screen.queryByTestId("meeting-list-loading")).not.toBeInTheDocument();
  expect(pages.requests).toBe(5);
});


test("manual continuation stays available after the budget and does not restart automatic requests", async () => {
  render(<MeetingList />);
  expect(await screen.findByText("More meetings may be available")).toBeInTheDocument();
  expect(screen.queryByText("No meetings yet")).not.toBeInTheDocument();
  expect(pages.requests).toBe(5);
  pages.allowedRequests = 6;
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("More meetings may be available")).toBeInTheDocument();
  expect(pages.requests).toBe(6);
  expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
});
