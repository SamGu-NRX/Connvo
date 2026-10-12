# f1e rebuild witness — 2026-10-12 (session-replaced sandbox)

Umbrella 133e26c merged into f1e at f1f1644. Fresh clone, fresh anonymous deployment.

## Timeline (UTC)
- 03:57:41 fresh clone of f1e at 16f4001; identity Sam Gu configured.
- 04:00:47 merged umbrella 133e26c -> f1f1644 (pushed).
- 04:11:52 started `node tools/call-eval/scripts/local-backend.mjs` detached (backend3.log).
- 04:16 backend 2/6: provisioning wait (binary download on fresh sandbox).
- 04:23:13 backend: deployment up http://127.0.0.1:3210; 3/6 guard ok (anonymous:anonymous-connvo-int on 127.0.0.1:3210); 4/6 re-push + seed started.
- 04:30:14 backend 4/6 **TIMED OUT**: "the watch session did not complete a re-push within 540 s". Load average at timeout: 42.6 (2-core box; co-tenant suites at load 40+ for the whole window).

## What passed in this run
- provisioning of a fresh anonymous local deployment (port 3210)
- deployment guard (CONVEX_DEPLOYMENT=anonymous:anonymous-connvo-int answering on 127.0.0.1:3210)

## What failed
- stage 4/6 re-push within the script's 540 s window under load ~42 (full log: backend-timed-out-push.log, convex-dev log tail: convex-dev-tail.log)

## Environment
- 2-core shared sandbox, load 40+ sustained (co-tenant: f5-rebuild, venv-install tmux sessions)
- pnpm install and Chromium download were running concurrently on the same box
