const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const SPEC_PATH = path.resolve("docs/api-reference/convex-openapi.yaml");

if (!fs.existsSync(SPEC_PATH)) {
  console.error(`Spec not found at ${SPEC_PATH}`);
  process.exit(1);
}

const TAG_DESCRIPTIONS = {
  Users: "Identity, profile, and authentication operations for LinkedUp users.",
  Meetings: "Scheduling, managing, and retrieving meeting data.",
  Transcripts: "Endpoints for accessing call transcripts and transcription controls.",
  Insights: "AI-generated insights, summaries, and analytics derived from meetings.",
  Prompts: "Prompt management and AI conversation guidance.",
  Notes: "Collaborative meeting notes and follow-up documentation.",
  WebRTC: "Real-time communication, session signalling, and media utilities.",
  System: "General system endpoints such as health checks and diagnostics.",
};

const TAG_PATH_PATTERNS = [
  { tag: "Users", matcher: /user|account|profile/i },
  { tag: "Meetings", matcher: /meeting|calendar|event/i },
  { tag: "Transcripts", matcher: /transcript|caption/i },
  { tag: "Insights", matcher: /insight|analysis|analytics/i },
  { tag: "Prompts", matcher: /prompt|suggestion/i },
  { tag: "Notes", matcher: /note|summary/i },
  { tag: "WebRTC", matcher: /webrtc|rtc|session/i },
];

function resolveTagForPath(pathKey) {
  for (const { tag, matcher } of TAG_PATH_PATTERNS) {
    if (matcher.test(pathKey)) {
      return tag;
    }
  }
  return "System";
}

const raw = fs.readFileSync(SPEC_PATH, "utf8");
const spec = yaml.load(raw);

spec.info = {
  ...(spec.info || {}),
  title: "LinkedUp Convex API",
  version: spec.info && spec.info.version && spec.info.version !== "0.0.0" ? spec.info.version : "1.0.0",
  description:
    (spec.info && spec.info.description) ||
    "HTTP interface for LinkedUp's Convex backend, exposing vetted query, mutation, and action endpoints.",
};

if (Array.isArray(spec.tags)) {
  spec.tags = spec.tags.filter((tag) => tag && !["query", "mutation", "action"].includes(tag.name));
} else {
  spec.tags = [];
}

const existingTagNames = new Set(spec.tags.map((tag) => tag.name));
for (const { tag } of TAG_PATH_PATTERNS) {
  if (!existingTagNames.has(tag)) {
    spec.tags.push({ name: tag, description: TAG_DESCRIPTIONS[tag] });
    existingTagNames.add(tag);
  }
}
if (!existingTagNames.has("System")) {
  spec.tags.push({ name: "System", description: TAG_DESCRIPTIONS.System });
}

spec.paths = spec.paths || {};
for (const [pathKey, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!operation || typeof operation !== "object") continue;

    if (!/\/health/i.test(pathKey)) {
      operation.security = operation.security || [];
      const hasBearer = operation.security.some((item) => item && Object.prototype.hasOwnProperty.call(item, "bearerAuth"));
      if (!hasBearer) {
        operation.security.push({ bearerAuth: [] });
      }
    }

    operation.tags = [resolveTagForPath(pathKey)];
  }
}

const updated = yaml.dump(spec, { lineWidth: -1 });
fs.writeFileSync(SPEC_PATH, updated, "utf8");
console.log(`Updated ${SPEC_PATH}`);
