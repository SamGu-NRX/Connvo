/**
 * RFC 5545 .ics calendar export for after-call meeting history.
 *
 * Zero runtime dependencies: this module imports nothing (no convex, no libs).
 * Determinism: the same meeting record always renders byte-identical output —
 * UID, DTSTAMP are derived from the record itself, never from Date.now() or
 * randomness. That stability is what lets calendar clients replace an event
 * instead of duplicating it on re-export.
 *
 * The implementation lives in `convex/lib/ics.ts` so the matcher's email
 * drafts and the call-eval harness (which materializes convex modules) can
 * import the same builder; this file re-exports it for the app tree.
 */

export * from "../../../convex/lib/ics";
