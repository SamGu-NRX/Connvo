# HTTP API Documentation

## Overview

Connvo primarily exposes functionality through Convex client functions. External integrations that
require conventional HTTP endpoints currently rely on Convex HTTP actions. Two public routes are
available today:

- `GET /api/health` – basic health probe used by monitoring tooling
- `POST /api/webhooks/getstream` – ingress point for GetStream Video webhooks

An OpenAPI 3.1 definition for these endpoints lives at `docs/openapi.yaml`.

## Using the OpenAPI Spec

1. **Validate locally** (optional) using `npx openapi-typescript docs/openapi.yaml` or similar tools.
2. **Publish to GitBook** by creating a new API space and selecting the "Import OpenAPI" option.
   - Use `https://{deployment}.convex.cloud` as the server URL; replace `{deployment}` with the
     actual Convex slug.
   - Configure the `streamSignature` security scheme as an optional header when documenting the
     webhook.
3. **Automate updates** by wiring the GitBook space to this repository (Git Sync) or by adding a CI
   step that pushes the latest `openapi.yaml` after verification.

## Extending Coverage

- **New HTTP endpoints**: add additional `http.route` entries in `convex/http.ts`, then mirror them
  in `docs/openapi.yaml`.
- **Convex functions**: if external partners need direct access to Convex queries/mutations, consider
  creating thin HTTP wrappers that call into those functions to maintain REST semantics for the
  published API.
- **Schema reuse**: leverage the centralized entity and validator definitions in `convex/types` when
  defining request/response payloads to keep the documentation aligned with runtime validators.

## Future Enhancements

- Generate OpenAPI fragments directly from Convex validators to avoid drift.
- Surface authentication flows (WorkOS) and client-side Convex usage in GitBook alongside the HTTP
  reference for a more comprehensive developer experience.

