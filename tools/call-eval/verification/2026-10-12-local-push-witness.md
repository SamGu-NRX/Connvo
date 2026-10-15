# Live-push witness — 2026-10-12 (sub-thread c, branch `obv/connvo-local-convex-f1c`)

All times UTC. All quotes verbatim from captured logs. Witness written 2026-10-12 01:15Z.
Tree: `/home/user/work/connvo-guards` (fresh clone of `obv/connvo-local-convex-f1c` at `48c459b`).
Convex CLI: **1.46.0** (bump applied this run, see "Uncommitted deltas" below); pnpm 9.15.9.

## Headline finding (corrects earlier reports)

**No Convex push ever completed in any witness run.** An earlier note in this thread's
progress log claimed "the first push landed" — that was a false positive from the
stage-2 readiness poll, which breaks on `(CONVEX_URL in .env.local AND deployment
banner seen)` before any push marker exists. The `convex-dev.log` in every run had
**zero** push-completion markers (`Pushed|functions ready|waiting for changes` grep
count `0` throughout). The definitive proof: after the final run, `npx convex run
devEval/seed` returned

```
✖ Failed to run function "devEval/seed":
Error: [Request ID: 27f55a665c4c0982] Server Error
Could not find function for 'devEval/seed'. Did you forget to run `npx convex dev`?

No functions found.
```

i.e. the local backend holds **zero modules**. The push pipeline
(`POST /api/deploy2/start_push`) never succeeded on this box in any attempt:

| Attempt | Sandbox session | CLI | Load during push attempts | Window | Outcome |
|---|---|---|---|---|---|
| 1 (2026-10-11 ~23:40Z) | old (ihv8ze3…) | 1.46.0 | 5–90 | n/a | `EXDEV` rename (fixed: TMPDIR), then `InvalidModules` (fixed: .convexignore carry), then `--once` refuses while watch runs |
| 2 (00:28:28Z) | old (ihv8ze3…) | 1.46.0 | 5 → **86** burst | ~20 min | perpetual 408 loop; script stage-4 300 s window expired 00:49:30 |
| 3 (00:56:20Z) | fresh (icagoaql…) | 1.46.0 | 5.3 → **2.0–3.9** (quiet) | ~18 min | perpetual 408 loop incl. first push; stage-4 540 s window expired 01:14:30 |

`npx convex env set` **works** on the same backend throughout (stage 3 passed every
run: guard `anonymous:anonymous-connvo-guards answering on 127.0.0.1:3210`), and the
backend sqlite was written after env-set — so the backend serves config writes but
never completes a code push, **independent of system load** (408s persisted at load
2.0 with a warm backend, and the one load-2 window in run 3 also never landed a
push). This asymmetry (config writes fine, `start_push` perpetual 408) is the
evidence record for sub-thread (b).

## Run 3 stage timings (final, fully instrumented run)

| Stage | Start (UTC) | Duration | Result |
|---|---|---|---|
| 1/6 keys | 00:56:12 | <1 s | keys regenerated (kid connvo-local-test-1) |
| install (before launch) | 00:53:48 | 1 m 16 s | exit 0, convex 1.46.0 |
| guard tests (before launch) | 00:55:59 | 3.11 s | 47/47 passed (2 files) |
| 2/6 provisioning + first push | 00:56:15 | — | binary download ~1–2 min; "Configured a local deployment … saved its: name as CONVEX_DEPLOYMENT, client URL as NEXT_PUBLIC_CONVEX_URL, HTTP actions URL as NEXT_PUBLIC_CONVEX_SITE_URL to .env.local" ✓ (D1 verified: no login prompt, non-interactive) |
| stage-2 readiness poll | 00:56:15 | 7 m 45 s | broke on convexUrl+banner (not a push marker); CLI 408-looping the whole time |
| 3/6 deployment env | ~01:04:30 | <1 min | guard ok, both env-set calls ran |
| 4/6 nudge re-push (touch + fresh-marker wait, 540 s) | ~01:05:30 | 9 m | **deadline expired 01:14:30**; log tail captured below |
| manual seed attempt (post-mortem) | 01:14:43 | 2 s | "No functions found." (above) |
| run exit | — | — | exit code 1 (`ELIFECYCLE Command failed with exit code 1.`) |

Load timeline for run 3 (1-minute average at each probe):
00:56:20 → 5.26 · 00:57:12 → 4.93 · 00:58:04 → 3.44 · 00:58:57 → 2.79 · 00:59:46 → 2.45 ·
01:00:36 → 1.81 · 01:01:29 → 2.45 · 01:02:31 → 2.17 · 01:03:31 → 1.88 · 01:04:27 → 2.48 ·
01:05:58 → 2.18 · 01:06:50 → 3.92 · 01:08:11 → 3.21 · 01:09:12 → 1.79 · 01:10:07 → 2.01 ·
01:11:01 → 2.10 · 01:11:58 → 2.52 · 01:12:54 → 2.11 · 01:13:45 → 2.10 · 01:14:30 → 2.34

## Verbatim error lines (run 3, convex-dev.log / script stderr)

```
✖ Error: Unable to start push to http://127.0.0.1:3210
✖ Error fetching POST  http://127.0.0.1:3210/api/deploy2/start_push 408 Request Timeout
Failed due to network error, retrying in 476.71ms...
- Preparing Convex functions...
```

(Repeats with `retrying in 1.07s…`, `retrying in 1.26s…`, `retrying in 1.86s…` — the
loop never leaves `start_push`.) Run 2 additionally produced, before its 408 loop:

```
✖ Error fetching POST  http://127.0.0.1:3210/api/deploy2/start_push 408 Request Timeout
Failed due to network error, retrying in 599.2ms...
```

No `module load exceeded 2 s` text appeared in any run (the backend never got far
enough into a push to evaluate module loads — `start_push` is the first RPC of the
protocol and it never completed).

## What IS verified live (positive results)

1. **D1 provisioning, non-interactive** — `npx convex dev` (1.46.0) inside the
   script's tmux spawn provisioned an anonymous local deployment with no login
   prompt and wrote `NEXT_PUBLIC_CONVEX_URL` to `.env.local`. The operator's fix 1
   (URL picker) is live-verified: the script's `pickConvexUrlFromEnvText` reads
   exactly the variable the CLI writes.
2. **Guard (iii) in production shape** — stage 3 printed
   `[backend] deployment guard ok: anonymous:anonymous-connvo-guards answering on 127.0.0.1:3210`
   before any env-set call, every run.
3. **Backup-before-modify (guard ii) in production shape** — `convex.json.orig`
   written before the first override; used this session to restore the repo file
   (`convex.json` now matches HEAD).
4. **.convexignore carry** — with it, no `InvalidModules` module-loader crash
   recurred (the 1.46 + TMPDIR + /dev/null + ignore-carry combination survived
   provisioning and repeated push attempts without module-load aborts).
5. **Idempotent relaunch** — the script re-ran cleanly over a live watch session,
   re-applied the override, re-guarded, and re-nudged (runs 2→3).

## Verdict per work item

1. **Guard tests** — DONE. 47/47 pass from the clean checkout (incl. the three
   would-fail-on-parent guard tests and the byte-for-byte provider-parity test).
   Commits `718e4e4`, `6b0657c`, `48c459b` on `obv/connvo-local-convex-f1c`.
2. **Live-push witness** — RECORDED AS FAILING (this document). Stages 1–3
   witnessed passing with timings; stage 4+ blocked by the backend's perpetual
   `start_push` 408 at every load level tried.
3. **Seed shape** — NOT live-verified; blocked by the same push failure (the seed
   cannot run on a module-less backend). Static verification stands: `convex/devEval/seed.ts`
   creates exactly the dossier §4 shape (users A/B/C + outsider O with no
   participant row; one active meeting organized by A; A=host, B=participant,
   C=participant presence `joined`; `meetingState` row). The read-only
   `devEval/shape` query (commit `6b0657c`) is ready to run the moment a push lands.
4. **Operator fixes 1–3** — DONE, committed in `48c459b` (URL picker, `externalPackages`
   key + notes allowlist + `--typecheck=disable` on the re-push, quiet-window removal,
   handoff-doc correction).

## Uncommitted deltas at witness time (committed with this document)

- `package.json`: `convex` `^1.28.0` → `^1.46.0` (authorized within-1.x bump; 1.28.0
  cannot provision non-interactively on this box — see thread log).
- `pnpm-lock.yaml`: lockfile for the bump (pnpm 9.15.9).
- `tools/call-eval/scripts/local-backend.mjs`:
  1. carry `convex/.convexignore` into `convex-harness/` (fixes the `InvalidModules`
     module-loader crash from the copied test file),
  2. spawn the watch with same-fs `TMPDIR` (fixes the `EXDEV` external-module
     staging failure) and `< /dev/null` stdin (fixes the non-interactive terminal
     death),
  3. stage 4 re-push via watch-nudge (touch `auth.config.ts` + wait for a fresh
     completion marker, 540 s budget) — `convex dev --once` refuses while the watch
     session's backend holds the port.

## Next step for the thread that unblocks the push

The failure is inside the local backend's `start_push` handling (config writes
succeed; code pushes never do; load-independent). Useful probes, in order: (a) try a
minimal 1-file functions tree on a fresh anonymous deployment to split "backend
broken" from "tree content"; (b) try CLI 1.45.x / 1.35.x to date the regression;
(c) capture the backend's own stderr (spawn the binary directly, not via the CLI).
