// @vitest-environment node
/**
 * Mounted proof for MeetingRecap: the exported component renders the
 * recap builder output verbatim. Static markup only — the repo has no
 * jsdom, so the component is mounted with react-dom/server.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MeetingRecap } from "./MeetingRecap";

const recap = {
  sections: [
    {
      kind: "participants",
      title: "Participants",
      items: ["Dana Kim (host)", "j57u2 (participant)"],
    },
    { kind: "duration", title: "Duration", items: ["30 minutes"] },
    {
      kind: "notes",
      title: "Shared notes",
      items: ["Follow up on pricing (version 3)"],
    },
  ],
  sources: {
    participants: true,
    duration: true,
    lifecycleEvents: false,
    notes: true,
    prompts: false,
  },
};

describe("MeetingRecap", () => {
  it("renders every section title and item verbatim, in order", () => {
    const html = renderToStaticMarkup(createElement(MeetingRecap, { recap }));
    expect(html).toContain("Recap");
    expect(html).toContain("Participants");
    expect(html).toContain("Dana Kim (host)");
    expect(html).toContain("j57u2 (participant)");
    expect(html).toContain("Duration");
    expect(html).toContain("30 minutes");
    expect(html).toContain("Shared notes");
    expect(html).toContain("Follow up on pricing (version 3)");
    const participantsAt = html.indexOf("Participants");
    const durationAt = html.indexOf("Duration");
    const notesAt = html.indexOf("Shared notes");
    expect(participantsAt).toBeGreaterThan(-1);
    expect(durationAt).toBeGreaterThan(participantsAt);
    expect(notesAt).toBeGreaterThan(durationAt);
  });

  it("exposes a labeled region for assistive tech", () => {
    const html = renderToStaticMarkup(createElement(MeetingRecap, { recap }));
    expect(html).toContain('data-testid="meeting-recap"');
    expect(html).toContain('aria-labelledby="meeting-recap-heading"');
    expect(html).toContain('id="meeting-recap-heading"');
  });

  it("passes className through", () => {
    const html = renderToStaticMarkup(
      createElement(MeetingRecap, { recap, className: "mt-4" }),
    );
    expect(html).toContain("mt-4");
  });
});
