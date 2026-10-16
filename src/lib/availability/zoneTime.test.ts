import { describe, expect, it } from "vitest";
import { wallToInstant, zoneWeekdayMinute } from "./zoneTime";

/**
 * Adversarial DST tests for the one shared wall-clock rule. Each case pins a
 * behavior that at least one of the two former two-pass implementations got
 * wrong on one side of UTC: the rule documented in ./zoneTime must hold in
 * every zone — east or west of UTC, northern or southern hemisphere, with or
 * without DST.
 *
 * Convention note: wallToInstant takes 1-based months (see ./zoneTime), while
 * the Date.UTC expectations below take 0-based months. 2026-10-25 in
 * wallToInstant is Date.UTC(2026, 9, 25) here.
 */

describe("wallToInstant: the documented DST rule, in every zone", () => {
  it("Europe/London fall-back repeat resolves to the earlier instant", () => {
    // 2026-10-25: 01:30 BST (= 00:30Z) happens, the clock falls back, and
    // 01:30 GMT (= 01:30Z) happens again. The rule promises the earlier one;
    // the old two-pass refinement converged on 01:30Z for this east-of-UTC
    // zone while promising the earlier instant (the Greptile P1).
    expect(wallToInstant("Europe/London", 2026, 10, 25, 90)).toBe(
      Date.UTC(2026, 9, 25, 0, 30),
    );
  });

  it("America/Chicago fall-back repeat resolves to the earlier instant too", () => {
    // 2025-11-02: 01:30 CDT (= 06:30Z), then again as 01:30 CST (= 07:30Z).
    expect(wallToInstant("America/Chicago", 2025, 11, 2, 90)).toBe(
      Date.UTC(2025, 10, 2, 6, 30),
    );
  });

  it("America/Chicago spring-forward gap resolves on the pre-transition side", () => {
    // 2026-03-08: wall 02:30 does not exist. The client's old copy resolved
    // it to 07:30Z (wall 01:30 CST) while the matcher's old copy resolved it
    // to 08:30Z (wall 03:30 CDT) — the refinement probed opposite sides of
    // the transition. One rule: the pre-transition offset gives 07:30Z.
    expect(wallToInstant("America/Chicago", 2026, 3, 8, 150)).toBe(
      Date.UTC(2026, 2, 8, 7, 30),
    );
  });

  it("Europe/London spring-forward gap resolves on the pre-transition side", () => {
    // 2026-03-29: wall 01:30 does not exist; 00:30Z keeps it on the GMT side.
    expect(wallToInstant("Europe/London", 2026, 3, 29, 90)).toBe(
      Date.UTC(2026, 2, 29, 0, 30),
    );
  });

  it("Australia/Sydney (southern hemisphere) fall-back repeat resolves earlier", () => {
    // 2026-04-05: 02:30 AEDT (= Apr 4 15:30Z), then again as 02:30 AEST
    // (= 16:30Z). Both old copies converged on the later 16:30Z here; the
    // rule holds regardless of hemisphere.
    expect(wallToInstant("Australia/Sydney", 2026, 4, 5, 150)).toBe(
      Date.UTC(2026, 3, 4, 15, 30),
    );
  });

  it("Australia/Sydney spring-forward gap resolves on the pre-transition side", () => {
    // 2026-10-04: wall 02:30 does not exist; Oct 3 15:30Z keeps it on the
    // AEST side. The client's old copy produced 16:30Z here.
    expect(wallToInstant("Australia/Sydney", 2026, 10, 4, 150)).toBe(
      Date.UTC(2026, 9, 3, 15, 30),
    );
  });

  it("Asia/Kolkata has no DST: the wall time maps flat all year", () => {
    expect(wallToInstant("Asia/Kolkata", 2026, 6, 15, 540)).toBe(
      Date.UTC(2026, 5, 15, 3, 30),
    );
    expect(wallToInstant("Asia/Kolkata", 2026, 12, 25, 600)).toBe(
      Date.UTC(2026, 11, 25, 4, 30),
    );
  });

  it("a time that happens once round-trips through its zone", () => {
    // Wednesday 2026-06-03 09:00 Chicago; Sunday 2026-06-07 12:00 London;
    // Wednesday 2026-06-10 09:00 Sydney; Monday 2026-06-15 09:00 Kolkata.
    const cases: Array<[string, number, number, number, number, number]> = [
      ["America/Chicago", 2026, 6, 3, 540, 3],
      ["Europe/London", 2026, 6, 7, 720, 0],
      ["Australia/Sydney", 2026, 6, 10, 540, 3],
      ["Asia/Kolkata", 2026, 6, 15, 540, 1],
    ];
    for (const [zone, year, month, day, minute, weekday] of cases) {
      const instant = wallToInstant(zone, year, month, day, minute);
      expect(zoneWeekdayMinute(new Date(instant), zone)).toEqual({
        weekday,
        minute,
      });
    }
  });

  it("an end minute of 1440 is the next day's midnight", () => {
    expect(wallToInstant("America/Chicago", 2026, 6, 7, 1440)).toBe(
      wallToInstant("America/Chicago", 2026, 6, 8, 0),
    );
  });
});
