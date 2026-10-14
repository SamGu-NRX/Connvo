# Typecheck comparison for the local-eval guard

These counts let Sam separate existing type errors from PR #42. Dependencies were installed from `pnpm-lock.yaml` with `--frozen-lockfile --ignore-scripts`. Both checkouts use the same dependency installation and TypeScript 5.9.3. No build output or environment files were read to construct this comparison.

Alpha is `d5be541ce9fdc055d33f0523eb9606071f0e3f55`. The fix is the source snapshot containing the watcher retry, local URL and runner environment changes in this PR. The PR description names the final commit checked.

Each command runs through `run-guarded.py --min-free-gib 8 --`:

- App: `pnpm exec tsc --noEmit --incremental false --pretty false`
- Eval: `pnpm exec tsc --noEmit -p tools/call-eval --pretty false`

| Check | Alpha errors | Fix errors | Added |
| --- | ---: | ---: | ---: |
| App | 32 | 32 | 0 |
| Eval | 399 | 396 | 0 |

Both checks exit 2. Counts refer to diagnostic lines. Comparison ignores source line movement and checkout paths; diagnostic codes and messages must still match. The eval reduction removes three implicit-any diagnostics in the local-backend command wrappers.

## Existing diagnostics by file

| File | App on alpha | App on fix | Eval on alpha | Eval on fix |
| --- | ---: | ---: | ---: | ---: |
| `src/app/videocall/[id]/page.tsx` | 1 | 1 | 0 | 0 |
| `src/components/mvp/one-on-one-meeting.tsx` | 1 | 1 | 0 | 0 |
| `src/components/ui/chart.tsx` | 8 | 8 | 0 | 0 |
| `src/hooks/useCollaborativeNotes.ts` | 3 | 3 | 0 | 0 |
| `src/hooks/useInCallPrompts.ts` | 1 | 1 | 0 | 0 |
| `src/hooks/useMeetingLifecycle.ts` | 4 | 4 | 0 | 0 |
| `src/hooks/usePostCallInsights.ts` | 3 | 3 | 0 | 0 |
| `src/hooks/usePreCallPrompts.ts` | 1 | 1 | 0 | 0 |
| `src/hooks/useTranscription.ts` | 5 | 5 | 0 | 0 |
| `test/convex/openapiExamples.test.ts` | 2 | 2 | 0 | 0 |
| `test/convex/setup.ts` | 1 | 1 | 0 | 0 |
| `test/test.setup.mts` | 2 | 2 | 0 | 0 |
| `tools/call-eval/reference/signaling-server.mjs` | 0 | 0 | 30 | 30 |
| `tools/call-eval/runner/context-config.test.mjs` | 0 | 0 | 3 | 3 |
| `tools/call-eval/runner/context.mjs` | 0 | 0 | 10 | 10 |
| `tools/call-eval/runner/contracts.mjs` | 0 | 0 | 10 | 10 |
| `tools/call-eval/runner/mock-server.mjs` | 0 | 0 | 7 | 7 |
| `tools/call-eval/runner/page-helpers.mjs` | 0 | 0 | 43 | 43 |
| `tools/call-eval/runner/peers.mjs` | 0 | 0 | 6 | 6 |
| `tools/call-eval/runner/probe.mjs` | 0 | 0 | 3 | 3 |
| `tools/call-eval/runner/probe.test.mjs` | 0 | 0 | 2 | 2 |
| `tools/call-eval/runner/relay.mjs` | 0 | 0 | 20 | 20 |
| `tools/call-eval/runner/run.mjs` | 0 | 0 | 25 | 25 |
| `tools/call-eval/runner/scenario-kit.mjs` | 0 | 0 | 32 | 32 |
| `tools/call-eval/runner/scenarios-h.mjs` | 0 | 0 | 42 | 42 |
| `tools/call-eval/runner/scenarios-p.mjs` | 0 | 0 | 10 | 10 |
| `tools/call-eval/runner/shaper.mjs` | 0 | 0 | 4 | 4 |
| `tools/call-eval/runner/turn-relay.test.mjs` | 0 | 0 | 9 | 9 |
| `tools/call-eval/scripts/after-call-proof.mjs` | 0 | 0 | 42 | 42 |
| `tools/call-eval/scripts/call-page-shots.mjs` | 0 | 0 | 15 | 15 |
| `tools/call-eval/scripts/local-backend.mjs` | 0 | 0 | 13 | 10 |
| `tools/call-eval/scripts/notes-proof.mjs` | 0 | 0 | 25 | 25 |
| `tools/call-eval/scripts/notes-states-shots.mjs` | 0 | 0 | 33 | 33 |
| `tools/call-eval/scripts/run-eval.mjs` | 0 | 0 | 14 | 14 |
| `tools/call-eval/scripts/run-proof.mjs` | 0 | 0 | 1 | 1 |

Raw logs are retained in the caretaker’s triage directory as `connvo-linkedup-pr42-{alpha,head}-{app,eval}.log`. These failing checks do not establish browser or deployment acceptance.

## Harmless historical probes

`run-guarded.py --min-free-gib 8 -- python3 docs/review-debt/guard-baseline-probes.py` reproduces the runner leak at 59c98b7 and the Bash startup injection at d42815eb. It extracts those source functions into a disposable fixture containing only fake `convex` and `npx` executables. The output reports whether a synthetic credential arrived, without printing it. No real CLI or environment file is opened.

The watcher retry and conflicting-URL unit regressions also fail when only their implementation module is replaced with its 59c98b7 version. The watcher fails at the second refusal, after tmux reports that the session is gone. The fixed implementation passes both refusals, then rebuilds after the child exits.
