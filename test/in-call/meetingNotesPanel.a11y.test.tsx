/**
 * M3 mounted panel matrix (docs/notes-ledger-f1/design.md §5, panel part) —
 * driven through the REAL ledger hook (the M2/M3 join debt, settled).
 *
 * Every state is produced by the real `useNotesLedger` running over the M2
 * matrix harness: a fault-injecting transport in front of the REAL
 * convex-test notes mutation/query (test/notes/harness + matrixHarness).
 * There is NO `vi.mock` of `@/hooks/notes` — the suite asserts what a user
 * observes: mounted renders (never renderToStaticMarkup), jest-axe results,
 * live-region text, keyboard paths and reduced-motion behavior.
 *
 * Drive choreography per state (recipes proven in test/notes/mountedMatrix):
 *   loading     — the read gate withholds every snapshot, so the panel
 *                 renders before any server evidence lands; releasing the
 *                 gate proves the state was only the read window
 *   synced      — seeded server text, the first read lands
 *   saving      — holdBeforeApply parks the flush send mid-flight
 *   unconfirmed — keepResults:0 with the push suppressed: the server applies
 *                 but the response echoes nothing, so the op stays
 *                 unconfirmed (matrix case 2's partial-ack path, taken to
 *                 its zero-ack end)
 *   conflict    — a dropped send, then FORBIDDEN on the identity resend:
 *                 the record is rejected on attempt 2 with no blind resend
 *                 (matrix case 10)
 *   offline     — offline faults fail the send; typing keeps working
 *   updating    — the adoption gate holds the follow-up flush while the
 *                 buffer holds unsent words: the honest debounce window
 *                 (words typed, no live records yet, next read pending)
 *
 * Blur commits immediately (`flushNow` is the panel's onBlur), so drives are
 * deterministic without waiting out the 800ms default debounce. The panel's
 * default debounce is exercised as-is — never configured away.
 */

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import {
  mountRealLedgerPanel,
  waitForServerText,
  type MountedRealLedgerPanel,
} from "./helpers/realLedgerPanel";
import { setPrefersReducedMotion } from "./matchMediaDouble";

const SEED_CONTENT = "Agenda: ship the notes ledger\n";
const CONFLICT_WORDS = "decision: postmortem Thursday";

/** Lets the 200ms motion entrance settle so axe audits the fully visible panel. */
async function settleMotion() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
}

/** Component-scoped axe config: page-composition rules belong to page shells. */
async function auditPanel(container: HTMLElement) {
  return axe(container, {
    rules: {
      // The /dev route and call pages own the page h1; real-browser checks at
      // the join cover page composition, color contrast and focus visibility.
      "page-has-heading-one": { enabled: false },
    },
  });
}

/** Waits until the status badge shows the expected label. */
async function badgeShows(expected: string) {
  await waitFor(() =>
    expect(screen.getByTestId("notes-status")).toHaveTextContent(expected),
  );
}

/** Types `next` as one committed change and blurs — the panel's flushNow path. */
async function typeAndCommit(next: string) {
  const editor = screen.getByTestId("notes-editor");
  fireEvent.change(editor, { target: { value: next } });
  fireEvent.blur(editor);
}

/** One driven panel state: the mount plus the user-observable expectations. */
interface DrivenPanelState {
  mounted: MountedRealLedgerPanel;
  expectedLabel: string;
  isLoading: boolean;
  /** The user-observable editor value while the state holds. */
  editorValue: string;
  /** State-specific follow-through after the shared assertions. */
  followThrough?: () => Promise<void>;
}

async function driveLoadingState(): Promise<DrivenPanelState> {
  // Reads withheld BEFORE mount: the panel renders with no server evidence.
  const mounted = await mountRealLedgerPanel({
    seedText: SEED_CONTENT,
    holdReads: true,
    tag: "loading",
  });
  await badgeShows("Loading");
  return {
    mounted,
    expectedLabel: "Loading",
    isLoading: true,
    editorValue: "",
    followThrough: async () => {
      // Release the held first read: the loading state was only the
      // read window, and the panel settles honestly at Synced.
      mounted.gate.releaseReads();
      await badgeShows("Synced");
    },
  };
}

async function driveSyncedState(): Promise<DrivenPanelState> {
  const mounted = await mountRealLedgerPanel({
    seedText: SEED_CONTENT,
    tag: "synced",
  });
  await badgeShows("Synced");
  return { mounted, expectedLabel: "Synced", isLoading: false, editorValue: SEED_CONTENT };
}

async function driveSavingState(): Promise<DrivenPanelState> {
  const mounted = await mountRealLedgerPanel({
    seedText: SEED_CONTENT,
    tag: "saving",
  });
  await badgeShows("Synced");

  // The flush send parks mid-flight: the server never sees the batch and
  // the caller never hears back — the honest Saving window.
  mounted.gate.faults = { holdBeforeApply: true };
  const typed = "these words are mid-flight";
  await typeAndCommit(SEED_CONTENT + typed);
  await badgeShows("Saving");

  return { mounted, expectedLabel: "Saving", isLoading: false, editorValue: SEED_CONTENT + typed };
}

async function driveUnconfirmedState(): Promise<DrivenPanelState> {
  const mounted = await mountRealLedgerPanel({
    seedText: SEED_CONTENT,
    tag: "unconfirmed",
  });
  await badgeShows("Synced");

  // The server applies the batch, but the response echoes nothing and no
  // push follows: the op stays unconfirmed on identity evidence.
  mounted.gate.faults = { keepResults: 0, pushAfterApply: false };
  const typed = "todo: send the recap";
  await typeAndCommit(SEED_CONTENT + typed);
  await badgeShows("Unconfirmed (1)");

  return { mounted, expectedLabel: "Unconfirmed (1)", isLoading: false, editorValue: SEED_CONTENT + typed };
}

/**
 * Reaches the Conflict state through REAL server answers: the first send is
 * lost before the server sees it (ECONNRESET — the ledger re-pends), and the
 * identity resend on the reconnect read is refused FORBIDDEN. The rejected
 * record therefore shows attempt 2 — same op id, no blind resend (matrix
 * case 10).
 */
async function driveConflictState(): Promise<MountedRealLedgerPanel> {
  const mounted = await mountRealLedgerPanel({
    seedText: SEED_CONTENT,
    tag: "conflict",
  });
  await badgeShows("Synced");

  mounted.gate.faults = { dropBeforeApply: true };
  await typeAndCommit(SEED_CONTENT + CONFLICT_WORDS);
  await badgeShows("Offline");

  mounted.gate.faults = { forbidden: true };
  await mounted.gate.reconnect();
  await badgeShows("Conflict");

  return mounted;
}

async function driveOfflineState(): Promise<DrivenPanelState> {
  const mounted = await mountRealLedgerPanel({
    seedText: SEED_CONTENT,
    tag: "offline",
  });
  await badgeShows("Synced");

  // Every send fails as unreachable; the ledger re-pends the words and
  // reports the transport honestly offline.
  mounted.gate.faults = { offline: true };
  const typed = "typing offline";
  await typeAndCommit(SEED_CONTENT + typed);
  await badgeShows("Offline");

  return { mounted, expectedLabel: "Offline", isLoading: false, editorValue: SEED_CONTENT + typed };
}

async function driveUpdatingState(): Promise<DrivenPanelState> {
  const mounted = await mountRealLedgerPanel({
    seedText: SEED_CONTENT,
    tag: "updating",
  });
  await badgeShows("Synced");

  // The first flush succeeds, but its adoption read is withheld (no push):
  // the ledger gates follow-up flushes on incorporating its own write.
  mounted.gate.faults = { pushAfterApply: false };
  const firstWords = "local words";
  await typeAndCommit(SEED_CONTENT + firstWords);
  await badgeShows("Synced");

  // More keystrokes while the gate holds: the buffer holds unsent words and
  // no live records exist — the honest Updating window. The state is stable,
  // not a race: the debounced flush stays gated until the next read lands.
  const secondWords = " more";
  const fullValue = SEED_CONTENT + firstWords + secondWords;
  fireEvent.change(screen.getByTestId("notes-editor"), {
    target: { value: fullValue },
  });
  await badgeShows("Updating");

  return {
    mounted,
    expectedLabel: "Updating",
    isLoading: false,
    editorValue: fullValue,
    followThrough: async () => {
      // A second participant edits the server text; the fresh read releases
      // the gate and the user's words re-diff onto the new truth (the flush
      // parks under holdBeforeApply — Saving with the words still visible).
      const remote = await mounted.backend.joinMeeting(mounted.meetingId, "remote");
      await mounted.backend.applyBatch(
        remote.face,
        mounted.meetingId,
        "remote-editor",
        {
          operations: [
            {
              operation: { type: "insert", position: 0, content: "Remote agenda: " },
              clientSequence: 0,
              clientOpId: "remote-op-1",
            },
          ],
        },
        { push: false },
      );
      mounted.gate.faults = { holdBeforeApply: true, pushAfterApply: false };
      await mounted.gate.pushFreshRead();
      await badgeShows("Saving");
      expect(screen.getByTestId("notes-editor")).toHaveValue(fullValue);
    },
  };
}

/** The conflict state as a DrivenPanelState for the shared matrix sweeps. */
async function driveConflictDriven(): Promise<DrivenPanelState> {
  const mounted = await driveConflictState();
  return {
    mounted,
    expectedLabel: "Conflict",
    isLoading: false,
    editorValue: SEED_CONTENT + CONFLICT_WORDS,
  };
}

const STATE_CASES: Array<[string, () => Promise<DrivenPanelState>]> = [
  ["loading", driveLoadingState],
  ["synced", driveSyncedState],
  ["saving", driveSavingState],
  ["unconfirmed", driveUnconfirmedState],
  ["conflict", driveConflictDriven],
  ["offline", driveOfflineState],
  ["updating", driveUpdatingState],
];

describe("MeetingNotesPanel honest state matrix", () => {
  it.each(STATE_CASES)(
    "state %s: axe-clean, polite live region, exact status label",
    async (_name, drive) => {
      const state = await drive();
      await settleMotion();

      const results = await auditPanel(state.mounted.container);
      expect(results).toHaveNoViolations();

      const region = screen.getByRole("status");
      expect(region).toHaveAttribute("aria-live", "polite");
      const statusBadge = within(region).getByTestId("notes-status");
      expect(statusBadge).toHaveTextContent(state.expectedLabel);

      const editor = screen.getByTestId("notes-editor");
      if (state.isLoading) {
        expect(editor).toBeDisabled();
      } else {
        expect(editor).not.toBeDisabled();
      }

      // The user-observable truth: the editor shows the words the user has —
      // the empty pre-read view while loading, the composed text after.
      expect(editor).toHaveValue(state.editorValue);

      if (state.followThrough) {
        await state.followThrough();
      }
    },
  );

  it.each(STATE_CASES.filter(([name]) => name !== "synced"))(
    "state %s never renders a plain Saved label",
    async (_name, drive) => {
      await drive();
      await settleMotion();
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    },
  );

  it("unconfirmed state: unsaved list keeps the words visible with state words", async () => {
    const mounted = await mountRealLedgerPanel({
      seedText: SEED_CONTENT,
      tag: "unsaved-list",
    });
    await badgeShows("Synced");
    const editor = screen.getByTestId("notes-editor");

    // First batch: the server applies it, but the response echoes nothing
    // and no push follows — the op is honestly unconfirmed.
    mounted.gate.faults = { keepResults: 0, pushAfterApply: false };
    fireEvent.change(editor, {
      target: { value: SEED_CONTENT + "todo: send the recap" },
    });
    fireEvent.blur(editor);
    await badgeShows("Unconfirmed (1)");

    // Second batch: its words wait in the buffer — a diff over the composed
    // view while the first record is unconfirmed would stamp speculative
    // coordinates (the server re-transforms them and double-shifts; found by
    // the M4 property). The loss-proof promise keeps them visible as the
    // list's Unsent row instead of an unsound in-flight record.
    mounted.gate.faults = { holdBeforeApply: true };
    fireEvent.change(editor, {
      target: { value: SEED_CONTENT + "todo: send the recap and the metrics" },
    });
    fireEvent.blur(editor);
    await waitFor(() =>
      expect(
        within(screen.getByTestId("notes-unsaved-list")).getByText("Unsent"),
      ).toBeInTheDocument(),
    );
    await settleMotion();

    const results = await auditPanel(mounted.container);
    expect(results).toHaveNoViolations();

    const list = screen.getByTestId("notes-unsaved-list");
    expect(list).toBeVisible();
    expect(within(list).getByText("Unconfirmed")).toBeInTheDocument();
    expect(within(list).getByText("Unsent")).toBeInTheDocument();
    // The quoted words are the exact inserted deltas the real ledger holds.
    expect(within(list).getByText("“todo: send the recap”")).toBeInTheDocument();
    expect(within(list).getByText("“ and the metrics”")).toBeInTheDocument();
    // Unconfirmed/sending records get no retry affordance: retryConflicts
    // only recomputes conflicted/rejected ops — the button must not promise
    // more.
    expect(screen.queryByTestId("notes-retry")).not.toBeInTheDocument();
  });

  it("conflict state: words stay visible and retry is offered", async () => {
    const mounted = await driveConflictState();
    await settleMotion();

    const results = await auditPanel(mounted.container);
    expect(results).toHaveNoViolations();

    const list = screen.getByTestId("notes-unsaved-list");
    // A FORBIDDEN refusal is a definite server answer: the record is
    // rejected (matrix case 10), visible with its words and attempt count.
    expect(within(list).getByText("Rejected")).toBeInTheDocument();
    expect(within(list).getByText(`“${CONFLICT_WORDS}”`)).toBeInTheDocument();
    expect(within(list).getByText("attempt 2")).toBeInTheDocument();

    const retry = screen.getByTestId("notes-retry");
    expect(retry).toBeVisible();

    // REAL recovery, not a counter: the refusal clears, the retried words
    // reach the server, and the panel settles honestly at Synced with an
    // empty unsaved list.
    mounted.gate.faults = {};
    retry.click();
    await badgeShows("Synced");
    await waitForServerText(mounted.backend, mounted.meetingId, SEED_CONTENT + CONFLICT_WORDS);
    expect(screen.queryByTestId("notes-unsaved-list")).not.toBeInTheDocument();
  });

  it("offline state: typing still works (editor never disabled while syncing)", async () => {
    const mounted = await driveOfflineState();
    const editor = screen.getByTestId("notes-editor");

    // The editor NEVER disables while syncing — typing keeps working offline.
    expect(editor).not.toBeDisabled();
    fireEvent.change(editor, {
      target: { value: SEED_CONTENT + "typing offline mid-call" },
    });
    expect(editor).toHaveValue(SEED_CONTENT + "typing offline mid-call");

    // The words the server has not confirmed stay visible in the unsaved list.
    const list = screen.getByTestId("notes-unsaved-list");
    expect(within(list).getByText("Pending")).toBeInTheDocument();
    expect(within(list).getByText("“typing offline”")).toBeInTheDocument();
  });
});

describe("MeetingNotesPanel keyboard access", () => {
  it("walkthrough: textarea → typing → retry via Enter → no trap → focus-visible rings", async () => {
    const mounted = await driveConflictState();
    const user = userEvent.setup();
    await settleMotion();

    // First Tab stop is the editor.
    const editor = screen.getByTestId("notes-editor");
    await user.tab();
    expect(editor).toHaveFocus();

    // Typing flows through the real ledger's debounce buffer; the draft
    // mirror shows the keys immediately.
    await user.type(editor, "hello");
    expect(editor).toHaveValue(SEED_CONTENT + CONFLICT_WORDS + "hello");

    // Native textarea keyboard behavior: Enter inserts a newline, focus
    // stays, nothing traps the keys.
    await user.type(editor, "{Enter}more");
    expect(editor).toHaveValue(SEED_CONTENT + CONFLICT_WORDS + "hello\nmore");
    expect(editor).toHaveFocus();

    // Tab reaches the retry button; Enter activates it.
    await user.tab();
    const retry = screen.getByTestId("notes-retry");
    expect(retry).toHaveFocus();

    // Focus rings are declared at class level (browser checks at the join).
    expect(editor.className).toContain("focus-visible:ring");
    expect(retry.className).toContain("focus-visible:ring");
    expect(retry.className).not.toContain("focus:outline-none");

    // No keyboard trap: the next Tab from the panel's last control leaves
    // the panel entirely.
    await user.tab();
    expect(mounted.container.contains(document.activeElement)).toBe(false);

    // The flush handshake, for real: the refusal clears, Enter fires the
    // actual retryConflicts, the words re-diff from fresh server truth and
    // the editor follows the composed ledger content — every typed word
    // survives into the synced truth.
    retry.focus();
    mounted.gate.faults = {};
    await user.keyboard("{Enter}");
    await badgeShows("Synced");

    const fullText = SEED_CONTENT + CONFLICT_WORDS + "hello\nmore";
    expect(editor).toHaveValue(fullText);
    await waitForServerText(mounted.backend, mounted.meetingId, fullText);
  });

  it("keeps natural tab order (no positive tabindex anywhere)", async () => {
    const mounted = await driveConflictState();
    await settleMotion();
    const hijacked = mounted.container.querySelectorAll(
      "[tabindex]:not([tabindex='0']):not([tabindex='-1'])",
    );
    expect(hijacked).toHaveLength(0);
  });
});

describe("MeetingNotesPanel reduced motion", () => {
  it("prefers-reduced-motion: no animation-affecting props; state visible via text", async () => {
    setPrefersReducedMotion(true);
    const mounted = await driveConflictState();

    // No element carries the animation marker or motion-driven inline styles.
    expect(mounted.container.querySelectorAll("[data-motion]")).toHaveLength(0);
    expect(mounted.container.innerHTML).not.toContain("translate");

    // State changes stay fully visible through text — the loss-proof promise.
    expect(screen.getByTestId("notes-status")).toHaveTextContent("Conflict");
    expect(screen.getByTestId("notes-unsaved-list")).toBeVisible();
    expect(within(screen.getByTestId("notes-unsaved-list")).getByText(
      `“${CONFLICT_WORDS}”`,
    )).toBeInTheDocument();
    expect(screen.getByTestId("notes-editor")).not.toBeDisabled();
  });

  it("default motion: entrance animation present and settles to the visible panel", async () => {
    const mounted = await mountRealLedgerPanel({
      seedText: SEED_CONTENT,
      tag: "default-motion",
    });
    expect(
      mounted.container.querySelectorAll("[data-motion='fade-rise']").length,
    ).toBeGreaterThan(0);
    await settleMotion();
    expect(screen.getByTestId("notes-panel")).toBeVisible();
    await badgeShows("Synced");
  });
});

describe("MeetingNotesPanel responsive classes", () => {
  it("stacks on mobile, row on sm+; editor grows on md+ (class-level only)", async () => {
    await mountRealLedgerPanel({ seedText: SEED_CONTENT, tag: "responsive" });
    await badgeShows("Synced");
    // NOTE: real-pixel responsive checks (1440×900, 390×844) happen in a
    // browser at the join — jsdom has no layout engine, so only the presence
    // of the responsive utilities is asserted here.
    const countsRow = screen.getByTestId("notes-counts").parentElement as HTMLElement;
    expect(countsRow.className).toContain("flex-col");
    expect(countsRow.className).toContain("sm:flex-row");
    const editor = screen.getByTestId("notes-editor");
    expect(editor.className).toContain("min-h-40");
    expect(editor.className).toContain("md:min-h-60");
  });
});
