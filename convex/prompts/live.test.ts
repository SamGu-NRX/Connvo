import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import {
  createTestEnvironment,
  createTestMeetingWithParticipants,
} from "../../test/convex/helpers";

describe("shared live prompts", () => {
  let t: ReturnType<typeof createTestEnvironment>;
  beforeEach(() => {
    t = createTestEnvironment();
    vi.stubEnv("OPENAI_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  async function fixture() {
    const meeting = await createTestMeetingWithParticipants(
      t,
      {},
      2,
      { state: "active", duration: 1800000 },
      {},
    );
    return {
      ...meeting,
      a: t.withIdentity({ subject: meeting.participantWorkosIds[0] }),
      b: t.withIdentity({ subject: meeting.participantWorkosIds[1] }),
    };
  }
  it("publishes one shared prompt, records used once and retains it for recap", async () => {
    const f = await fixture();
    expect(
      await f.a.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: true,
      }),
    ).toEqual({ status: "shown" });
    const a = await f.a.query(api.prompts.live.current, {
      meetingId: f.meetingId,
    });
    const b = await f.b.query(api.prompts.live.current, {
      meetingId: f.meetingId,
    });
    expect(a.prompt).toEqual(b.prompt);
    expect(a.prompt?.content).toBe(
      "Was there anything you were hoping we'd get to talk about today?",
    );
    if (!a.prompt) throw new Error("Expected a prompt");
    await f.b.mutation(api.prompts.live.markUsed, {
      meetingId: f.meetingId,
      promptId: a.prompt.id,
    });
    const used = await t.run((ctx) => ctx.db.get(a.prompt!.id));
    await f.a.mutation(api.prompts.live.markUsed, {
      meetingId: f.meetingId,
      promptId: a.prompt.id,
    });
    await t.mutation(internal.prompts.mutations.cleanupOldPrompts, {
      meetingId: f.meetingId,
      type: "incall",
      keepCount: 0,
    });
    const retained = await t.run((ctx) => ctx.db.get(a.prompt!.id));
    expect(retained?.usedAt).toBe(used?.usedAt);
    expect(retained?.feedback).toBe("used");
    vi.stubEnv("CONNVO_AFTER_CALL", "1");
    const history = await f.a.query(api.history.queries.getMeetingHistory, {
      meetingId: f.meetingId,
    });
    expect(history.prompts.map((p) => p.content)).toContain(a.prompt.content);
  });
  it("refuses outsiders before external work, reads and writes", async () => {
    const f = await fixture();
    const other = await fixture();
    const outsider = other.a;
    await expect(
      outsider.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: false,
      }),
    ).rejects.toThrow("Not a meeting participant");
    await expect(
      outsider.query(api.prompts.live.current, { meetingId: f.meetingId }),
    ).rejects.toThrow("Not a meeting participant");
    await expect(
      outsider.mutation(api.prompts.live.pauseAuto, {
        meetingId: f.meetingId,
        paused: true,
      }),
    ).rejects.toThrow("Not a meeting participant");
    expect(
      await f.a.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: false,
      }),
    ).toEqual({ status: "shown" });
    const state = await f.a.query(api.prompts.live.current, {
      meetingId: f.meetingId,
    });
    await expect(
      outsider.mutation(api.prompts.live.markUsed, {
        meetingId: f.meetingId,
        promptId: state.prompt!.id,
      }),
    ).rejects.toThrow("Not a meeting participant");
  });
  it("serializes simultaneous requests from both participants", async () => {
    const f = await fixture();
    const results = await Promise.all(
      [f.a, f.b].map((client, i) =>
        client.mutation(internal.prompts.live.reserve, {
          meetingId: f.meetingId,
          automatic: true,
          reservationId: `request-${i}`,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      "pending",
      "reserved",
    ]);
  });
  it("enforces manual cooldown and a five-per-ten-minute meeting cap", async () => {
    const f = await fixture();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    for (let i = 0; i < 5; i++) {
      expect(
        await f.a.action(api.prompts.live.pick, {
          meetingId: f.meetingId,
          automatic: false,
        }),
      ).toEqual({ status: "shown" });
      expect(
        await f.b.action(api.prompts.live.pick, {
          meetingId: f.meetingId,
          automatic: false,
        }),
      ).toEqual({ status: "rate_limited" });
      now += 10_001;
    }
    expect(
      await f.b.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: false,
      }),
    ).toEqual({ status: "rate_limited" });
    now += 600_000;
    expect(
      await f.b.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: false,
      }),
    ).toEqual({ status: "shown" });
  });
  it("waits for idle notes, shares pause and drops an auto pick if notes change", async () => {
    const f = await fixture();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await f.a.action(api.prompts.live.pick, {
      meetingId: f.meetingId,
      automatic: true,
    });
    now += 90_001;
    const noteId = await t.run((ctx) =>
      ctx.db.insert("meetingNotes", {
        meetingId: f.meetingId,
        content: "Talking about books",
        version: 1,
        lastRebasedAt: now,
        updatedAt: now,
      }),
    );
    expect(
      await f.a.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: true,
      }),
    ).toEqual({ status: "idle_wait" });
    await f.b.mutation(api.prompts.live.pauseAuto, {
      meetingId: f.meetingId,
      paused: true,
    });
    expect(
      (await f.a.query(api.prompts.live.current, { meetingId: f.meetingId }))
        .autoPaused,
    ).toBe(true);
    now += 90_001;
    expect(
      await f.a.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: true,
      }),
    ).toEqual({ status: "paused" });
    await f.b.mutation(api.prompts.live.pauseAuto, {
      meetingId: f.meetingId,
      paused: false,
    });
    const reserved = await f.a.mutation(internal.prompts.live.reserve, {
      meetingId: f.meetingId,
      automatic: true,
      reservationId: "stale-notes",
    });
    expect(reserved.status).toBe("reserved");
    if (reserved.status === "reserved")
      expect(reserved.context.notes).toBe("Talking about books");
    await t.run((ctx) => ctx.db.patch(noteId, { updatedAt: now + 1 }));
    expect(
      await f.a.mutation(internal.prompts.live.publish, {
        meetingId: f.meetingId,
        reservationId: "stale-notes",
        bankId: "opener-small-highlight",
        probability: 0,
      }),
    ).toBe(false);
    expect(
      (await f.a.query(api.prompts.live.current, { meetingId: f.meetingId }))
        .prompt?.content,
    ).toBe("Was there anything you were hoping we'd get to talk about today?");
  });
  it("recovers an abandoned reservation and rejects its late result", async () => {
    const f = await fixture();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await f.a.mutation(internal.prompts.live.reserve, {
      meetingId: f.meetingId,
      automatic: true,
      reservationId: "old",
    });
    now += 15_001;
    expect(
      await f.b.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: true,
      }),
    ).toEqual({ status: "idle_wait" });
    now += 75_000;
    expect(
      await f.b.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: true,
      }),
    ).toEqual({ status: "shown" });
    expect(
      await f.a.mutation(internal.prompts.live.publish, {
        meetingId: f.meetingId,
        reservationId: "old",
        bankId: "opener-small-highlight",
        probability: 0,
      }),
    ).toBe(false);
  });
  it("counts discarded first picks against the automatic rate and request budget", async () => {
    const f = await fixture();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    for (let i = 0; i < 40; i++) {
      expect(
        (
          await f.a.mutation(internal.prompts.live.reserve, {
            meetingId: f.meetingId,
            automatic: true,
            reservationId: `discard-${i}`,
          })
        ).status,
      ).toBe("reserved");
      await f.b.mutation(api.prompts.live.pauseAuto, {
        meetingId: f.meetingId,
        paused: true,
      });
      expect(
        await f.a.mutation(internal.prompts.live.publish, {
          meetingId: f.meetingId,
          reservationId: `discard-${i}`,
          bankId: "opener-small-highlight",
          probability: 0,
        }),
      ).toBe(false);
      await f.b.mutation(api.prompts.live.pauseAuto, {
        meetingId: f.meetingId,
        paused: false,
      });
      const view = await f.b.query(api.prompts.live.current, {
        meetingId: f.meetingId,
      });
      expect(view.nextAutoAt).toBe(now + 90_000);
      expect(
        (
          await f.b.action(api.prompts.live.pick, {
            meetingId: f.meetingId,
            automatic: true,
          })
        ).status,
      ).toBe(i === 39 ? "exhausted" : "idle_wait");
      now += 90_001;
    }
    expect(
      await f.a.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: false,
      }),
    ).toEqual({ status: "exhausted" });
    expect(
      (await f.a.query(api.prompts.live.current, { meetingId: f.meetingId }))
        .exhausted,
    ).toBe(true);
  });
  it("never starts or publishes after the meeting ends", async () => {
    const f = await fixture();
    await f.a.mutation(internal.prompts.live.reserve, {
      meetingId: f.meetingId,
      automatic: true,
      reservationId: "ending",
    });
    await t.run((ctx) => ctx.db.patch(f.meetingId, { state: "concluded" }));
    expect(
      await f.a.mutation(internal.prompts.live.publish, {
        meetingId: f.meetingId,
        reservationId: "ending",
        bankId: "opener-small-highlight",
        probability: 0,
      }),
    ).toBe(false);
    expect(
      await f.a.action(api.prompts.live.pick, {
        meetingId: f.meetingId,
        automatic: false,
      }),
    ).toEqual({ status: "inactive" });
  });
});
