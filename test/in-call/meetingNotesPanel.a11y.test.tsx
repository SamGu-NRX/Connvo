/**
 * M3 mounted panel matrix (docs/notes-ledger-f1/design.md §5, panel part).
 *
 * The real ledger hook lands with the ledger milestone (M2) — these tests mock
 * `@/hooks/notes` with `vi.mock` factories returning the PINNED interface in
 * each state and assert what a user observes: mounted renders (never
 * renderToStaticMarkup), jest-axe results, live-region text, keyboard paths
 * and reduced-motion behavior.
 *
 * Mock semantics mirror the hook contract: `onEdit` opens an editing session
 * (isEditing), the flush handshake returns composed content, and unsaved
 * records keep the user's words visible.
 */

import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { UseNotesLedgerResult } from "@/hooks/notes";
import { MeetingNotesPanel } from "@/components/meeting-notes/MeetingNotesPanel";
import { setPrefersReducedMotion } from "./matchMediaDouble";

const MEETING_ID = "demo-meeting" as Id<"meetings">;
const SEED_CONTENT = "Agenda: ship the notes ledger\n";

const h = vi.hoisted(() => ({
  ledger: null as UseNotesLedgerResult | null,
  onEdits: [] as string[],
  flushCount: 0,
  retryCount: 0,
}));

vi.mock("@/hooks/notes", () => ({
  // Pass-through provider: unit tests seed ledger state directly.
  NotesTransportProvider: ({ children }: { children: React.ReactNode }) => children,
  // Interim until the real-hook swap: the joined panel derives its stable
  // identity above the ledger; the mock pins one so seeds are deterministic.
  useStableNotesClientId: () => "a11y-client",
  useNotesTransport: () => {
    throw new Error("unit tests inject ledger state directly");
  },
  useNotesLedger: () => {
    const current = h.ledger;
    if (!current) {
      throw new Error("test must seed ledger state before render");
    }
    return {
      ...current,
      onEdit: (text: string) => {
        h.onEdits.push(text);
        // Contract behavior under test: the first change opens an editing
        // session; the composed content is untouched until a flush.
        h.ledger = { ...current, isEditing: true };
      },
      flushNow: () => {
        h.flushCount += 1;
      },
      retryConflicts: () => {
        h.retryCount += 1;
      },
    };
  },
}));

function makeUnsavedRecord(
  overrides: Partial<UseNotesLedgerResult["unsavedRecords"][number]> = {},
): UseNotesLedgerResult["unsavedRecords"][number] {
  return {
    clientOpId: "op-1",
    state: "pending",
    content: "some unsent words",
    attempts: 1,
    ...overrides,
  };
}

function makeLedger(
  overrides: Partial<UseNotesLedgerResult> = {},
): UseNotesLedgerResult {
  return {
    content: SEED_CONTENT,
    version: 7,
    isLoading: false,
    status: "synced",
    unconfirmedCount: 0,
    unsavedRecords: [],
    isEditing: false,
    onEdit: () => {},
    flushNow: () => {},
    retryConflicts: () => {},
    transportOnline: true,
    ...overrides,
  };
}

function seedLedger(state: UseNotesLedgerResult) {
  h.ledger = state;
}

function renderPanel() {
  // `main` supplies the landmark a page shell provides in the app, so the
  // component-scoped axe run reflects the panel itself.
  return render(
    <main>
      <MeetingNotesPanel meetingId={MEETING_ID} />
    </main>,
  );
}

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

const CONFLICT_RECORD = makeUnsavedRecord({
  clientOpId: "op-conflict-1",
  state: "conflict",
  content: "decision: postmortem Thursday",
  attempts: 2,
});

const STATE_CASES: Array<[string, UseNotesLedgerResult, string]> = [
  ["loading", makeLedger({ status: "loading", isLoading: true, version: 0, content: "" }), "Loading"],
  ["synced", makeLedger(), "Synced"],
  ["saving", makeLedger({ status: "saving" }), "Saving"],
  [
    "unconfirmed",
    makeLedger({
      status: "unconfirmed",
      unconfirmedCount: 2,
      unsavedRecords: [
        makeUnsavedRecord({ clientOpId: "op-u1", state: "unconfirmed", content: "todo: send the recap" }),
        makeUnsavedRecord({ clientOpId: "op-u2", state: "sending", content: "and the metrics" }),
      ],
    }),
    "Unconfirmed (2)",
  ],
  ["conflict", makeLedger({ status: "conflict", unsavedRecords: [CONFLICT_RECORD] }), "Conflict"],
  ["offline", makeLedger({ status: "offline", transportOnline: false }), "Offline"],
  [
    "updating",
    makeLedger({
      status: "updating",
      unsavedRecords: [makeUnsavedRecord({ clientOpId: "op-p1", state: "pending", content: "parked mid-sentence" })],
    }),
    "Updating",
  ],
];

beforeEach(() => {
  h.ledger = null;
  h.onEdits = [];
  h.flushCount = 0;
  h.retryCount = 0;
});

describe("MeetingNotesPanel honest state matrix", () => {
  it.each(STATE_CASES)(
    "state %s: axe-clean, polite live region, exact status label",
    async (_name, ledger, expectedLabel) => {
      seedLedger(ledger);
      const { container } = renderPanel();
      await settleMotion();

      const results = await auditPanel(container);
      expect(results).toHaveNoViolations();

      const region = screen.getByRole("status");
      expect(region).toHaveAttribute("aria-live", "polite");
      const statusBadge = within(region).getByTestId("notes-status");
      expect(statusBadge).toHaveTextContent(expectedLabel);

      const editor = screen.getByTestId("notes-editor");
      if (ledger.isLoading) {
        expect(editor).toBeDisabled();
      } else {
        expect(editor).not.toBeDisabled();
      }

      // The ledger's composed truth is what the editor shows when not editing.
      expect(editor).toHaveValue(ledger.content);
    },
  );

  it.each(STATE_CASES.filter(([name]) => name !== "synced"))(
    "state %s never renders a plain Saved label",
    async (_name, ledger) => {
      seedLedger(ledger);
      renderPanel();
      await settleMotion();
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    },
  );

  it("unconfirmed state: unsaved list keeps the words visible with state words", async () => {
    seedLedger(STATE_CASES[3][1]);
    const { container } = renderPanel();
    await settleMotion();

    const results = await auditPanel(container);
    expect(results).toHaveNoViolations();

    const list = screen.getByTestId("notes-unsaved-list");
    expect(list).toBeVisible();
    expect(within(list).getByText("Unconfirmed")).toBeInTheDocument();
    expect(within(list).getByText("“todo: send the recap”")).toBeInTheDocument();
    expect(within(list).getByText("“and the metrics”")).toBeInTheDocument();
    // Pending-style records get no retry affordance: retryConflicts only
    // recomputes conflicted/rejected ops — the button must not promise more.
    expect(screen.queryByTestId("notes-retry")).not.toBeInTheDocument();
  });

  it("conflict state: words stay visible and retry is offered", async () => {
    seedLedger(STATE_CASES[4][1]);
    const { container } = renderPanel();
    await settleMotion();

    const results = await auditPanel(container);
    expect(results).toHaveNoViolations();

    const list = screen.getByTestId("notes-unsaved-list");
    expect(within(list).getByText("Conflict")).toBeInTheDocument();
    expect(within(list).getByText("“decision: postmortem Thursday”")).toBeInTheDocument();
    expect(within(list).getByText("attempt 2")).toBeInTheDocument();

    const retry = screen.getByTestId("notes-retry");
    expect(retry).toBeVisible();
    retry.click();
    expect(h.retryCount).toBe(1);
  });

  it("offline state: typing still works (editor never disabled while syncing)", async () => {
    seedLedger(STATE_CASES[5][1]);
    const user = userEvent.setup();
    renderPanel();
    await settleMotion();

    const editor = screen.getByTestId("notes-editor");
    expect(editor).not.toBeDisabled();
    await user.type(editor, "typing offline");
    expect(h.onEdits.at(-1)).toBe(SEED_CONTENT + "typing offline");
  });
});

describe("MeetingNotesPanel keyboard access", () => {
  it("walkthrough: textarea → typing → retry via Enter → no trap → focus-visible rings", async () => {
    seedLedger(STATE_CASES[4][1]); // conflict state: retry visible
    const user = userEvent.setup();
    const { container, rerender } = renderPanel();
    await settleMotion();

    // First Tab stop is the editor.
    const editor = screen.getByTestId("notes-editor");
    await user.tab();
    expect(editor).toHaveFocus();

    // Typing flows through the hook contract; the draft mirror shows the keys.
    await user.type(editor, "hello");
    expect(h.onEdits.at(-1)).toBe(SEED_CONTENT + "hello");
    expect(editor).toHaveValue(SEED_CONTENT + "hello");

    // Native textarea keyboard behavior: Enter inserts a newline, focus stays,
    // nothing traps the keys.
    await user.type(editor, "{Enter}more");
    expect(editor).toHaveValue(SEED_CONTENT + "hello\nmore");
    expect(editor).toHaveFocus();

    // Tab reaches the retry button; Enter activates it.
    await user.tab();
    const retry = screen.getByTestId("notes-retry");
    expect(retry).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(h.retryCount).toBe(1);

    // No keyboard trap: the next Tab leaves the panel.
    await user.tab();
    expect(container.contains(document.activeElement)).toBe(false);

    // Focus rings are declared at class level (browser checks at the join).
    expect(editor.className).toContain("focus-visible:ring");
    expect(retry.className).toContain("focus-visible:ring");
    expect(retry.className).not.toContain("focus:outline-none");

    // The flush handshake: hook reports editing ended with composed truth —
    // the editor follows the ledger content and the conflict words stay visible.
    seedLedger(
      makeLedger({
        status: "saving",
        isEditing: false,
        content: SEED_CONTENT + "hello",
        unsavedRecords: [CONFLICT_RECORD],
      }),
    );
    rerender(
      <main>
        <MeetingNotesPanel meetingId={MEETING_ID} />
      </main>,
    );
    expect(editor).toHaveValue(SEED_CONTENT + "hello");
    expect(within(screen.getByTestId("notes-unsaved-list")).getByText(
      "“decision: postmortem Thursday”",
    )).toBeInTheDocument();
  });

  it("keeps natural tab order (no positive tabindex anywhere)", async () => {
    seedLedger(STATE_CASES[4][1]);
    const { container } = renderPanel();
    await settleMotion();
    const hijacked = container.querySelectorAll("[tabindex]:not([tabindex='0']):not([tabindex='-1'])");
    expect(hijacked).toHaveLength(0);
  });
});

describe("MeetingNotesPanel reduced motion", () => {
  it("prefers-reduced-motion: no animation-affecting props; state visible via text", () => {
    setPrefersReducedMotion(true);
    seedLedger(STATE_CASES[4][1]); // conflict state
    const { container } = renderPanel();

    // No element carries the animation marker or motion-driven inline styles.
    expect(container.querySelectorAll("[data-motion]")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("translate");

    // State changes stay fully visible through text — the loss-proof promise.
    expect(screen.getByTestId("notes-status")).toHaveTextContent("Conflict");
    expect(screen.getByTestId("notes-unsaved-list")).toBeVisible();
    expect(within(screen.getByTestId("notes-unsaved-list")).getByText(
      "“decision: postmortem Thursday”",
    )).toBeInTheDocument();
    expect(screen.getByTestId("notes-editor")).not.toBeDisabled();
  });

  it("default motion: entrance animation present and settles to the visible panel", async () => {
    setPrefersReducedMotion(false);
    seedLedger(makeLedger());
    const { container } = renderPanel();
    expect(container.querySelectorAll("[data-motion='fade-rise']").length).toBeGreaterThan(0);
    await settleMotion();
    expect(screen.getByTestId("notes-panel")).toBeVisible();
    expect(screen.getByTestId("notes-status")).toHaveTextContent("Synced");
  });
});

describe("MeetingNotesPanel responsive classes", () => {
  it("stacks on mobile, row on sm+; editor grows on md+ (class-level only)", () => {
    seedLedger(makeLedger());
    renderPanel();
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
