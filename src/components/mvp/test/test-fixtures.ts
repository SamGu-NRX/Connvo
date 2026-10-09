import { vi } from "vitest";
import type React from "react";

/**
 * Shared test fixtures for src/components/mvp tests.
 *
 * These helpers exist so parallel test suites don't each hand-roll the same
 * mocks. Extend with overrides rather than editing existing signatures —
 * multiple suites depend on them.
 *
 * NOTE: vitest hoists vi.mock() calls, so every factory reads state from
 * vi.hoisted() holders (mock*) instead of closing over function parameters.
 * Always call the mock* helper BEFORE importing the component under test.
 */

// ---------- UserInfo fixture ----------

type UserInfoInput = {
  id?: string;
  name?: string;
  avatar?: string | null;
  bio?: string;
  profession?: string;
  company?: string;
  school?: string;
  experience?: number;
  sharedInterests?: Array<{ type: "academic" | "industry" | "skill"; name: string }>;
  connectionType?: "b2b" | "collaboration" | "mentorship" | "investment";
  isBot?: boolean;
  status?: "online" | "away" | "offline";
  connectionStatus?: "excellent" | "good" | "poor" | "offline";
  interests?: string[];
  isSpeaking?: boolean;
  meetingStats?: { totalMeetings: number; totalMinutes: number; averageRating: number };
  [key: string]: unknown;
};

export function makeUserInfo(overrides: UserInfoInput = {}): import("@/types/user").UserInfo {
  return {
    id: "u1",
    name: "Ada Lovelace",
    avatar: null,
    bio: "Analytical engines enthusiast.",
    profession: "Mathematician",
    company: "Analytical Engines Ltd",
    school: "Cambridge",
    experience: 5,
    sharedInterests: [
      { type: "academic", name: "Mathematics" },
      { type: "industry", name: "Computing" },
    ],
    connectionType: "collaboration",
    status: "online",
    ...overrides,
  } as import("@/types/user").UserInfo;
}

// ---------- next/navigation mock ----------

const mockNav = vi.hoisted(() => ({
  pathname: "/app",
  push: undefined as ReturnType<typeof vi.fn> | undefined,
}));

/**
 * Mock next/navigation with a fixed pathname (and a router push spy).
 * Call at module scope of a test file, before importing the component.
 * Access the push spy via getNavPushSpy().
 */
export function mockNextNavigation(pathname = "/app") {
  mockNav.pathname = pathname;
  mockNav.push = vi.fn();
  vi.mock("next/navigation", async () => {
    return {
      useRouter: () => ({
        push: mockNav.push,
        replace: vi.fn(),
        back: vi.fn(),
        forward: vi.fn(),
        prefetch: vi.fn(),
        refresh: vi.fn(),
      }),
      usePathname: () => mockNav.pathname,
      useSearchParams: () => new URLSearchParams(),
      useSearchParamsObject: () => ({}),
      redirect: vi.fn(),
      notFound: vi.fn(),
    };
  });
}

export function getNavPushSpy() {
  return mockNav.push;
}

/** Change the mocked pathname mid-file (before further renders). */
export function setMockPathname(pathname: string) {
  mockNav.pathname = pathname;
}

// ---------- next-themes mock ----------

const mockTheme = vi.hoisted(() => ({
  theme: "light" as string,
  setTheme: undefined as ReturnType<typeof vi.fn> | undefined,
}));

export function mockNextThemes(theme = "light") {
  mockTheme.theme = theme;
  mockTheme.setTheme = vi.fn();
  vi.mock("next-themes", async () => {
    return {
      useTheme: () => ({
        theme: mockTheme.theme,
        setTheme: mockTheme.setTheme,
        themes: ["light", "dark", "system"],
      }),
      ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    };
  });
  return mockTheme.setTheme;
}

// ---------- convex/react mock (controlled useQuery) ----------

const mockConvex = vi.hoisted(() => {
  return {
    resultsByRef: new Map<object, unknown>(),
    resultsByName: new Map<string, unknown>(),
    calls: [] as Array<{ fn: unknown; args: unknown }>,
    mutationCalls: [] as Array<{ fn: unknown; args: unknown }>,
    mutationImpls: [] as Array<ReturnType<typeof vi.fn>>,
  };
});

/**
 * Mock convex/react with a controllable query result table.
 *
 * Usage:
 *   const convex = mockConvexReact();
 *   convex.setQueryResult(api.meetings.queries.getMeeting, { ... });
 *
 * useQuery(fn, args) returns the registered value for the query reference;
 * args of "skip" or undefined return undefined (components treat that as
 * loading). Keyed by the actual api reference object identity from
 * @convex/_generated/api, so import the real api object in your test.
 */
export function mockConvexReact() {
  vi.mock("convex/react", async () => {
    return {
      ConvexProvider: ({ children }: { children: React.ReactNode }) => children,
      ConvexClientProvider: ({ children }: { children: React.ReactNode }) => children,
      Authenticated: ({ children }: { children: React.ReactNode }) => children,
      Unauthenticated: ({ children }: { children: React.ReactNode }) => children,
      AuthLoading: () => null,
      useQuery: (fn: unknown, args: unknown) => {
        mockConvex.calls.push({ fn, args });
        if (args === "skip" || args === undefined) return undefined;
        if (typeof fn === "object" && fn !== null && mockConvex.resultsByRef.has(fn)) {
          return mockConvex.resultsByRef.get(fn);
        }
        if (typeof fn === "string") return mockConvex.resultsByName.get(fn);
        return undefined;
      },
      useMutation: (fn: unknown) => {
        const impl = vi.fn((args: unknown) => {
          mockConvex.mutationCalls.push({ fn, args });
          return Promise.resolve(null);
        });
        mockConvex.mutationImpls.push(impl);
        return impl;
      },
      useAction: () => vi.fn(),
      usePaginatedQuery: () => ({
        results: [],
        status: "Exhausted",
        loadMore: vi.fn(),
      }),
      preloadQuery: () => undefined,
      useSuspenseQuery: () => undefined,
    };
  });

  return {
    /** Register a result for a query reference imported from @convex/_generated/api. */
    setQueryResult(queryRef: unknown, value: unknown) {
      if (typeof queryRef === "object" && queryRef !== null) {
        mockConvex.resultsByRef.set(queryRef, value);
      } else {
        mockConvex.resultsByName.set(String(queryRef), value);
      }
    },
    get calls() {
      return mockConvex.calls;
    },
    get mutationCalls() {
      return mockConvex.mutationCalls;
    },
    get mutationImpls() {
      return mockConvex.mutationImpls;
    },
    reset() {
      mockConvex.resultsByRef.clear();
      mockConvex.resultsByName.clear();
      mockConvex.calls.length = 0;
      mockConvex.mutationCalls.length = 0;
      mockConvex.mutationImpls.length = 0;
    },
  };
}

// ---------- jsdom helpers ----------

export function stubUrlMethods() {
  const createObjectURL = vi.fn(() => "blob:mock-url");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectURL,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revokeObjectURL,
    writable: true,
  });
  return { createObjectURL, revokeObjectURL };
}
