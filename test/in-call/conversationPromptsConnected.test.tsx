/**
 * The REAL connected ConversationPrompts over the REAL prompts handlers.
 *
 * Mounts the exported component — PromptBoundary wrapping ConnectedPrompts,
 * which calls useQuery(api.prompts.live.current), useAction
 * (api.prompts.live.pick), useMutation(api.prompts.live.markUsed) and
 * useMutation(api.prompts.live.pauseAuto) — against a real convex-test
 * backend. The only double is the convex/react hook plumbing
 * (ConvexReactSimLive): the sim runs every query/mutation/action through an
 * authenticated convex-test face and resyncs queries after each resolved
 * call, mirroring Convex's invalidation.
 *
 * Pinned behaviors (each previously uncovered by the unmounted
 * conversation-prompts.test.tsx, which drives PromptPanel with canned state):
 *   1. write/shared view — an automatic pick over the real action lands one
 *      prompt that BOTH callers' mounted panels read identically;
 *   2. used — "We used this" runs the real markUsed mutation, both panels
 *      converge to the used state, and the real prompts row carries usedAt;
 *   3. reconnect/remount — remounting over the same backend shows the SAME
 *      prompt with exactly one prompts row and one session.shown entry (no
 *      duplicate pick after resubscribe);
 *   4. authorization — a caller with no meetingParticipants row is refused
 *      by the real current query and the PromptBoundary owns the refusal.
 *
 * Determinism: OPENAI_API_KEY is stubbed empty so selectPrompt uses the
 * deterministic bank fallback (no live AI); no Stream, no fake timers beyond
 * the component's own 1 s clock.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type RenderResult,
} from "@testing-library/react";
import { api } from "@convex/_generated/api";
import type { FunctionReference } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationPrompts } from "@/components/call/ConversationPrompts";
import {
  createTestEnvironment,
  createTestMeetingWithParticipants,
  createTestUser,
} from "../convex/helpers";
import {
  ConvexReactSimLive,
  SimFaceProvider,
  type SimFace,
} from "./helpers/convexReactSimLive";

/** Hoisted holder so the vi.mock factory can reach the per-test instance. */
const convexSim = vi.hoisted(() => ({
  current: null as ConvexReactSimLive | null,
}));

vi.mock("convex/react", () => {
  const sim = () => convexSim.current as ConvexReactSimLive;
  return {
    useQuery: (query: unknown, args: Record<string, unknown>) =>
      sim().useQuery(query as FunctionReference<"query">, args),
    useMutation: (mutation: unknown) =>
      sim().useMutation(mutation as FunctionReference<"mutation">),
    useAction: (action: unknown) =>
      sim().useAction(action as FunctionReference<"action">),
  } as unknown as Record<string, unknown>;
});

describe("ConversationPrompts — connected over the real prompts handlers", () => {
  let t: ReturnType<typeof createTestEnvironment>;
  let sim: ConvexReactSimLive;

  beforeEach(() => {
    t = createTestEnvironment();
    sim = new ConvexReactSimLive(t);
    convexSim.current = sim;
    // The deterministic bank fallback — no live AI in any pick.
    vi.stubEnv("OPENAI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** The live.test.ts fixture: an active two-participant meeting + faces. */
  async function fixture() {
    const meeting = await createTestMeetingWithParticipants(
      t,
      {},
      2,
      { state: "active", duration: 1_800_000 },
      {},
    );
    return {
      meetingId: meeting.meetingId,
      a: sim.authFace("a", meeting.participantWorkosIds[0]),
      b: sim.authFace("b", meeting.participantWorkosIds[1]),
    };
  }

  function mountPanel(face: SimFace, meetingId: Id<"meetings">): RenderResult {
    return render(
      <SimFaceProvider sim={sim} face={face}>
        <ConversationPrompts meetingId={meetingId} inCall />
      </SimFaceProvider>,
    );
  }

  /**
   * Per-panel queries: two mounted panels share document.body, so every
   * lookup is scoped to that render's own container.
   */
  function panel(view: RenderResult) {
    return within(view.container);
  }

  /** The shown prompt text for one mounted panel, or null while not shown. */
  function promptText(view: RenderResult): string | null {
    const element = panel(view).queryByTestId("current-prompt");
    const text = element?.textContent?.trim();
    return text ? text : null;
  }

  /**
   * Waits for a prompt to appear through the automatic pick (nextAutoAt is 0
   * for a fresh session, so the panel requests one as soon as it loads). If
   * it has not landed after ~3 s of resyncs, drives the same request the way
   * a user would — the "Get an idea" button calls pick with automatic: false.
   */
  async function waitPrompt(view: RenderResult): Promise<string> {
    try {
      await waitFor(() => expect(promptText(view)).not.toBeNull(), {
        timeout: 3000,
      });
    } catch {
      await sim.refreshAll();
      await waitFor(
        () => expect(promptText(view)).not.toBeNull(),
        { timeout: 1000 },
      ).catch(() => undefined);
      const button = panel(view).getByRole("button", { name: "Get an idea" });
      await waitFor(() => expect(button).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(button);
      await waitFor(() => expect(promptText(view)).not.toBeNull(), {
        timeout: 10000,
      });
    }
    const text = promptText(view);
    if (!text) throw new Error("prompt did not appear");
    return text;
  }

  /** Every incall prompt row the meeting really has. */
  async function readMeetingPrompts(meetingId: Id<"meetings">) {
    return t.run((ctx) =>
      ctx.db
        .query("prompts")
        .withIndex("by_meeting_type", (q) =>
          q.eq("meetingId", meetingId).eq("type", "incall"),
        )
        .collect(),
    );
  }

  /** The meeting's real live prompt session row. */
  async function readSession(meetingId: Id<"meetings">) {
    return t.run((ctx) =>
      ctx.db
        .query("livePromptSessions")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .unique(),
    );
  }

  it("shows both callers the same prompt after an automatic pick", async () => {
    const f = await fixture();

    const viewA = mountPanel(f.a, f.meetingId);
    const textA = await waitPrompt(viewA);
    expect(textA.length).toBeGreaterThan(0);

    const viewB = mountPanel(f.b, f.meetingId);
    await waitFor(() => expect(promptText(viewB)).toBe(textA));
  });

  it("marks the prompt used once and converges both panels to the used state", async () => {
    const f = await fixture();

    const viewA = mountPanel(f.a, f.meetingId);
    const textA = await waitPrompt(viewA);
    const viewB = mountPanel(f.b, f.meetingId);
    await waitFor(() => expect(promptText(viewB)).toBe(textA));

    fireEvent.click(panel(viewB).getByRole("button", { name: "We used this" }));

    // B sees the used state through the real markUsed mutation + resync.
    await waitFor(() =>
      expect(
        panel(viewB).getByText("Marked as used. Saved to your recap."),
      ).toBeInTheDocument(),
    );
    expect(
      panel(viewB).getByRole("button", { name: "Used ✓" }),
    ).toBeDisabled();

    // A converges to used on the resync — shared truth, not per-caller state.
    await waitFor(() =>
      expect(
        panel(viewA).getByText("Marked as used. Saved to your recap."),
      ).toBeInTheDocument(),
    );
    expect(
      panel(viewA).getByRole("button", { name: "Used ✓" }),
    ).toBeDisabled();

    // The real prompts row carries the used marker (recap evidence). One
    // transaction reads the session pointer and the prompt row together —
    // convex-test transactions do not nest.
    const row = await t.run(async (ctx) => {
      const session = await ctx.db
        .query("livePromptSessions")
        .withIndex("by_meeting", (q) => q.eq("meetingId", f.meetingId))
        .unique();
      if (!session?.currentPromptId) {
        throw new Error("session has no current prompt");
      }
      return ctx.db.get(session.currentPromptId);
    });
    expect(row?.content).toBe(textA);
    expect(row?.usedAt).toBeDefined();
  });

  it("keeps the same prompt across a remount without a duplicate pick", async () => {
    const f = await fixture();

    const viewA = mountPanel(f.a, f.meetingId);
    const textA = await waitPrompt(viewA);
    const viewB = mountPanel(f.b, f.meetingId);
    await waitFor(() => expect(promptText(viewB)).toBe(textA));

    // B drops (reload, tab switch) and rejoins over the SAME backend.
    viewB.unmount();

    expect(await readMeetingPrompts(f.meetingId)).toHaveLength(1);
    const sessionAfterDrop = await readSession(f.meetingId);
    expect(sessionAfterDrop?.shown).toHaveLength(1);

    const viewB2 = mountPanel(f.b, f.meetingId);
    await waitFor(() => expect(promptText(viewB2)).toBe(textA));

    // The resubscribe did not pick again: one row, one shown entry.
    expect(await readMeetingPrompts(f.meetingId)).toHaveLength(1);
    expect((await readSession(f.meetingId))?.shown).toHaveLength(1);
  });

  it("refuses an outsider at the handler and renders the boundary fallback", async () => {
    const f = await fixture();

    const outsiderSubject = `prompts-outsider-${Date.now()}`;
    await createTestUser(t, { workosUserId: outsiderSubject });
    const outsider = sim.authFace("outsider", outsiderSubject);

    // Handler level: the real current query refuses a non-participant.
    await expect(
      outsider.query(api.prompts.live.current, { meetingId: f.meetingId }),
    ).rejects.toThrow(/Not a meeting participant/);

    const view = mountPanel(outsider, f.meetingId);

    // Mounted level: the refusal lands in the PromptBoundary fallback —
    // the outsider sees the answer, never anyone else's prompt.
    await waitFor(() =>
      expect(
        screen.getByText(/Only meeting participants can see these prompts/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("current-prompt")).toBeNull();
    view.unmount();
  });
});
