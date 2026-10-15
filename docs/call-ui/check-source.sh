#!/bin/sh
# Reproduce the lane's scoped source checks from the repository root.
set -eu
pnpm exec vitest run \
  src/hooks/useLocalMedia.test.ts \
  src/lib/call/blur-policy.test.ts src/lib/call/blur-pipeline.test.ts \
  src/lib/call/network-quality.test.ts src/lib/call/public-assets.test.ts \
  src/proxy.test.ts src/proxy-test-auth.test.ts \
  test/in-call/callSidePanel.test.tsx test/in-call/callRoom.test.tsx \
  test/in-call/conversation-prompts.test.tsx \
  test/in-call/callRoomIceLoading.test.tsx src/lib/call/ice-config.test.ts \
  src/lib/call/transports/p2p/p2p-ice.test.ts
pnpm exec eslint --config docs/call-ui/eslint.config.mjs \
  src/components/call/CallRoom.tsx src/components/call/call-parts.tsx \
  src/components/call/CallSidePanel.tsx src/components/call/SelfPreview.tsx \
  src/hooks/useLocalMedia.ts src/lib/call/blur-pipeline.ts \
  src/lib/call/blur-policy.ts src/lib/call/network-quality.ts \
  src/lib/call/camera-quality.ts src/lib/call/public-assets.ts src/proxy.ts \
  'src/app/app/call/[id]/real-call.tsx' src/app/app/layout.tsx src/app/layout.tsx
node docs/call-ui/type-baseline.mjs
