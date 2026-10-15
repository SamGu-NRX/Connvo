import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FormProvider, useForm } from "react-hook-form";
import BioSection from "@/components/onboarding/BioSection";
import type { OnboardingFormData } from "@/schemas/onboarding";
import MeetingSummaryPage from "@/app/app/meeting-summary/page";
import { Carousel, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { LAST_MEETING_SUMMARY_KEY } from "@/constants/meeting";

const embla = vi.hoisted(() => ({
  previous: false,
  next: true,
  listeners: new Map<string, Set<() => void>>(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("embla-carousel-react", () => {
  const api = {
    canScrollPrev: () => embla.previous,
    canScrollNext: () => embla.next,
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    on: (event: string, listener: () => void) => {
      const listeners = embla.listeners.get(event) ?? new Set();
      listeners.add(listener);
      embla.listeners.set(event, listeners);
      return api;
    },
    off: (event: string, listener: () => void) => {
      embla.listeners.get(event)?.delete(listener);
      return api;
    },
  };
  return { default: () => [() => {}, api] };
});

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => { storage.delete(key); },
  });
  embla.listeners.clear();
  embla.previous = false;
  embla.next = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("meeting summary keeps its server loading state and resolves an empty browser session", () => {
  expect(renderToString(<MeetingSummaryPage />)).toContain("Preparing your meeting summary");
  render(<MeetingSummaryPage />);
  expect(screen.getByText("No Meeting Summary Yet")).toBeInTheDocument();
});

test("meeting summary renders the current browser session and reacts to storage changes", () => {
  storage.set(LAST_MEETING_SUMMARY_KEY, JSON.stringify({
    meetingId: "call-1", partnerName: "Peer", queueType: "casual", durationSeconds: 90,
    participants: [{ name: "You" }], messages: { total: 0, you: 0, partner: 0 },
    notes: "", notesLength: 0, endedAt: "2026-10-15T00:00:00Z", promptsViewed: [], activePrompt: "Hello",
  }));
  render(<MeetingSummaryPage />);
  expect(screen.getByText("Latest Meeting Summary")).toBeInTheDocument();
  expect(screen.getByText("1:30")).toBeInTheDocument();
  act(() => { storage.delete(LAST_MEETING_SUMMARY_KEY); window.dispatchEvent(new Event("storage")); });
  expect(screen.getByText("No Meeting Summary Yet")).toBeInTheDocument();
});

test("meeting summary removes corrupt JSON and shows the empty state", () => {
  storage.set(LAST_MEETING_SUMMARY_KEY, "{broken");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<MeetingSummaryPage />);
  expect(screen.getByText("No Meeting Summary Yet")).toBeInTheDocument();
  expect(storage.has(LAST_MEETING_SUMMARY_KEY)).toBe(false);
});

test("meeting summary refuses a stored value with the wrong shape", () => {
  storage.set(LAST_MEETING_SUMMARY_KEY, JSON.stringify({ participants: "invalid" }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<MeetingSummaryPage />);
  expect(screen.getByText("No Meeting Summary Yet")).toBeInTheDocument();
  expect(storage.has(LAST_MEETING_SUMMARY_KEY)).toBe(false);
});

test("carousel derives initial directions, responds to select/reInit, and unsubscribes both events", () => {
  const { unmount } = render(<Carousel><CarouselPrevious /><CarouselNext /></Carousel>);
  expect(screen.getByRole("button", { name: "Previous slide" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next slide" })).toBeEnabled();
  act(() => {
    embla.previous = true;
    embla.next = false;
    embla.listeners.get("select")?.forEach(listener => listener());
  });
  expect(screen.getByRole("button", { name: "Previous slide" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Next slide" })).toBeDisabled();
  act(() => {
    embla.next = true;
    embla.listeners.get("reInit")?.forEach(listener => listener());
  });
  expect(screen.getByRole("button", { name: "Next slide" })).toBeEnabled();
  unmount();
  expect(embla.listeners.get("select")?.size).toBe(0);
  expect(embla.listeners.get("reInit")?.size).toBe(0);
});
test("bio character count follows edits directly", () => {
  function BioForm() {
    const form = useForm<OnboardingFormData>({ defaultValues: { bio: "Hello" } });
    return <FormProvider {...form}><BioSection onNext={() => {}} onBack={() => {}} /></FormProvider>;
  }
  render(<BioForm />);
  expect(screen.getByText("5/150 characters")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Bio" }), { target: { value: "Hello again" } });
  expect(screen.getByText("11/150 characters")).toBeInTheDocument();
});
