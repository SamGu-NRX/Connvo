# Design Document

## Overview

This design outlines the implementation of an automated OpenAPI specification workflow and Mintlify integration for the LinkedUp Convex backend. The solution uses Convex's official `convex-helpers open-api-spec` command to generate the OpenAPI specification directly from the deployment, then enhances it for Mintlify integration.

**Critical Design Principles**:

1. **Use Official Tooling**: We use `convex-helpers open-api-spec` to generate the OpenAPI spec - we do NOT build a custom generator
2. **Real Data Only**: All schemas, examples, and documentation come from the actual Convex deployment
3. **Minimal Enhancement**: We only add what convex-helpers doesn't provide (server URLs, security schemes, extracted examples)
4. **Automation First**: The workflow should be fully automated and repeatable

The workflow has three phases:

1. **Generation**: Run `pnpm exec convex-helpers open-api-spec` to generate `convex-spec.yaml` from the Convex deployment
2. **Enhancement**: Post-process the spec to replace placeholder URLs, add security schemes, and optionally extract real examples
3. **Integration**: Configure Mintlify to consume the enhanced spec and enable the API Playground

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     Convex Deployment                            │
│  • All queries, mutations, actions with validators               │
│  • HTTP actions defined in convex/http.ts                        │
│  • Real function signatures and types                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ pnpm exec convex-helpers open-api-spec
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Base OpenAPI Spec (convex-spec.yaml)                │
│  • Generated schemas from Convex validators                      │
│  • Function paths and operations                                 │
│  • Placeholder server URL: {hostUrl}                             │
│  • Basic endpoint definitions                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Enhancement Script (Node.js/TypeScript)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         Enhanced OpenAPI Spec (docs/api-reference/              │
│                        convex-openapi.yaml)                      │
│  • Concrete server URLs (dev/staging/prod)                       │
│  • Security schemes (bearerAuth for user auth)                   │
│  • Optional: Real examples from calling actual functions         │
│  • Detailed descriptions and tags                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Mintlify Configuration (mint.json)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Mintlify Documentation                        │
│  • Interactive API Playground                                    │
│  • Auto-generated pages from OpenAPI spec                        │
│  • Authentication UI                                             │
│  • Real-time testing against Convex deployment                   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. Developer runs `npm run update:api-docs`
2. Script executes `pnpm exec convex-helpers open-api-spec` → generates `convex-spec.yaml`
3. Enhancement script reads `convex-spec.yaml`, applies transformations
4. Enhanced spec written to `docs/api-reference/convex-openapi.yaml`
5. Validation runs against OpenAPI 3.x schema
6. Mintlify auto-syncs via Git integration and rebuilds documentation

## Detailed Workflow

### Step 1: Prerequisites
- Ensure Node.js and npm are installed locally.
- Confirm the Convex deployment you want to document is live and that you know its base URL.
- Review Convex functions to verify they declare argument and return validators so the generator can emit accurate schemas.[^convex-openapi]

### Step 2: Generate the baseline spec
- Install the Convex helpers CLI (or rely on the dev dependency) and run the generator against the target deployment. This produces `convex-spec.yaml` in the project root.[^convex-openapi]

```bash
pnpm add -D convex-helpers
pnpm exec convex-helpers open-api-spec
```
- When Convex functions expose `v.bytes()` validators, run `pnpm exec node scripts/patch-convex-helpers-openapi.js` before generation so the helper treats them as `type: string` with `format: binary` instead of throwing an unsupported error.

### Step 3: Polish the spec for Mintlify
- Replace any placeholder server URLs (e.g., `{hostUrl}`) with concrete deployment URLs so Mintlify’s playground can send requests to the right environment.[^mint-openapi]
- Append security schemes under `components.securitySchemes` such as bearer auth for user JWTs and a header-based deploy key, and optionally apply them globally using the `security` array.[^mint-openapi]
- Layer in request and response examples that match the Convex HTTP payload shape (typically `{ "args": { ... }, "format": "json" }`) so Mintlify renders helpful samples.
- Note limitations: missing validators fall back to `v.any()`, and values like `bigint`/`bytes` are not emitted in JSON format.[^convex-openapi]

```yaml
servers:
  - url: "https://your-deployment.convex.cloud"
    description: "Convex deployment base URL"

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    convexDeploy:
      type: apiKey
      in: header
      name: Authorization
      description: "Use `Convex <deploy-key>` for admin operations; never publish this value."
security:
  - bearerAuth: []
```

### Step 4: Validate and optionally generate SDKs
- Run both Mintlify and general OpenAPI validators to catch structural issues before committing.[^mint-openapi][^redocly-cli]

```bash
mint openapi-check ./docs/api-reference/convex-spec.yaml
pnpm exec redocly lint --config redocly.yaml convex-spec.yaml
```

- When a typed client is needed, feed the spec into an OpenAPI generator for the desired language.[^convex-openapi]

```bash
pnpm exec openapi-generator-cli generate -i convex-spec.yaml -g go -o convex_client
```

### Step 5: Add the spec to Mintlify
- **Dashboard upload**: Import the YAML file through Mintlify’s API Playground setup so it can auto-generate pages.
- **docs.json configuration**: Commit the spec within the docs repo (for example `docs/api-reference/convex-spec.yaml`) and reference it via navigation metadata so Mintlify bundles it with the site build.[^mint-openapi]

```json
{
  "tab": "API Reference",
  "groups": [
    {
      "group": "Endpoints",
      "openapi": {
        "source": "/api-reference/convex-spec.yaml",
        "directory": "api-reference"
      }
    }
  ]
}
```

### Step 6: Test the playground
- Execute curl requests against representative endpoints (e.g., `/api/run/{function}`) to confirm responses match the examples you embedded.
- In Mintlify preview, verify the playground prompts for the expected auth headers and that each endpoint loads with the correct schema and examples.

```bash
curl https://your-deployment.convex.cloud/api/run/messages/list \
  -H "Content-Type: application/json" \
  -d '{"args": {}, "format": "json"}'
```

### Step 7: Automate post-processing (optional)
- Wrap generation, URL replacement, and validation in a small helper script so developers can refresh docs with a single command.

```js
// tools/move-spec.js
const fs = require("fs");
const src = "./convex-spec.yaml";
const dst = "./docs/api-reference/convex-spec.yaml";
let yaml = fs.readFileSync(src, "utf8");
yaml = yaml.replace("{hostUrl}", "https://your-deployment.convex.cloud");
fs.mkdirSync("./docs/api-reference", { recursive: true });
fs.writeFileSync(dst, yaml);
console.log("Spec moved to", dst);
```

### Step 8: Security and best practices
- Exclude internal or admin-only endpoints from public specs, or mark them with prominent warnings plus dedicated security requirements.
- Use placeholder tokens (e.g., `<your-token-here>`) in examples and remind readers to keep deploy keys out of version control.
- Document how to obtain credentials and highlight Convex-specific semantics (e.g., run endpoints, `format` parameter, `logLines` field).

### Step 9: Caveats and helpful links
- Emphasize that Convex’s OpenAPI generator is currently in beta and focuses on HTTP access patterns, not reactive subscriptions.[^convex-openapi]
- Link to the Convex OpenAPI reference and Mintlify API Playground docs so maintainers can dig deeper when features evolve.[^mint-openapi]

[^convex-openapi]: Convex documentation — “Generate OpenAPI Specification” and related guidance on limitations and client generation. Retrieved via Context7 `/get-convex/convex-backend`.
[^mint-openapi]: Mintlify documentation — API Playground setup, server configuration, authentication, and validation commands. Retrieved via Context7 `/mintlify/docs`.
[^redocly-cli]: Redocly CLI documentation — migration guidance from swagger-cli and lint command usage. Retrieved via Context7 `/redocly/redocly-cli`.

## Components and Interfaces

### 1. Workflow Orchestration Script (`scripts/update-api-docs.sh`)

**Purpose**: Orchestrates the complete workflow from generation to validation

**Interface**:

```bash
#!/bin/bash
# Usage: npm run update:api-docs [--env=dev|staging|prod]
# Default: dev
```

**Responsibilities**:

- Verify `convex-helpers` is installed (install if missing)
- Apply a bytes-to-binary compatibility patch for the current `convex-helpers` release
- Run `pnpm exec convex-helpers open-api-spec --output-file convex-spec` to generate base spec
- Invoke enhancement script with environment-specific configuration
- Run OpenAPI validation
- Move enhanced spec to docs directory
- Report success/failure with actionable messages

**Implementation**:

```bash
#!/bin/bash
set -e

ENV=${1:-dev}
echo "Generating OpenAPI spec for environment: $ENV"

# Ensure convex-helpers is installed
if ! pnpm exec convex-helpers open-api-spec --help > /dev/null 2>&1; then
  echo "Installing convex-helpers..."
  pnpm add -D convex-helpers
fi

echo "Patching convex-helpers for bytes support..."
node scripts/patch-convex-helpers-openapi.js

# Generate base spec from Convex deployment
echo "Running convex-helpers open-api-spec..."
pnpm exec convex-helpers open-api-spec --output-file convex-spec

echo "Generated convex-spec files:"
ls -1 convex-spec*.yaml 2>/dev/null || echo "  (no convex-spec*.yaml files present)"

# Enhance the spec
echo "Enhancing OpenAPI spec..."
pnpm exec tsx scripts/enhance-openapi.ts --env=$ENV

# Validate the enhanced spec
echo "Validating OpenAPI spec..."
pnpm exec tsx scripts/validate-openapi.ts docs/api-reference/convex-openapi.yaml

echo "✓ API documentation updated successfully!"
```

**Key Design Decisions**:

- Use bash for cross-platform compatibility
- Fail fast with `set -e` to catch errors early
- Use `tsx` to run TypeScript scripts directly
- Accept environment parameter for multi-deployment support

### 2. Enhancement Script (`scripts/enhance-openapi.ts`)

**Purpose**: Post-processes the generated OpenAPI spec to add Mintlify-specific enhancements

**Interface**:

```typescript
interface EnhancementConfig {
  inputPath: string; // Path to convex-spec.yaml
  outputPath: string; // Path to enhanced spec
  deploymentUrl: string; // Concrete Convex deployment URL
  environment: "dev" | "staging" | "prod";
  extractExamples?: boolean; // Whether to extract real examples (optional)
}

async function enhanceOpenAPISpec(config: EnhancementConfig): Promise<void>;
```

**Responsibilities**:

- Parse YAML input using `js-yaml`
- Replace `{hostUrl}` placeholder with actual deployment URL
- Add security schemes (bearerAuth for user authentication)
- Add detailed descriptions for Convex-specific concepts
- Organize endpoints with tags (Users, Meetings, Transcripts, etc.)
- Apply security requirements to protected endpoints
- Optionally extract real examples by calling Convex functions
- Write enhanced YAML output

**Implementation Outline**:

```typescript
import * as yaml from "js-yaml";
import * as fs from "fs";
import { ConvexHttpClient } from "convex/browser";

interface EnhancementConfig {
  inputPath: string;
  outputPath: string;
  deploymentUrl: string;
  environment: "dev" | "staging" | "prod";
  extractExamples?: boolean;
}

async function enhanceOpenAPISpec(config: EnhancementConfig): Promise<void> {
  // 1. Read base spec
  const baseSpec = yaml.load(fs.readFileSync(config.inputPath, "utf8"));

  // 2. Replace server URLs
  baseSpec.servers = [
    {
      url: config.deploymentUrl,
      description: `${config.environment.charAt(0).toUpperCase() + config.environment.slice(1)} environment`,
    },
  ];

  // 3. Add security schemes
  baseSpec.components = baseSpec.components || {};
  baseSpec.components.securitySchemes = {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description:
        "User authentication token from WorkOS Auth. Include in Authorization header: `Bearer <token>`",
    },
  };

  // 4. Add tags for organization
  baseSpec.tags = [
    {
      name: "Users",
      description: "User profile and authentication operations",
    },
    {
      name: "Meetings",
      description: "Meeting lifecycle and participant management",
    },
    {
      name: "Transcripts",
      description: "Live transcription and transcript queries",
    },
    { name: "Insights", description: "AI-generated post-call insights" },
    { name: "Prompts", description: "AI conversation prompts and suggestions" },
    { name: "Notes", description: "Collaborative meeting notes" },
    { name: "WebRTC", description: "WebRTC signaling and session management" },
    { name: "System", description: "Health checks and system operations" },
  ];

  // 5. Apply security to protected endpoints
  for (const [path, methods] of Object.entries(baseSpec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation && typeof operation === "object") {
        // Apply bearerAuth to all endpoints except health check
        if (!path.includes("/health")) {
          operation.security = [{ bearerAuth: [] }];
        }

        // Assign tags based on path
        if (path.includes("users")) operation.tags = ["Users"];
        else if (path.includes("meetings")) operation.tags = ["Meetings"];
        else if (path.includes("transcripts")) operation.tags = ["Transcripts"];
        else if (path.includes("insights")) operation.tags = ["Insights"];
        else if (path.includes("prompts")) operation.tags = ["Prompts"];
        else if (path.includes("notes")) operation.tags = ["Notes"];
        else if (path.includes("webrtc")) operation.tags = ["WebRTC"];
        else operation.tags = ["System"];
      }
    }
  }

  // 6. Optionally extract real examples
  if (config.extractExamples) {
    await extractRealExamples(baseSpec, config.deploymentUrl);
  }

  // 7. Write enhanced spec
  fs.writeFileSync(config.outputPath, yaml.dump(baseSpec, { lineWidth: -1 }));
  console.log(`✓ Enhanced spec written to ${config.outputPath}`);
}

async function extractRealExamples(
  spec: any,
  deploymentUrl: string,
): Promise<void> {
  // This is optional and can be implemented later
  // Would call actual Convex functions to get real response examples
  console.log(
    "Example extraction not yet implemented - using generated schemas only",
  );
}

// CLI entry point
const args = process.argv.slice(2);
const env =
  args.find((arg) => arg.startsWith("--env="))?.split("=")[1] || "dev";

const deploymentUrls = {
  dev: process.env.CONVEX_URL_DEV || "https://linkedup-dev.convex.cloud",
  staging:
    process.env.CONVEX_URL_STAGING || "https://linkedup-staging.convex.cloud",
  prod: process.env.CONVEX_URL_PROD || "https://linkedup-prod.convex.cloud",
};

enhanceOpenAPISpec({
  inputPath: "convex-spec.yaml",
  outputPath: "docs/api-reference/convex-openapi.yaml",
  deploymentUrl: deploymentUrls[env],
  environment: env as "dev" | "staging" | "prod",
  extractExamples: false, // Can be enabled later
}).catch((error) => {
  console.error("Enhancement failed:", error);
  process.exit(1);
});
```

**Key Design Decisions**:

- Use `js-yaml` for YAML parsing/serialization
- Read deployment URLs from environment variables
- Keep enhancement logic simple and focused
- Make example extraction optional (can be added later)
- Preserve all schemas generated by convex-helpers

### 3. Validation Script (`scripts/validate-openapi.ts`)

**Purpose**: Validates the enhanced OpenAPI specification

**Interface**:

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

async function validateOpenAPISpec(specPath: string): Promise<ValidationResult>;
```

**Implementation**:

```typescript
import { execSync } from "child_process";
import * as fs from "fs";
import * as yaml from "js-yaml";

async function validateOpenAPISpec(specPath: string): Promise<void> {
  console.log(`Validating ${specPath}...`);

  // 1. Check file exists
  if (!fs.existsSync(specPath)) {
    throw new Error(`Spec file not found: ${specPath}`);
  }

  // 2. Parse YAML
  try {
    const spec = yaml.load(fs.readFileSync(specPath, "utf8"));
    console.log("✓ Valid YAML syntax");
  } catch (error) {
    throw new Error(`Invalid YAML: ${error.message}`);
  }

  // 3. Validate against OpenAPI schema using Redocly CLI
  try {
    execSync(`pnpm exec redocly lint --extends=minimal ${specPath}`, {
      stdio: "inherit",
    });
    console.log("✓ Valid OpenAPI 3.x specification");
  } catch (error) {
    throw new Error("OpenAPI validation failed");
  }

  // 4. Custom checks
  const spec = yaml.load(fs.readFileSync(specPath, "utf8")) as any;

  // Check for placeholder URLs
  if (spec.servers?.some((s) => s.url.includes("{hostUrl}"))) {
    throw new Error(
      "Placeholder {hostUrl} found in servers - enhancement may have failed",
    );
  }

  // Check for security schemes
  if (!spec.components?.securitySchemes) {
    console.warn("⚠ No security schemes defined");
  }

  console.log("✓ All validation checks passed");
}

// CLI entry point
const specPath = process.argv[2];
if (!specPath) {
  console.error("Usage: tsx validate-openapi.ts <path-to-spec>");
  process.exit(1);
}

validateOpenAPISpec(specPath).catch((error) => {
  console.error("Validation failed:", error.message);
  process.exit(1);
});
```

**Key Design Decisions**:

- Use `@redocly/cli` for standard OpenAPI validation
- Add custom checks for common issues
- Provide clear error messages
- Exit with non-zero code on failure for CI integration

### 4. Mintlify Configuration (`mint.json`)

**Purpose**: Configures Mintlify to consume the OpenAPI spec and render documentation

**Location**: Project root (`mint.json`)

**Configuration**:

```json
{
  "$schema": "https://mintlify.com/schema.json",
  "name": "LinkedUp API Documentation",
  "logo": {
    "dark": "/public/linkeduplogos/linkedupwhite.svg",
    "light": "/public/linkeduplogos/linkedupblack.svg"
  },
  "favicon": "/public/logo-square.png",
  "colors": {
    "primary": "#0D9373",
    "light": "#07C983",
    "dark": "#0D9373",
    "anchors": {
      "from": "#0D9373",
      "to": "#07C983"
    }
  },
  "topbarLinks": [
    {
      "name": "Dashboard",
      "url": "https://app.linkedup.example.com"
    }
  ],
  "tabs": [
    {
      "name": "API Reference",
      "url": "api-reference"
    }
  ],
  "navigation": [
    {
      "group": "Getting Started",
      "pages": ["introduction", "quickstart", "authentication"]
    },
    {
      "group": "API Reference",
      "pages": ["api-reference/introduction"]
    }
  ],
  "footerSocials": {
    "github": "https://github.com/linkedup"
  },
  "openapi": "docs/api-reference/convex-openapi.yaml",
  "api": {
    "baseUrl": "https://linkedup-dev.convex.cloud",
    "auth": {
      "method": "bearer",
      "name": "Authorization"
    },
    "playground": {
      "mode": "show"
    }
  }
}
```

**Key Design Decisions**:

- Single `openapi` field pointing to enhanced spec (Mintlify auto-generates pages)
- Enable API Playground for all endpoints
- Use existing LinkedUp branding (logos, colors)
- Keep navigation minimal - Mintlify creates pages from OpenAPI tags
- Point to dev deployment by default (can be changed for production docs)

## Data Models

### OpenAPI Specification Structure (Generated by convex-helpers)

The `convex-helpers open-api-spec` command generates a spec with:

- **Paths**: All public queries, mutations, actions, and HTTP actions
- **Schemas**: Generated from Convex validators (`v.object()`, `v.string()`, etc.)
- **Operations**: Function names, parameters, return types
- **Placeholder Server**: `{hostUrl}` that we replace with actual URL

### Enhancement Additions

We add:

- **Concrete Server URLs**: Replace `{hostUrl}` with actual deployment URLs
- **Security Schemes**: `bearerAuth` for user authentication
- **Tags**: Organize endpoints by domain (Users, Meetings, etc.)
- **Descriptions**: Add context for Convex-specific concepts
- **Security Requirements**: Apply `bearerAuth` to protected endpoints

## Error Handling

### Generation Errors

1. **Convex Deployment Unreachable**
   - Error: `convex-helpers` cannot connect to deployment
   - Handling: Check CONVEX_URL environment variable, verify deployment is active
   - Message: "Failed to connect to Convex deployment. Verify CONVEX_URL is set correctly."

2. **Missing Validators**
   - Error: Functions lack argument/return validators
   - Handling: convex-helpers generates generic schemas, logs warnings
   - Message: "Warning: Some functions lack validators. Add validators for better type information."

### Enhancement Errors

1. **Base Spec Not Found**
   - Error: `convex-spec.yaml` doesn't exist
   - Handling: Check if generation step completed successfully
   - Message: "Base spec not found. Run generation step first."

2. **Invalid Deployment URL**
   - Error: Deployment URL format is incorrect
   - Handling: Validate URL format, check environment variables
   - Message: "Invalid deployment URL. Expected format: https://{slug}.convex.cloud"

3. **YAML Parse Error**
   - Error: Generated spec is not valid YAML
   - Handling: Log parsing error, preserve raw output for debugging
   - Message: "Failed to parse generated spec. Check convex-spec.yaml for syntax errors."

### Validation Errors

1. **OpenAPI Schema Violations**
   - Error: Spec doesn't conform to OpenAPI 3.x standard
   - Handling: Report specific violations with line numbers
   - Message: "OpenAPI validation failed: {error}"

2. **Placeholder URLs Remain**
   - Error: `{hostUrl}` still present after enhancement
   - Handling: Check enhancement script logic
   - Message: "Enhancement failed: placeholder URLs not replaced"

## Testing Strategy

### Unit Tests

**Target**: Enhancement script functions

**Test Cases**:

1. `replaceServerUrls()` - Verify placeholder replacement
2. `addSecuritySchemes()` - Ensure security schemes are added
3. `organizeTags()` - Check tag assignment logic
4. `validateYAML()` - Test YAML parsing

**Tools**: Vitest

### Integration Tests

**Target**: End-to-end workflow

**Test Cases**:

1. Run full workflow against test deployment
2. Verify enhanced spec is valid OpenAPI
3. Check all expected endpoints are present
4. Verify security schemes are applied

**Tools**: Vitest with file system mocking

### Manual Testing

**Target**: Mintlify integration

**Test Cases**:

1. Import spec into Mintlify and verify rendering
2. Test API Playground with real authentication
3. Verify all endpoints are accessible
4. Test search functionality

**Tools**: Mintlify preview

## Deployment Strategy

### Phase 1: Setup (Week 1)

1. Install `convex-helpers` as dev dependency
2. Create workflow orchestration script
3. Test generation against development deployment
4. Verify generated spec structure

### Phase 2: Enhancement (Week 2)

1. Implement enhancement script
2. Add server URL replacement
3. Add security schemes
4. Add tags and descriptions
5. Test enhanced spec

### Phase 3: Mintlify Integration (Week 3)

1. Create Mintlify account and project
2. Configure `mint.json`
3. Set up Git Sync
4. Test API Playground
5. Customize branding

### Phase 4: Automation (Week 4)

1. Add npm scripts
2. Add validation to CI/CD
3. Set up automatic regeneration on deployment
4. Document maintenance procedures

## Maintenance

### Regular Updates

- **On Deployment**: Regenerate spec automatically
- **Weekly**: Review and update descriptions
- **Monthly**: Audit security schemes

### Monitoring

- Track API documentation page views
- Monitor API Playground usage
- Alert on spec validation failures
- Track generation script execution time
