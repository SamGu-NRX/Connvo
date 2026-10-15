# Convex module-load measurement

No load claim is made for this branch. An earlier version of this file reported a
module-load improvement from deferring SDK imports. That measurement used an esbuild setting
(`splitting: true`) that the Convex bundler does not use. A corrected run showed no
measurable benefit: the SDK bytes still parse at module load. The corrected raw outputs were
lost before they were committed. The tables are removed rather than kept as evidence.

What actually made pushes complete was pruning test files from the pushed tree (see
`local-backend-core.mjs`, `pruneTestArtifacts`).

`../measure-module-loads.mjs` is kept for anyone who wants to measure again. It bundles each
`convex/` module the way the Convex CLI does (`splitting: false`, `format: "esm"`) and times a
fresh `import()` of each bundle.
