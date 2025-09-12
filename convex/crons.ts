import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, v } from "./_generated/server";

// Define crons for transcript and metrics cleanup per steering rules
const crons = cronJobs();

// Daily raw transcript cleanup (default 90 days)
crons.interval(
  "cleanup old transcripts",
  { hours: 24 },
  internal.transcripts.ingestion.cleanupOldTranscripts,
  {
    olderThanMs: 90 * 24 * 60 * 60 * 1000,
  },
);

// Daily streaming metrics cleanup (24 hours)
crons.interval(
  "cleanup streaming metrics",
  { hours: 24 },
  internal.transcripts.streaming.cleanupStreamingMetrics,
  {
    olderThanMs: 24 * 60 * 60 * 1000,
  },
);

// Weekly transcript segments cleanup (1 year)
crons.interval(
  "cleanup old transcript segments",
  { days: 7 },
  internal.transcripts.aggregation.cleanupOldTranscriptSegments,
  {
    olderThanMs: 365 * 24 * 60 * 60 * 1000,
  },
);

export default crons;

