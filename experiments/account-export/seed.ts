/**
 * Deterministic fixture seeding for the account-export study.
 *
 * Inserts the fixture universe into a convex-test backend in a fixed order
 * (so document ids are stable across runs), removes the removed-member
 * participant row, and classifies every seeded row through the projection
 * policy's single decision function (decideRowClass) to produce the
 * owner/shared/excluded fixture counts the study commits.
 */

import { decideRowClass, TABLE_POLICIES, type AccessClass } from "./projection";

// ---------------------------------------------------------------------------
// Fixture shape (mirrors fixtures.json; loose typing on purpose)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Fixture {
  fixtureId: string;
  callerRef: string;
  clock: number;
  users: any[];
  interests: any[];
  connections: any[];
  meetings: any[];
}

export interface ClassifiedRow {
  table: string;
  ref: string;
  id: string;
  class: AccessClass;
  reason: string;
}

export interface SeedResult {
  refToId: Record<string, string>;
  idToRef: Record<string, string>;
  classification: ClassifiedRow[];
  classCounts: { owner: number; shared: number; excluded: number; total: number };
}

export const LARGE_TEXT_LENGTH = 200_000;

function largeText(): string {
  const unit = "m1 large transcript segment content word ";
  const repeats = Math.ceil(LARGE_TEXT_LENGTH / unit.length);
  return unit.repeat(repeats).slice(0, LARGE_TEXT_LENGTH);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

type TestConvex = {
  run: (fn: (ctx: any) => Promise<void>) => Promise<void>;
};

export async function seedFixture(t: TestConvex, fixture: Fixture): Promise<SeedResult> {
  const now = fixture.clock;
  const refToId: Record<string, string> = {};
  const idToRef: Record<string, string> = {};
  const classification: ClassifiedRow[] = [];

  const callerRef = fixture.callerRef;

  // caller's role per meeting ref (null = no participation)
  const callerRoleByMeeting: Record<string, "host" | "participant" | "observer" | null> = {};
  for (const meeting of fixture.meetings) {
    const mine = (meeting.participants as any[]).find((p) => p.userRef === callerRef);
    callerRoleByMeeting[meeting.ref] = mine ? mine.role : null;
  }

  const classify = (
    table: string,
    ref: string,
    id: string,
    ctx: Record<string, unknown>,
  ) => {
    const decision = decideRowClass({ table, callerRef, ...ctx } as any);
    classification.push({ table, ref, id, class: decision.class, reason: decision.reason });
  };

  await t.run(async (ctx: any) => {
    // 1. users + user-keyed rows --------------------------------------------
    for (const u of fixture.users) {
      const userId = await ctx.db.insert("users", {
        workosUserId: u.workosUserId,
        email: u.email,
        orgId: u.orgId,
        orgRole: u.orgRole,
        displayName: u.displayName,
        isActive: u.isActive,
        lastSeenAt: now,
        onboardingComplete: true,
        onboardingStartedAt: now - 1000,
        onboardingCompletedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      refToId[u.ref] = userId;
      idToRef[userId] = u.ref;
      classify("users", u.ref, userId, { userRef: u.ref });

      if (u.profile) {
        const pid = await ctx.db.insert("profiles", {
          userId,
          displayName: u.profile.displayName ?? u.displayName,
          bio: u.profile.bio ?? undefined,
          goals: u.profile.goals ?? undefined,
          languages: u.profile.languages ?? [],
          experience: u.profile.experience ?? undefined,
          age: u.profile.age ?? undefined,
          gender: u.profile.gender ?? undefined,
          field: u.profile.field ?? undefined,
          jobTitle: u.profile.jobTitle ?? undefined,
          company: u.profile.company ?? undefined,
          linkedinUrl: u.profile.linkedinUrl ?? undefined,
          createdAt: now,
          updatedAt: now,
        });
        refToId[`${u.ref}:profile`] = pid;
        idToRef[pid] = `${u.ref}:profile`;
        classify("profiles", `${u.ref}:profile`, pid, { userRef: u.ref });
      }

      if (u.settings) {
        const sid = await ctx.db.insert("userSettings", {
          userId,
          emailNotifications: u.settings.emailNotifications,
          pushNotifications: u.settings.pushNotifications,
          smsNotifications: u.settings.smsNotifications,
          profileVisibility: u.settings.profileVisibility,
          dataSharing: u.settings.dataSharing,
          activityTracking: u.settings.activityTracking,
          createdAt: now,
          updatedAt: now,
        });
        refToId[`${u.ref}:settings`] = sid;
        idToRef[sid] = `${u.ref}:settings`;
        classify("userSettings", `${u.ref}:settings`, sid, { userRef: u.ref });
      }

      for (const [i, key] of (u.interests as string[]).entries()) {
        const iid = await ctx.db.insert("userInterests", { userId, interestKey: key, createdAt: now + i });
        refToId[`${u.ref}:uint:${key}`] = iid;
        idToRef[iid] = `${u.ref}:uint:${key}`;
        classify("userInterests", `${u.ref}:uint:${key}`, iid, { userRef: u.ref });
      }

      if (u.matchingQueue) {
        const mid = await ctx.db.insert("matchingQueue", {
          userId,
          availableFrom: u.matchingQueue.availableFrom,
          availableTo: u.matchingQueue.availableTo,
          constraints: {
            interests: u.matchingQueue.constraints.interests,
            roles: u.matchingQueue.constraints.roles,
            orgConstraints: u.matchingQueue.constraints.orgConstraints ?? undefined,
          },
          status: u.matchingQueue.status,
          matchedWith: u.matchingQueue.matchedWith ? refToId[u.matchingQueue.matchedWith] : undefined,
          createdAt: now,
          updatedAt: now,
        });
        refToId[`${u.ref}:queue`] = mid;
        idToRef[mid] = `${u.ref}:queue`;
        classify("matchingQueue", `${u.ref}:queue`, mid, { userRef: u.ref });
      }

      for (const ma of u.matchingAnalytics as any[]) {
        const mid = await ctx.db.insert("matchingAnalytics", {
          userId,
          matchId: ma.matchId,
          outcome: ma.outcome,
          feedback: ma.feedback ?? undefined,
          features: ma.features,
          weights: ma.weights,
          createdAt: now,
        });
        refToId[ma.ref] = mid;
        idToRef[mid] = ma.ref;
        classify("matchingAnalytics", ma.ref, mid, { userRef: u.ref });
      }
    }

    // 2. global taxonomy ------------------------------------------------------
    for (const it of fixture.interests) {
      const iid = await ctx.db.insert("interests", {
        key: it.key,
        label: it.label,
        category: it.category,
        usageCount: it.usageCount,
        createdAt: now,
      });
      refToId[it.ref] = iid;
      idToRef[iid] = it.ref;
      classify("interests", it.ref, iid, {});
    }

    // 3. connections ----------------------------------------------------------
    for (const c of fixture.connections) {
      const cid = await ctx.db.insert("connections", {
        requesterId: refToId[c.requesterRef],
        addresseeId: refToId[c.addresseeRef],
        status: c.status,
        createdAt: now,
        updatedAt: now,
      });
      refToId[`${c.requesterRef}->${c.addresseeRef}`] = cid;
      idToRef[cid] = `${c.requesterRef}->${c.addresseeRef}`;
      classify("connections", `${c.requesterRef}->${c.addresseeRef}`, cid, {
        requesterRef: c.requesterRef,
        addresseeRef: c.addresseeRef,
      });
    }

    // 4. meetings and meeting-scoped rows --------------------------------------
    for (const m of fixture.meetings) {
      const meetingId = await ctx.db.insert("meetings", {
        organizerId: refToId[m.organizerRef],
        title: m.title,
        description: m.description,
        scheduledAt: m.scheduledAt,
        duration: m.duration,
        webrtcEnabled: true,
        streamRoomId: m.streamRoomId,
        state: m.state,
        participantCount: (m.participants as any[]).length,
        createdAt: now,
        updatedAt: now,
      });
      refToId[m.ref] = meetingId;
      idToRef[meetingId] = m.ref;
      classify("meetings", m.ref, meetingId, {
        organizerRef: m.organizerRef,
        callerRoleInMeeting: callerRoleByMeeting[m.ref],
      });

      // participants (removed member: insert then delete)
      const participantRoles: Record<string, string> = {};
      for (const p of m.participants as any[]) {
        const pid = await ctx.db.insert("meetingParticipants", {
          meetingId,
          userId: refToId[p.userRef],
          role: p.role,
          joinedAt: p.presence === "joined" ? now : undefined,
          leftAt: p.presence === "left" ? now : undefined,
          presence: p.presence,
          createdAt: now,
        });
        participantRoles[p.userRef] = p.role;
        refToId[`${m.ref}:part:${p.userRef}`] = pid;
        idToRef[pid] = `${m.ref}:part:${p.userRef}`;
        classify("meetingParticipants", `${m.ref}:part:${p.userRef}`, pid, { userRef: p.userRef });
        if (p.removed) {
          await ctx.db.delete(pid);
          classification.pop(); // removed row leaves the universe
          delete refToId[`${m.ref}:part:${p.userRef}`];
          delete idToRef[pid];
        }
      }

      if (m.meetingState) {
        const sid = await ctx.db.insert("meetingState", {
          meetingId,
          active: m.meetingState.active,
          startedAt: now - 3600,
          endedAt: m.meetingState.active ? undefined : now,
          topics: m.meetingState.topics,
          recordingEnabled: m.meetingState.recordingEnabled,
          updatedAt: now,
        });
        refToId[m.meetingState.ref] = sid;
        idToRef[sid] = m.meetingState.ref;
        classify("meetingState", m.meetingState.ref, sid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      // transcripts: explicit then bulk (fixed order → stable ids)
      const transcriptSpecs: any[] = [];
      for (const tr of m.transcripts.explicit as any[]) {
        transcriptSpecs.push({ ...tr });
      }
      const bulk = m.transcripts.bulk as { count: number; speakers: string[] };
      for (let i = 0; i < bulk.count; i++) {
        transcriptSpecs.push({
          ref: `${m.ref}-bulk-${i}`,
          speakerRef: bulk.speakers[i % bulk.speakers.length],
          text: `bulk transcript line ${i} for ${m.ref}`,
          sequence: (m.transcripts.explicit as any[]).length + 1 + i,
        });
      }
      for (const spec of transcriptSpecs) {
        const text = spec.large ? largeText() : spec.text;
        const startMs = spec.sequence * 1000;
        const tid = await ctx.db.insert("transcripts", {
          meetingId,
          bucketMs: Math.floor(startMs / 300000) * 300000,
          sequence: spec.sequence,
          speakerId: `spk-${spec.speakerRef}`,
          text,
          confidence: 0.92,
          startMs,
          endMs: startMs + 900,
          wordCount: String(text).trim().split(/\s+/).length,
          language: "en",
          createdAt: now,
        });
        refToId[spec.ref] = tid;
        idToRef[tid] = spec.ref;
        classify("transcripts", spec.ref, tid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      for (const seg of m.transcriptSegments as any[]) {
        const sid = await ctx.db.insert("transcriptSegments", {
          meetingId,
          startMs: 0,
          endMs: 5000,
          speakers: seg.speakers,
          text: seg.text,
          topics: seg.topics,
          sentiment: seg.sentiment ?? undefined,
          createdAt: now,
        });
        refToId[seg.ref] = sid;
        idToRef[sid] = seg.ref;
        classify("transcriptSegments", seg.ref, sid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      if (m.notes) {
        const nid = await ctx.db.insert("meetingNotes", {
          meetingId,
          content: m.notes.content,
          version: m.notes.version,
          lastRebasedAt: now,
          updatedAt: now,
        });
        refToId[m.notes.ref] = nid;
        idToRef[nid] = m.notes.ref;
        classify("meetingNotes", m.notes.ref, nid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      for (const [i, nop] of (m.noteOps as any[]).entries()) {
        const oid = await ctx.db.insert("noteOps", {
          meetingId,
          sequence: nop.sequence,
          authorId: refToId[nop.authorRef],
          operation: nop.op,
          timestamp: now + i,
          applied: true,
        });
        refToId[nop.ref] = oid;
        idToRef[oid] = nop.ref;
        classify("noteOps", nop.ref, oid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      if (m.counter) {
        const cid = await ctx.db.insert("meetingCounters", { meetingId, lastSequence: m.counter.lastSequence, updatedAt: now });
        refToId[`${m.ref}:counter`] = cid;
        idToRef[cid] = `${m.ref}:counter`;
        classify("meetingCounters", `${m.ref}:counter`, cid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      for (const [i, evt] of (m.events as any[]).entries()) {
        const eid = await ctx.db.insert("meetingEvents", {
          meetingId,
          event: evt.event,
          userId: evt.userRef ? refToId[evt.userRef] : undefined,
          success: evt.success,
          metadata: {},
          timestamp: now + i,
          createdAt: now,
        });
        refToId[evt.ref] = eid;
        idToRef[eid] = evt.ref;
        classify("meetingEvents", evt.ref, eid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      if (m.recording) {
        const rid = await ctx.db.insert("meetingRecordings", {
          meetingId,
          recordingId: m.recording.recordingId,
          recordingUrl: m.recording.recordingUrl,
          provider: m.recording.provider,
          status: m.recording.status,
          attempts: 1,
          createdAt: now,
          updatedAt: now,
        });
        refToId[m.recording.ref] = rid;
        idToRef[rid] = m.recording.ref;
        classify("meetingRecordings", m.recording.ref, rid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      if (m.videoRoomConfig) {
        const vid = await ctx.db.insert("videoRoomConfigs", {
          meetingId,
          roomId: m.videoRoomConfig.roomId,
          provider: m.videoRoomConfig.provider,
          features: { recording: true, transcription: true, maxParticipants: 8, screenSharing: true, chat: true },
          createdAt: now,
          updatedAt: now,
        });
        refToId[m.videoRoomConfig.ref] = vid;
        idToRef[vid] = m.videoRoomConfig.ref;
        classify("videoRoomConfigs", m.videoRoomConfig.ref, vid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      if (m.transcriptionSession) {
        const tid = await ctx.db.insert("transcriptionSessions", {
          meetingId,
          provider: m.transcriptionSession.provider,
          status: m.transcriptionSession.status,
          startedAt: now - 1800,
          endedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        refToId[m.transcriptionSession.ref] = tid;
        idToRef[tid] = m.transcriptionSession.ref;
        classify("transcriptionSessions", m.transcriptionSession.ref, tid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      for (const [i, msg] of (m.messages as any[]).entries()) {
        const mid = await ctx.db.insert("messages", {
          meetingId,
          userId: refToId[msg.userRef],
          content: msg.content,
          timestamp: now + i,
        });
        refToId[msg.ref] = mid;
        idToRef[mid] = msg.ref;
        classify("messages", msg.ref, mid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }

      for (const pr of m.prompts as any[]) {
        const pid = await ctx.db.insert("prompts", {
          meetingId,
          type: pr.type,
          content: pr.content,
          tags: pr.tags,
          relevance: pr.relevance,
          createdAt: now,
        });
        refToId[pr.ref] = pid;
        idToRef[pid] = pr.ref;
        classify("prompts", pr.ref, pid, { meetingRef: m.ref, callerRoleInMeeting: callerRoleByMeeting[m.ref] });
      }
    }
    // 5. insights (need both user ids and meeting ids) ------------------------
    for (const u of fixture.users) {
      const userId = refToId[u.ref];
      for (const ins of u.insights as any[]) {
        const iid = await ctx.db.insert("insights", {
          userId,
          meetingId: refToId[ins.meetingRef],
          summary: ins.summary,
          actionItems: ins.actionItems,
          recommendations: ins.recommendations,
          links: ins.links,
          createdAt: now,
        });
        refToId[ins.ref] = iid;
        idToRef[iid] = ins.ref;
        classify("insights", ins.ref, iid, { userRef: u.ref });
      }
    }
  });

  const classCounts = { owner: 0, shared: 0, excluded: 0, total: classification.length };
  for (const row of classification) classCounts[row.class]++;

  // Sanity: every classified table must be covered by the policy.
  const policyTables = new Set(TABLE_POLICIES.map((p) => p.table));
  for (const row of classification) {
    if (!policyTables.has(row.table)) {
      throw new Error(`fixture row in unclassified table "${row.table}"`);
    }
  }

  return { refToId, idToRef, classification, classCounts };
}
