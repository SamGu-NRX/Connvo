# AGENTS.md

<!-- agent-skills:start -->
## Agent skills

Before starting work, read the skills below that apply to the task; each SKILL.md says when to use it. They are Sam's working playbooks and Lauren Tan's pstack (`pstack-*`), chosen for this repo. Obvious Autobuild loads them from `.obvious/skills/` on the default branch.

PR titles and bodies follow `.obvious/skills/pr-writing` and `.github/pull_request_template.md`, with before/after screenshots, a recording for motion or interaction, and a simple diagram where they help.

- [`anti-ui-slop`](.obvious/skills/anti-ui-slop/SKILL.md): Run the Uizze reference-guided design playbook or UI finish check when explicitly requested
- [`better-accessibility`](.obvious/skills/better-accessibility/SKILL.md): Helps your project comply with accessibility standards and best practices.
- [`blast-radius`](.obvious/skills/blast-radius/SKILL.md): Assess what a change could break beyond its diff
- [`pr-writing`](.obvious/skills/pr-writing/SKILL.md): Writes or revises pull request titles, descriptions and visual evidence
- [`pstack-create-verification-skill`](.obvious/skills/pstack-create-verification-skill/SKILL.md): Generate a project-local verification skill that drives your app the way a user does — any language, framework, or platform
- [`pstack-principle-boundary-discipline`](.obvious/skills/pstack-principle-boundary-discipline/SKILL.md): Apply when wiring validation, error handling, or framework adapters
- [`pstack-principle-make-operations-idempotent`](.obvious/skills/pstack-principle-make-operations-idempotent/SKILL.md): Apply when designing commands, lifecycle steps, or processing loops that run amid crashes, restarts, and retries
- [`pstack-principle-model-the-domain`](.obvious/skills/pstack-principle-model-the-domain/SKILL.md): Apply when writing stateful logic, or when code branches a lot or repeats a shape assumption across files
- [`pstack-principle-prove-it-works`](.obvious/skills/pstack-principle-prove-it-works/SKILL.md): Apply after completing a task, before declaring done
- [`pstack-principle-separate-before-serializing-shared-state`](.obvious/skills/pstack-principle-separate-before-serializing-shared-state/SKILL.md): Apply when concurrent actors might write to the same file, branch, key, or state object
- [`pstack-principle-test-behavior-not-implementation`](.obvious/skills/pstack-principle-test-behavior-not-implementation/SKILL.md): Apply when you write, change, or keep a test
- [`pstack-typescript-best-practices`](.obvious/skills/pstack-typescript-best-practices/SKILL.md): TypeScript best practices
- [`pstack-unslop`](.obvious/skills/pstack-unslop/SKILL.md): Cut AI tells from any writing
<!-- agent-skills:end -->

## Engineering budget

Connvo needs product built, not proof built. Every task should end with something a person can see working.

- **Build the feature first.** Don't open research or study PRs, add harnesses or proof tooling, or grow `tools/call-eval/` unless a task asks for it by name.
- **Test only where a bug is plausible and would hurt someone.** That means concurrency and races, auth and privacy, money or API credits, time and timezone math, and state machines. Write one adversarial test per real risk: it should fail if the bug comes back. Don't test rendering, styling, copy, configuration values, or code whose types or construction already make it correct. Don't repeat runs across seeds to look thorough.
- **Keep PR evidence light.** One or two screenshots of the changed screen at 1440×900 and 390×844, plus a short recording only for motion or interaction. Upload them to the PR, not the repository. Don't commit proof JSON, result matrices or videos.
- **Real API credits** are for the matching-quality evaluation in `docs/plan/MATCHING-PLAN.md` only.
- **Ask before** adding a dependency over 1 MB, a new external service, or a new feature flag.
- **The plan for matching and scheduled chats** is `docs/plan/MATCHING-PLAN.md`.
