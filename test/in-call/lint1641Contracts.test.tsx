import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FormProvider, useForm } from "react-hook-form";
import BioSection from "@/components/onboarding/BioSection";
import type { OnboardingFormData } from "@/schemas/onboarding";
import { Carousel, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

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
