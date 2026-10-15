import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/app/settings/page";

const backend = vi.hoisted(() => ({
  settings: {
    emailNotifications: false,
    pushNotifications: true,
    smsNotifications: false,
    profileVisibility: true,
    dataSharing: false,
    activityTracking: true,
  },
  mutate: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => backend.settings,
  useMutation: () => backend.mutate,
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock("@/hooks/useWorkOSAuth", () => ({
  useWorkOSAuth: () => ({ isAuthenticated: true, loading: false }),
}));

describe("settings query synchronization", () => {
  it("uses initially loaded settings, rolls back failures and accepts a new query result", async () => {
    backend.mutate.mockRejectedValueOnce(new Error("request failed"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const { rerender } = render(<SettingsPage />);
      const email = () =>
        screen.getByRole("switch", { name: "Email Notifications" });
      expect(email().getAttribute("aria-checked")).toBe("false");
      fireEvent.click(email());
      await waitFor(() =>
        expect(backend.mutate).toHaveBeenCalledWith({
          emailNotifications: true,
        }),
      );
      await waitFor(() =>
        expect(email().getAttribute("aria-checked")).toBe("false"),
      );
      backend.settings = { ...backend.settings, emailNotifications: true };
      rerender(<SettingsPage />);
      expect(email().getAttribute("aria-checked")).toBe("true");
    } finally {
      consoleError.mockRestore();
    }
  });
});
