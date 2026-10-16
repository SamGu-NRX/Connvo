import { render } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/app/settings/page";

const backend = vi.hoisted(() => ({
  settingsLoaded: false,
  settings: {
    _id: "settings",
    emailNotifications: true,
    pushNotifications: true,
    smsNotifications: false,
    profileVisibility: true,
    dataSharing: false,
    activityTracking: true,
  },
  availability: [],
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    if (name.endsWith(":getCurrentUserSettings")) {
      return backend.settingsLoaded ? backend.settings : undefined;
    }
    if (name.endsWith(":getMyChatPreferences")) return null;
    if (name.endsWith(":getMyAvailability")) return backend.availability;
    throw new Error(`Unexpected query ${name}`);
  },
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock("@/hooks/useWorkOSAuth", () => ({
  useWorkOSAuth: () => ({ isAuthenticated: true, loading: false }),
}));

afterEach(() => {
  window.location.hash = "";
  vi.restoreAllMocks();
});

describe("settings #matching link", () => {
  it("scrolls to the matching card when settings resolve after availability", () => {
    window.location.hash = "#matching";
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { rerender } = render(<SettingsPage />);
    expect(scrolled).toEqual([]);

    backend.settingsLoaded = true;
    rerender(<SettingsPage />);
    expect(scrolled).toEqual(["matching"]);
  });
});
