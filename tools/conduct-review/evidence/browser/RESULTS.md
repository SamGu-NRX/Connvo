# Browser verification — captured evidence

All captures were made with Chrome 155.0.8059.39 via agent-browser against
`dist/index.html` loaded directly from `file://` (no server, no network).
All page content is synthetic fixture data.

| File | What it shows |
|---|---|
| `tc-1-reporter-initial.png` | Reporter draft panel at 1440×900: synthetic statement, category select, fixed-clock history. |
| `tc-2-keyboard-subject-tab.png` | Arrow-key tab navigation: after `ArrowRight` from the Reporter tab, Subject is the selected tab with a visible focus ring. |
| `tc-3-subject-pretriage-opaque.png` | Subject view before triage: "Nothing is shared with you about this case yet." — no statement, category, or meeting content. |
| `tc-4-reporter-edit-save-submit.webm` | Recording: reporter statement edited and saved through the engine (change event → `updateDraft`), then submitted. |
| `tc-4-after-submit.png` | Post-submit reporter state. Captured before the `buildView` stateLabel fix; shows the empty state pill that fix removes (kept as the before/after record). |

## Verified in this pass

- The page renders from `file://` with zero server or network dependency.
- Arrow-key navigation across role tabs with visible focus (keyboard access).
- Subject pre-triage opacity, as the disclosure policy requires.
- The recorded reporter edit→save flow executes against the real engine.

## Not captured yet (deferred — see PR Handoff)

- Post-fix submitted-state screenshot (the stateLabel fix landed after these
  captures; re-run `node build.mjs`, reload, submit, capture).
- Reviewer grant→triage screenshots, subject response, closed-state export
  with validator PASS.
- 375px layout, `prefers-reduced-motion` emulation
  (`agent-browser set media reduced-motion`), and a no-remote-call network
  assertion. Unit tests cover the no-remote-resource build guarantee; the
  in-browser recorder pass was not completed.
