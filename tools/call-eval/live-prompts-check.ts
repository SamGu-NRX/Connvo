/** Bounded manual check. Run with OPENAI_API_KEY_FALLBACK in the environment. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  selectPrompt,
  type PromptContext,
} from "../../convex/prompts/selection";

async function main() {
  const output = "docs/live-prompts/live-check.jsonl";
  mkdirSync("docs/live-prompts", { recursive: true });
  const prior = existsSync(output)
    ? readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { kind: string })
        .filter((entry) => entry.kind === "attempt").length
    : 0;
  if (prior >= 10) throw new Error("Live-check cap reached; no requests sent");
  const key = process.env.OPENAI_API_KEY_FALLBACK;
  if (!key) throw new Error("OPENAI_API_KEY_FALLBACK is required");
  const shown: string[] = [];
  for (const elapsedSeconds of [20, 240, 780, 1250, 1700].slice(
    0,
    10 - prior,
  )) {
    const context: PromptContext = {
      participants: [
        {
          role: "Software engineer",
          interests: ["technology", "music", "books"],
        },
        { role: "Designer", interests: ["design", "music", "books"] },
      ],
      elapsedSeconds,
      durationSeconds: 1800,
      shown: [...shown],
      notes:
        elapsedSeconds < 120
          ? ""
          : "We both play guitar. We talked about learning by making small projects and finding time for creative hobbies.",
    };
    const start = performance.now();
    // Persist an attempt before the network call so interrupted runs still count.
    appendFileSync(
      output,
      JSON.stringify({ kind: "attempt", elapsedSeconds }) + "\n",
    );
    const result = await selectPrompt(context, { key });
    if (result) shown.push(result.prompt.id);
    const record = {
      kind: "result",
      elapsedSeconds,
      latencyMs: Math.round(performance.now() - start),
      source: result?.source,
      id: result?.prompt.id,
      content: result?.prompt.content,
      probability: result?.probability,
    };
    appendFileSync(output, JSON.stringify(record) + "\n");
    console.log(JSON.stringify(record));
  }
}
void main();
