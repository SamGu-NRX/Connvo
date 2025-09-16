/**
 * Convex Database Schema
 *
 * This schema defines all collections for the LinkedUp application migration
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

export default defineSchema({
  ...userTables,
  ...interestTables,
  ...meetingTables,
  ...transcriptTables,
  ...aiTables,
  ...matchingTables,
  ...messagingTables,
  ...webrtcTables,
  ...systemTables,
  ...offlineTables,
  ...legacyTables,
});
