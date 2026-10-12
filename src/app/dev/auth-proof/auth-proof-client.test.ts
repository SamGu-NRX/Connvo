/**
 * @vitest-environment node
 *
 * Contract tests for the auth-proof page:
 * - the H-14 named rejection renders in [data-testid="call-error"] and is
 *   non-empty (tools/call-eval/CONTRACT.md);
 * - the pending label distinguishes waiting for auth from querying
 *   (the auth gate added with this page's fix).
 *
 * Runs in the node environment because the frontend vitest project has no
 * jsdom installed; renderToString covers these render-only assertions.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
  useConvex: () => ({}),
  useConvexAuth: vi.fn(),
}));

const { useConvexAuth } = await import("convex/react");
const { default: AuthProof, ProofError } = await import("./auth-proof-client");

describe("auth-proof page contract", () => {
  it("renders the H-14 rejection in data-testid=call-error with non-empty text", () => {
    const html = renderToString(
      createElement(ProofError, {
        message: "Access denied: Not a meeting participant",
      }),
    );
    expect(html).toContain('data-testid="call-error"');
    expect(html).toContain("Access denied: Not a meeting participant");
  });

  it("shows the waiting-for-auth label before authentication, querying after", () => {
    vi.mocked(useConvexAuth).mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
      isRefreshing: false,
    });
    const waiting = renderToString(
      createElement(AuthProof, { as: "A", meetingId: "meeting-1" }),
    );
    expect(waiting).toContain("waiting for authentication…");
    expect(waiting).not.toContain("calling getMeeting…");

    vi.mocked(useConvexAuth).mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isRefreshing: false,
    });
    const querying = renderToString(
      createElement(AuthProof, { as: "A", meetingId: "meeting-1" }),
    );
    expect(querying).toContain("calling getMeeting…");
  });
});
