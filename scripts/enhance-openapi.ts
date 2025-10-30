import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { loadDocstringInfo } from "./docstringParser";

type Environment = "dev" | "staging" | "prod";

interface EnhancementConfig {
  inputPath: string;
  outputPath: string;
  environment: Environment;
  deploymentUrls: Record<Environment, string>;
}

type OpenAPISpec = {
  servers?: Array<{ url: string; description?: string }>;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  components?: {
    securitySchemes?: Record<string, any>;
    schemas?: Record<string, any>;
  };
  security?: Array<Record<string, any>>;
  tags?: Array<{ name: string; description?: string }>;
  paths?: Record<string, Record<string, any>>;
};

const DEFAULT_DEPLOYMENT_URLS: Record<Environment, string> = {
  dev: "https://linkedup-dev.convex.cloud",
  staging: "https://linkedup-staging.convex.cloud",
  prod: "https://linkedup-prod.convex.cloud",
};

const TAG_DEFINITIONS: Array<{ name: string; description: string }> = [
  {
    name: "Users",
    description: "Identity, profile, and authentication operations for LinkedUp users.",
  },
  {
    name: "Meetings",
    description: "Scheduling, managing, and retrieving meeting data.",
  },
  {
    name: "Transcripts",
    description: "Endpoints for accessing call transcripts and transcription controls.",
  },
  {
    name: "Insights",
    description: "AI-generated insights, summaries, and analytics derived from meetings.",
  },
  {
    name: "Prompts",
    description: "Prompt management and AI conversation guidance.",
  },
  {
    name: "Notes",
    description: "Collaborative meeting notes and follow-up documentation.",
  },
  {
    name: "WebRTC",
    description: "Real-time communication, session signalling, and media utilities.",
  },
  {
    name: "System",
    description: "General system endpoints such as health checks and diagnostics.",
  },
];

const TAG_PATH_PATTERNS: Array<{ tag: string; matcher: RegExp }> = [
  { tag: "Users", matcher: /user|account|profile/i },
  { tag: "Meetings", matcher: /meeting|calendar|event/i },
  { tag: "Transcripts", matcher: /transcript|caption/i },
  { tag: "Insights", matcher: /insight|analysis|analytics/i },
  { tag: "Prompts", matcher: /prompt|suggestion/i },
  { tag: "Notes", matcher: /note|summary/i },
  { tag: "WebRTC", matcher: /webrtc|rtc|session/i },
];

interface OperationContext {
  key: string;
  exportName: string;
  filePath: string | null;
}

function humanizeFunctionName(exportName: string): string {
  const withSpaces = exportName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();

  if (!withSpaces) {
    return exportName;
  }

  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function resolveModuleFilePath(moduleSegments: string[]): string | null {
  const basePath = path.resolve("convex", ...moduleSegments);
  const candidates = [`${basePath}.ts`, `${basePath}.tsx`, `${basePath}.js`];

  if (moduleSegments[moduleSegments.length - 1] !== "index") {
    candidates.push(
      path.join(basePath, "index.ts"),
      path.join(basePath, "index.tsx"),
      path.join(basePath, "index.js"),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function parseOperationContext(pathKey: string): OperationContext | null {
  const prefix = "/api/run/";
  if (!pathKey.startsWith(prefix)) return null;
  const segments = pathKey.slice(prefix.length).split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const exportName = segments[segments.length - 1];
  const moduleSegments = segments.slice(0, -1);
  const key = `${moduleSegments.join("/")}/${exportName}`;
  const filePath = resolveModuleFilePath(moduleSegments);

  return {
    key,
    exportName,
    filePath,
  };
}

function buildOperationId(method: string, pathKey: string): string {
  const segments = pathKey
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "{id}" && segment !== "{}")
    .map((segment) =>
      segment
        .replace(/[{}]/g, "")
        .replace(/[^a-zA-Z0-9]/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(""),
    )
    .filter(Boolean);

  const baseId = segments.length > 0 ? segments.join("") : "Root";
  const methodPrefix = method.toLowerCase();
  const operationId = `${methodPrefix}${baseId}`;
  return operationId;
}

function resolveDeploymentUrls(): Record<Environment, string> {
  return {
    dev: process.env.CONVEX_URL_DEV || DEFAULT_DEPLOYMENT_URLS.dev,
    staging: process.env.CONVEX_URL_STAGING || DEFAULT_DEPLOYMENT_URLS.staging,
    prod: process.env.CONVEX_URL_PROD || DEFAULT_DEPLOYMENT_URLS.prod,
  };
}

function readOpenAPISpec(filePath: string): OpenAPISpec {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Base spec not found at ${filePath}. Run convex-helpers before enhancement.`);
  }

  const fileContents = fs.readFileSync(filePath, "utf8");
  const parsed = yaml.load(fileContents);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Unable to parse OpenAPI spec: parsed value is not an object.");
  }

  return parsed as OpenAPISpec;
}

function writeOpenAPISpec(spec: OpenAPISpec, filePath: string) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const yamlContent = yaml.dump(spec, { lineWidth: -1 });
  fs.writeFileSync(filePath, yamlContent, "utf8");
}

function buildServers(env: Environment, urls: Record<Environment, string>) {
  const orderedEnvironments: Environment[] = [env, ...(["dev", "staging", "prod"] as Environment[]).filter(
    (name) => name !== env,
  )];

  const seen = new Set<string>();
  return orderedEnvironments
    .map((name) => ({
      name,
      url: urls[name],
    }))
    .filter(({ url }) => Boolean(url))
    .map(({ name, url }) => {
      const normalizedUrl = url.trim();
      if (!normalizedUrl || seen.has(normalizedUrl)) {
        return null;
      }
      seen.add(normalizedUrl);
      return {
        url: normalizedUrl,
        description: `${name.charAt(0).toUpperCase()}${name.slice(1)} Convex deployment`,
      };
    })
    .filter((server): server is { url: string; description: string } => Boolean(server));
}

function applySecuritySchemes(spec: OpenAPISpec) {
  spec.components = spec.components ?? {};
  spec.components.securitySchemes = {
    ...spec.components.securitySchemes,
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description:
        "Standard user authentication token issued via WorkOS. Provide as `Authorization: Bearer <user-token>`.",
    },
    convexDeploy: {
      type: "apiKey",
      in: "header",
      name: "Authorization",
      description:
        "Convex deploy key for privileged operations. Use the format `Convex <deploy-key>` and never publish this value.",
    },
  };

  if (!Array.isArray(spec.security) || spec.security.length === 0) {
    spec.security = [{ bearerAuth: [] }];
  }
}

function ensureTags(spec: OpenAPISpec) {
  const existingTags = new Map<string, { name: string; description?: string }>();

  if (Array.isArray(spec.tags)) {
    for (const tag of spec.tags) {
      if (tag?.name) {
        existingTags.set(tag.name, tag);
      }
    }
  }

  ["query", "mutation", "action"].forEach((name) => existingTags.delete(name));

  for (const tagDefinition of TAG_DEFINITIONS) {
    existingTags.set(tagDefinition.name, tagDefinition);
  }

  spec.tags = Array.from(existingTags.values());
}

function resolveTagForPath(pathKey: string): string {
  for (const { tag, matcher } of TAG_PATH_PATTERNS) {
    if (matcher.test(pathKey)) {
      return tag;
    }
  }
  return "System";
}

function removeInternalOperations(spec: OpenAPISpec) {
  if (!spec.paths) return;

  for (const pathKey of Object.keys(spec.paths)) {
    if (/\/types\/_template\//i.test(pathKey)) {
      delete spec.paths[pathKey];
      continue;
    }

    const operations = spec.paths[pathKey];
    for (const method of Object.keys(operations)) {
      const operation = operations[method];
      if (operation && typeof operation === "object") {
        if (operation["x-internal"] === true || /\/internal\//i.test(pathKey)) {
          delete operations[method];
        }
      }
    }

    if (Object.keys(operations).length === 0) {
      delete spec.paths[pathKey];
    }
  }
}

function assignTagsAndSecurity(spec: OpenAPISpec) {
  if (!spec.paths) return;

  for (const [pathKey, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation || typeof operation !== "object") continue;

      if (!/\/health/i.test(pathKey)) {
        operation.security = operation.security ?? [];
        const hasBearer = operation.security.some((item: any) => item && "bearerAuth" in item);
        if (!hasBearer) {
          operation.security.push({ bearerAuth: [] });
        }
      }

      operation.tags = [resolveTagForPath(pathKey)];

       if (!operation.operationId || typeof operation.operationId !== "string") {
        operation.operationId = buildOperationId(method, pathKey);
      }

      if (!operation.description || typeof operation.description !== "string") {
        if (typeof operation.summary === "string" && operation.summary.trim().length > 0) {
          operation.description = operation.summary;
        } else {
          operation.description = `${method.toUpperCase()} ${pathKey}`;
        }
      }
    }
  }
}

function enrichOperationMetadata(spec: OpenAPISpec) {
  if (!spec.paths) return;

  for (const [pathKey, methods] of Object.entries(spec.paths)) {
    const context = parseOperationContext(pathKey);
    if (!context) continue;

    const docInfo =
      context.filePath && fs.existsSync(context.filePath)
        ? loadDocstringInfo(context.filePath, context.exportName)
        : null;

    for (const operation of Object.values(methods)) {
      if (!operation || typeof operation !== "object") continue;

      const methodSummary = context.exportName;
      operation.summary = methodSummary;

      const docSummary = docInfo?.summary?.trim();
      const docDescription = docInfo?.description?.trim();

      const descriptionCandidates: Array<string | undefined> = [];
      if (docDescription && docDescription !== docSummary) {
        descriptionCandidates.push(docDescription);
      }
      if (docSummary && docSummary !== methodSummary) {
        descriptionCandidates.push(docSummary);
      }
      if (typeof operation.description === "string") {
        const existing = operation.description.trim();
        if (existing.length > 0 && existing !== methodSummary) {
          descriptionCandidates.push(existing);
        }
      }

      const fallbackDescription = `Runs the Convex function \`${context.key}\` (export \`${context.exportName}\`) through the Convex HTTP API.`;
      const resolvedDescription =
        descriptionCandidates.find((value) => value && value.length > 0) ?? fallbackDescription;

      operation.description = resolvedDescription;

      const requestContent =
        operation.requestBody?.content &&
        operation.requestBody.content["application/json"];

      const requestExample = docInfo?.examples?.request?.value;
      if (requestExample && requestContent) {
        requestContent.example = requestExample;
      }

      const successResponse =
        operation.responses &&
        (operation.responses["200"] || operation.responses["201"]);
      const responseContent =
        successResponse &&
        successResponse.content &&
        successResponse.content["application/json"];

      const responseExample = docInfo?.examples?.response?.value;
      if (responseExample && responseContent) {
        responseContent.example = responseExample;
      }
    }
  }
}

function enhanceOpenAPISpec(config: EnhancementConfig) {
  const spec = readOpenAPISpec(config.inputPath);

  spec.info = {
    ...spec.info,
    title: "LinkedUp Convex API",
    version: spec.info?.version && spec.info.version !== "0.0.0" ? spec.info.version : "1.0.0",
    description:
      spec.info?.description ??
      "HTTP interface for LinkedUp's Convex backend, exposing all public query, mutation, and action endpoints.",
  };

  const servers = buildServers(config.environment, config.deploymentUrls);
  if (servers.length === 0) {
    throw new Error("No deployment URLs were resolved. Ensure CONVEX_URL_* variables are set.");
  }
  spec.servers = servers;

  applySecuritySchemes(spec);
  ensureTags(spec);
  removeInternalOperations(spec);
  assignTagsAndSecurity(spec);
  enrichOperationMetadata(spec);

  writeOpenAPISpec(spec, config.outputPath);
  console.log(`Enhanced OpenAPI spec written to ${config.outputPath}`);
}

function parseArgs(): Environment {
  const defaultEnv: Environment = "dev";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--env=")) {
      const requested = arg.split("=")[1] as Environment;
      if (requested === "dev" || requested === "staging" || requested === "prod") {
        return requested;
      }
      throw new Error(`Unsupported environment '${requested}'. Expected dev, staging, or prod.`);
    }
  }
  return defaultEnv;
}

function main() {
  const environment = parseArgs();
  const deploymentUrls = resolveDeploymentUrls();

  enhanceOpenAPISpec({
    inputPath: path.resolve("convex-spec.yaml"),
    outputPath: path.resolve("docs/api-reference/convex-openapi.yaml"),
    environment,
    deploymentUrls,
  });
}

main();
