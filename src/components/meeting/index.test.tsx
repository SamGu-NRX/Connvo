import { describe, expect, it } from "vitest";
import * as MeetingExports from "./index";
import * as CollaborativeNotesEditorModule from "./CollaborativeNotesEditor";
import * as InCallPromptsOverlayModule from "./InCallPromptsOverlay";
import * as LiveTranscriptionPanelModule from "./LiveTranscriptionPanel";
import * as PreCallPromptsCardModule from "./PreCallPromptsCard";

/**
 * Public API surface of the meeting components barrel file.
 *
 * Guarantees:
 * - the barrel re-exports exactly the documented named components
 * - each named export is a callable function component (not undefined — a
 *   broken re-export path would silently yield undefined at import time)
 * - each module's default export is the same component as its named export
 */
describe("components/meeting public API surface", () => {
  const expectedComponents = [
    "CollaborativeNotesEditor",
    "InCallPromptsOverlay",
    "LiveTranscriptionPanel",
    "PreCallPromptsCard",
  ] as const;

  it("exports exactly the four meeting components (no more, no less)", () => {
    const exportedKeys = Object.keys(MeetingExports).sort();
    expect(exportedKeys).toEqual([...expectedComponents].sort());
  });

  it.each(expectedComponents)(
    "%s is a named function-style component export",
    (componentName) => {
      const exported = (MeetingExports as Record<string, unknown>)[componentName];
      expect(exported).toBeDefined();
      expect(typeof exported).toBe("function");
    }
  );

  it("re-exports are identity-equal to their source modules", () => {
    expect(MeetingExports.CollaborativeNotesEditor).toBe(
      CollaborativeNotesEditorModule.CollaborativeNotesEditor
    );
    expect(MeetingExports.InCallPromptsOverlay).toBe(
      InCallPromptsOverlayModule.InCallPromptsOverlay
    );
    expect(MeetingExports.LiveTranscriptionPanel).toBe(
      LiveTranscriptionPanelModule.LiveTranscriptionPanel
    );
    expect(MeetingExports.PreCallPromptsCard).toBe(
      PreCallPromptsCardModule.PreCallPromptsCard
    );
  });

  it("each source module's default export matches its named export", () => {
    expect(CollaborativeNotesEditorModule.default).toBe(
      CollaborativeNotesEditorModule.CollaborativeNotesEditor
    );
    expect(InCallPromptsOverlayModule.default).toBe(
      InCallPromptsOverlayModule.InCallPromptsOverlay
    );
    expect(LiveTranscriptionPanelModule.default).toBe(
      LiveTranscriptionPanelModule.LiveTranscriptionPanel
    );
    expect(PreCallPromptsCardModule.default).toBe(
      PreCallPromptsCardModule.PreCallPromptsCard
    );
  });
});
