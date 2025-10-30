# API Documentation Workflow

This guide explains how LinkedUp generates, validates, and publishes its Convex OpenAPI specification and Mintlify developer portal. Follow these steps whenever you need to refresh the documentation or investigate issues with the pipeline.

## Workflow at a Glance

1. **Generate** the baseline spec with `pnpm exec convex-helpers open-api-spec`, which queries the active Convex deployment.
2. **Enhance** the spec via `scripts/enhance-openapi.ts`, which fills in server URLs, tags, security schemes, operation IDs, and descriptions.
3. **Validate** the result with `scripts/validate-openapi.ts`, which lints using Redocly (`redocly.yaml`) and enforces custom checks.
4. **Publish** the enhanced document at `docs/api-reference/convex-openapi.yaml`, which Mintlify consumes through `mint.json`.

## Prerequisites

- Node.js 20 and pnpm (see `package.json` for the exact versions used in CI).
- Convex deployment credentials:
  - `CONVEX_DEPLOY_KEY` with read access to production data models.
  - Environment URLs: `CONVEX_URL_DEV`, `CONVEX_URL_STAGING`, `CONVEX_URL_PROD`.
  - Optional `CONVEX_URL` override if the generator expects it.
- (Optional) Mintlify CLI installed globally: `pnpm add -g mintlify`.

### Environment Setup Helper

```bash
cp .env.example .env.local
# fill in CONVEX_* secrets before running generation scripts
```

## Regenerating the OpenAPI Spec

1. Install dependencies (once):
   ```bash
   pnpm install
   ```
2. Generate, enhance, and validate for the development deployment:
   ```bash
   pnpm run update:api-docs:dev
   ```
3. On success you should see:
   - `convex-spec.yaml` (ignored by git) as the raw generator output.
   - `docs/api-reference/convex-openapi.yaml` containing the enhanced document.
   - A successful validation summary that references `redocly.yaml`.

> ⚠️ The script requires network connectivity to your Convex deployment. If it fails early, double-check the `CONVEX_DEPLOY_KEY` and URL environment variables.

## Verification Checklist (Tasks 8.x)

### 8.1 Development Run

- Confirm `pnpm run update:api-docs:dev` finishes without errors.
- Inspect `docs/api-reference/convex-openapi.yaml` for updated timestamps and server URLs.
- Spot-check key endpoints to ensure tags and descriptions appear.

### 8.2 Validation Script

- Run validation independently:
  ```bash
  pnpm exec tsx scripts/validate-openapi.ts docs/api-reference/convex-openapi.yaml
  ```
- To test failure paths, temporarily introduce `{hostUrl}` into the spec and rerun the command—you should see the custom placeholder guard trigger.

### 8.3 Mintlify Preview

- Install the Mintlify CLI if you have not already:
  ```bash
  pnpm add -g mintlify
  ```
- Preview documentation locally:
  ```bash
  mintlify dev
  ```
- Log into the playground with a development bearer token and verify the grouped endpoints function as expected.

### 8.4 Environment Switching

- Regenerate the spec for each environment:
  ```bash
  pnpm run update:api-docs:staging
  pnpm run update:api-docs:prod
  ```
- Confirm the `servers` block in `docs/api-reference/convex-openapi.yaml` reorders to prioritize the targeted environment and that each server description matches.

## Continuous Integration Automation (Task 9.1)

A GitHub Actions workflow (`.github/workflows/api-docs.yml`) runs on pushes to `main`:

- Installs dependencies with pnpm using the project lockfile.
- Executes `pnpm run update:api-docs:dev` to regenerate and validate.
- Commits updated specs back to the branch using the GitHub token if differences are detected.

### Required Repository Secrets

| Secret | Purpose |
| ------ | ------- |
| `CONVEX_DEPLOY_KEY` | Authenticates `convex-helpers` against Convex. |
| `CONVEX_URL_DEV` | Base URL for the development deployment. |
| `CONVEX_URL_STAGING` | Base URL for the staging deployment (used by enhancement script). |
| `CONVEX_URL_PROD` | Base URL for the production deployment (used by enhancement script). |

Set `CONVEX_URL` to the same value as `CONVEX_URL_DEV` if your deployment requires it for the generator.

## Mintlify Git Sync (Task 9.2)

1. Sign in to the Mintlify dashboard and create (or select) the LinkedUp project.
2. Enable **Git Sync**, pointing it to the repository branch that stores `mint.json` and the `docs/` directory.
3. Configure the sync to rebuild when `docs/api-reference/convex-openapi.yaml` changes.
4. Provide Mintlify with an access token that can read the repository.

With Git Sync enabled, Mintlify automatically ingests the updated OpenAPI spec whenever CI commits new documentation changes.

## Production Custom Domain

Mintlify can serve the LinkedUp docs on a branded subdomain (e.g. `docs.linkedup.com`) in production. Complete these steps after Git Sync is working:

1. **Mintlify settings**
   - Open the Mintlify dashboard → *Settings → Custom domain*.
   - Enter the desired hostname (`docs.linkedup.com`) and save. Mintlify will show the required DNS values once the domain is queued.

2. **DNS configuration**
   - In the DNS provider for `linkedup.com` add a CNAME record:
     ```
     Host: docs
     Type: CNAME
     Target: cname.vercel-dns.com.
     TTL: default
     ```
   - Propagation can take several minutes. Use `dig docs.linkedup.com CNAME` to confirm it resolves to `cname.vercel-dns.com`.

3. **Verification**
   - Back in the Mintlify dashboard, click *Verify* next to the custom domain once DNS has propagated.
   - Mintlify issues the TLS certificate automatically; the status will change to “Active” when HTTPS is ready.

4. **Post-deploy checklist**
   - Run `pnpm run update:api-docs:prod` to regenerate the OpenAPI spec with the production servers prioritized.
   - Trigger a Mintlify rebuild (either via Git Sync or the dashboard) so the latest content is published at `https://docs.linkedup.com`.
   - Spot-check a few endpoints in the API playground to ensure CORS/auth headers still resolve correctly when accessed via the custom domain.

## Maintenance Procedures (Task 10.x)

- **When to regenerate:** after deploying Convex changes that modify function validators, HTTP actions, or when new endpoints are added.
- **How to update descriptions/examples:** edit the enhancement script if automation can derive the data; otherwise, extend `docs/api-reference/convex-openapi.yaml` manually after generation and rerun validation.
- **Handling breaking changes:** regenerate the spec from staging first, review the diff, update the documentation or client SDKs, then repeat for production.
- **Troubleshooting:** check `log.txt` for the most recent run output, re-run validation with `--env` overrides, and ensure `redocly.yaml` is present so the `no-unused-components` rule stays disabled.

## Helpful Commands

```bash
# Regenerate docs for a specific environment
pnpm run update:api-docs -- --env=staging

# Run validation only
pnpm exec tsx scripts/validate-openapi.ts docs/api-reference/convex-openapi.yaml

# Pretty-print only the servers block for quick inspection
yq '.servers' docs/api-reference/convex-openapi.yaml
```

Keep this document close when onboarding new contributors to the documentation workflow or when diagnosing CI failures related to the OpenAPI spec.
