import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CollaborativeNotesEditor } from "@/components/meeting/CollaborativeNotesEditor";
import type { NoteOperation } from "@/hooks/useCollaborativeNotes";

const backend = vi.hoisted(() => ({
  content: "",
  isLoading: false,
  isSyncing: false,
  applyOperation: vi.fn<(operation: NoteOperation) => Promise<void>>(),
}));

vi.mock("@/hooks/useCollaborativeNotes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCollaborativeNotes")>()),
  useCollaborativeNotes: () => ({
    notes: null,
    content: backend.content,
    isLoading: backend.isLoading,
    isSyncing: backend.isSyncing,
    applyOperation: backend.applyOperation,
  }),
}));

const meetingId = "meeting-editor" as Id<"meetings">;
const editor = () => <CollaborativeNotesEditor meetingId={meetingId} />;

beforeEach(() => {
  vi.useFakeTimers();
  backend.content = "";
  backend.isLoading = false;
  backend.isSyncing = false;
  backend.applyOperation.mockReset();
  backend.applyOperation.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

test("initializes from notes that arrive after loading without saving them", () => {
  backend.isLoading = true;
  const view = render(editor());
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

  backend.content = "Shared first draft";
  backend.isLoading = false;
  view.rerender(editor());
  expect(screen.getByRole("textbox")).toHaveValue("Shared first draft");
  expect(screen.getByText("3 words")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(500));
  expect(backend.applyOperation).not.toHaveBeenCalled();
});

test("adopts remote changes and remote deletion while idle", () => {
  backend.content = "Original";
  const view = render(editor());
  expect(screen.getByRole("textbox")).toHaveValue("Original");

  backend.content = "A participant revised this";
  view.rerender(editor());
  expect(screen.getByRole("textbox")).toHaveValue("A participant revised this");

  backend.content = "";
  view.rerender(editor());
  expect(screen.getByRole("textbox")).toHaveValue("");
  expect(screen.getByText("0 characters")).toBeInTheDocument();
});

test("keeps edits visible and debounces the latest edit for 500ms", async () => {
  backend.content = "Draft";
  render(editor());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft A" } });
  act(() => vi.advanceTimersByTime(400));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft AB" } });
  act(() => vi.advanceTimersByTime(499));
  expect(screen.getByRole("textbox")).toHaveValue("Draft AB");
  expect(backend.applyOperation).not.toHaveBeenCalled();

  backend.applyOperation.mockImplementation(async () => {
    backend.content = "Draft AB";
  });
  await act(async () => vi.advanceTimersByTime(1));
  expect(backend.applyOperation).toHaveBeenCalledExactlyOnceWith({
    type: "insert", position: 5, text: " AB",
  });
  expect(screen.getByRole("textbox")).toHaveValue("Draft AB");
  expect(screen.getByText("Saved")).toBeInTheDocument();
});

test("holds local content during a save and adopts remote content after confirmation", async () => {
  backend.content = "Draft";
  let confirmSave: () => void = () => { throw new Error("Save has not started"); };
  backend.applyOperation.mockImplementation(() => new Promise<void>((resolve) => {
    confirmSave = resolve;
  }));
  const view = render(editor());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft edited" } });
  await act(async () => vi.advanceTimersByTime(500));
  expect(screen.getByText("Syncing...")).toBeInTheDocument();

  backend.content = "Draft edited by peer";
  view.rerender(editor());
  expect(screen.getByRole("textbox")).toHaveValue("Draft edited");
  await act(async () => confirmSave());
  expect(screen.getByRole("textbox")).toHaveValue("Draft edited by peer");
  expect(screen.getByText("Saved")).toBeInTheDocument();
  expect(backend.applyOperation).toHaveBeenCalledExactlyOnceWith({
    type: "insert", position: 5, text: " edited",
  });
});
