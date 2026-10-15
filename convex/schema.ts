/**
 * Convex Database Schema
 *
 * This schema defines all collections for the Connvo application migration
 * from Drizzle ORM + PostgreSQL/Supabase to Convex.
 *
 * Requirements: 3.1, 3.2, 3.3
 * Compliance: steering/convex_rules.mdc - Uses proper Convex schema patterns
 */

import { defineSchema } from "convex/server";
import { userTables } from "./schema/users";
import { interestTables } from "./schema/interests";
import { meetingTables } from "./schema/meetings";
import { transcriptTables } from "./schema/transcripts";
import { aiTables } from "./schema/ai";
import { matchingTables } from "./schema/matching";
import { messagingTables } from "./schema/messaging";
import { webrtcTables } from "./schema/webrtc";
import { systemTables } from "./schema/system";
import { offlineTables } from "./schema/offline";
import { legacyTables } from "./schema/legacy";
import { userSettings } from "./schema/userSettings";
import { livePromptTables } from "./schema/livePrompts";
import { historyTables } from "./schema/history";
import { matchProposalsTable } from "./schema/matchProposals";
import { decisionsCacheTable } from "./schema/decisionsCache";
import { meetingFeedback } from "./schema/meetingFeedback";
import { connections } from "./schema/connections";
import { connectIntents } from "./schema/connectIntents";
import { availabilityBlocks } from "./schema/availability";
import { blocks } from "./schema/blocks";
import { reports } from "./schema/reports";
import { noShowTables } from "./schema/noShows";

export default defineSchema({
  ...userTables,
  ...interestTables,
  ...meetingTables,
  ...historyTables,
  ...livePromptTables,
  ...transcriptTables,
  ...aiTables,
  ...matchingTables,
  ...messagingTables,
  ...webrtcTables,
  ...systemTables,
  ...offlineTables,
  ...legacyTables,
  ...matchProposalsTable,
  ...decisionsCacheTable,
  userSettings,
  meetingFeedback,
  connections,
  connectIntents,
  availabilityBlocks,
  blocks,
  reports,
  ...noShowTables,
});
