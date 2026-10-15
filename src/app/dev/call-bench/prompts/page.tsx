"use client";

import { notFound } from "next/navigation";
import { useState } from "react";
import {
  PromptPanel,
  type PromptViewState,
} from "@/components/call/ConversationPrompts";
import type { Id } from "@convex/_generated/dataModel";

/** Development-only states of the real panel. No backend or paid requests. */
export default function PromptPreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const [scenario, setScenario] = useState("current");
  const [used, setUsed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [alternate, setAlternate] = useState(false);
  const state: PromptViewState = {
    prompt:
      scenario === "empty" || scenario === "lobby"
        ? null
        : {
            id: (alternate ? "fixture-two" : "fixture-one") as Id<"prompts">,
            content: alternate
              ? "What have you been curious about lately?"
              : "What's been a small highlight of your week?",
            used: used || scenario === "used",
          },
    active: scenario !== "ended",
    exhausted: scenario === "exhausted",
    autoPaused: paused || scenario === "paused",
    nextAutoAt: 90_000,
    nextManualAt: scenario === "limited" ? 31_000 : 0,
    pendingUntil: 0,
  };
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="mb-2 text-xl font-medium">Conversation prompts</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Development fixture. Real panel, no network requests.
      </p>
      <label className="mb-6 flex items-center gap-3 text-sm">
        Panel state
        <select
          className="min-h-11 rounded border p-2 text-base"
          value={scenario}
          onChange={(event) => {
            setScenario(event.target.value);
            setUsed(false);
            setPaused(false);
          }}
        >
          {[
            "loading",
            "lobby",
            "empty",
            "current",
            "pending",
            "used",
            "paused",
            "limited",
            "error",
            "ended",
            "exhausted",
          ].map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <div className="w-full max-w-[22rem]">
        <PromptPanel
          state={scenario === "loading" ? undefined : state}
          inCall={scenario !== "lobby"}
          now={1000}
          busy={scenario === "pending"}
          error={
            scenario === "error"
              ? "Couldn't update the prompt. Your call can continue. Try again."
              : null
          }
          onAnother={() => {
            setAlternate(!alternate);
            setUsed(false);
          }}
          onUsed={() => setUsed(true)}
          onPause={() => setPaused(!paused)}
        />
      </div>
    </main>
  );
}
