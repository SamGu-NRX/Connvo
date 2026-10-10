import { describe, expect, it } from "vitest";
import {
  EXCLUDED_PROFILE_FIELDS,
  PERMITTED_PROFILE_FIELDS,
  type InternalProfile,
} from "../src/contract";
import {
  INTERNAL_PROFILES,
  PEER_ID,
  STRANGER_ID,
  VIEWER_ID,
  VISIBILITY_GRANTS,
} from "../src/fixtures";
import { excludedFieldLeaks, projectProfile } from "../src/projection";

function findProfile(userId: string): InternalProfile {
  const profile = INTERNAL_PROFILES.find((p) => p.userId === userId);
  if (!profile) throw new Error(`missing fixture profile for ${userId}`);
  return profile;
}

describe("permitted profile projection", () => {
  it("shows the viewer their own profile under the 'self' grant", () => {
    const viewer = findProfile(VIEWER_ID);
    const result = projectProfile(viewer, { viewerId: VIEWER_ID, basis: "self" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.displayName).toBe("Riley Chen");
  });

  it("shows the viewer the peer's public projection under the 'shared-meeting' grant", () => {
    const peer = findProfile(PEER_ID);
    const result = projectProfile(peer, { viewerId: VIEWER_ID, basis: "shared-meeting" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.displayName).toBe("Noor Haddad");
  });

  it("rejects a stranger with basis 'none' (not-visible)", () => {
    const peer = findProfile(PEER_ID);
    const result = projectProfile(peer, { viewerId: STRANGER_ID, basis: "none" });
    expect(result).toEqual({ ok: false, reason: "not-visible" });
  });

  it("admits a same-org basis (unit-level), still restricted to permitted fields", () => {
    const peer = findProfile(PEER_ID);
    const result = projectProfile(peer, { viewerId: "u_synth_orgmate", basis: "same-org" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.profile).every((k) => k === "userId" || (PERMITTED_PROFILE_FIELDS as readonly string[]).includes(k))).toBe(true);
  });

  it("leaks zero excluded fields across every fixture profile and every grant kind (9 checks: 3 visible (profile, grant) pairs x 3 excluded fields)", () => {
    const grants = [
      { viewerId: VIEWER_ID, basis: "self" as const },
      { viewerId: VIEWER_ID, basis: "shared-meeting" as const },
      { viewerId: STRANGER_ID, basis: "none" as const },
    ];
    let checks = 0;
    for (const profile of INTERNAL_PROFILES) {
      for (const grant of grants) {
        const result = projectProfile(profile, grant);
        if (!result.ok) continue; // not-visible: nothing leaks at all
        for (const field of EXCLUDED_PROFILE_FIELDS) {
          expect(field in result.profile).toBe(false);
          expect(excludedFieldLeaks(result.profile as unknown as Record<string, unknown>)).toEqual([]);
          checks++;
        }
      }
    }
    // Visible pairs: (viewer, self), (viewer, shared-meeting over own profile), (peer, shared-meeting).
    // The "self" grant admits only the viewer's own profile, and the stranger
    // grant short-circuits before any field is copied.
    expect(checks).toBe(9);
  });

  it("copies only permitted fields, dropping keys that are undefined on the profile", () => {
    const viewer = findProfile(VIEWER_ID);
    const result = projectProfile(viewer, { viewerId: VIEWER_ID, basis: "self" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = Object.keys(result.profile).sort();
    expect(keys).toEqual(
      [
        "userId",
        "displayName",
        "bio",
        "goals",
        "languages",
        "experience",
        "field",
        "jobTitle",
        "company",
      ].sort(),
    );
  });

  it("carries no values from excluded internal fields even when the projection is re-serialized", () => {
    const peer = findProfile(PEER_ID);
    const result = projectProfile(peer, { viewerId: VIEWER_ID, basis: "shared-meeting" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.profile);
    for (const value of [peer.age, peer.gender, peer.linkedinUrl]) {
      expect(serialized).not.toContain(JSON.stringify(value));
    }
  });
});

describe("projection vs fixture grants", () => {
  it("every fixture grant resolves consistently with its basis", () => {
    for (const grant of VISIBILITY_GRANTS) {
      const target = findProfile(grant.targetId);
      const result = projectProfile(target, { viewerId: grant.viewerId, basis: grant.basis });
      if (grant.basis === "none") {
        expect(result.ok).toBe(false);
      } else {
        expect(result.ok).toBe(true);
      }
    }
  });
});
