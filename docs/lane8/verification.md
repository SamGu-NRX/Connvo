# Landing appearance and lint

The four captures compare the public `/` route before the landing repair at
63c9931 with the repaired page, in the light theme at 1440×900 and 390×844 CSS
pixels. Both pairs have zero changed RGB pixels after export normalization.
T3 exports desktop captures at 1280×800 and mobile captures at device scale 2;
these PNGs are resampled to their CSS viewport dimensions. No layout, styles,
animation, or visible copy changed.

The local page ran on port 3108 with dummy WorkOS configuration and no signed-in
user. These captures establish landing appearance, not backend integration.

`pnpm exec eslint src convex tools test` leaves five errors, all in the excluded
lane 5 files `src/components/call/CallRoom.tsx` and `src/hooks/useLocalMedia.ts`.
Lane 8's four components and three touched test files pass targeted ESLint.
`pnpm type-check` passes. Theme tests cover both toggles and hydration from a
light server render into a persisted dark theme. Notes tests retain debounce,
save-confirmation, remote-update, and loss-recovery coverage.
