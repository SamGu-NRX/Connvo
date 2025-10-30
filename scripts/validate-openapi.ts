import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

function assertFileExists(specPath: string) {
  if (!fs.existsSync(specPath)) {
    throw new Error(`Spec file not found at ${specPath}. Run the generation workflow first.`);
  }
}

function parseYaml(specPath: string) {
  const raw = fs.readFileSync(specPath, "utf8");
  try {
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Parsed value is not an object.");
    }
    return parsed as Record<string, any>;
  } catch (error) {
    throw new Error(`Invalid YAML in ${specPath}: ${(error as Error).message}`);
  }
}

function runRedoclyLint(specPath: string) {
  try {
    const args = ["exec", "redocly", "lint", specPath];
    const configPath = "redocly.yaml";
    if (fs.existsSync("redocly.yaml")) {
      console.log(`Using Redocly configuration at ${configPath}.`);
      args.splice(3, 0, "--config", configPath);
    } else {
      console.warn("redocly.yaml not found. Falling back to Redocly minimal configuration.");
      args.splice(3, 0, "--extends=minimal");
    }
    execFileSync("pnpm", args, { stdio: "inherit" });
  } catch (error) {
    throw new Error("OpenAPI validation failed. See output above for details.");
  }
}

function runCustomChecks(spec: Record<string, any>) {
  const servers: Array<{ url?: string }> = Array.isArray(spec.servers) ? spec.servers : [];
  if (servers.length === 0) {
    throw new Error("No servers defined in spec. At least one deployment URL is required.");
  }

  const placeholderServer = servers.find((server) => typeof server.url === "string" && server.url.includes("{hostUrl}"));
  if (placeholderServer) {
    throw new Error("Placeholder server URL '{hostUrl}' detected. Enhancement script may have failed.");
  }

  const securitySchemes = spec.components?.securitySchemes;
  if (!securitySchemes || Object.keys(securitySchemes).length === 0) {
    throw new Error("No security schemes defined. Add bearerAuth and convexDeploy schemes.");
  }

  if (!spec.paths || Object.keys(spec.paths).length === 0) {
    throw new Error("Spec contains no paths. Ensure convex-helpers generated endpoints correctly.");
  }

  const missingDescriptions: string[] = [];
  for (const [pathKey, methods] of Object.entries(spec.paths as Record<string, Record<string, any>>)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation.description || typeof operation.description !== "string") {
        missingDescriptions.push(`${method.toUpperCase()} ${pathKey}`);
      }
    }
  }

  if (missingDescriptions.length > 0) {
    console.warn(
      `⚠️  ${missingDescriptions.length} operations are missing descriptions. Consider enhancing these endpoints for better documentation.`,
    );
  }
}

function validateOpenAPISpec(specPath: string) {
  assertFileExists(specPath);

  console.log(`Validating OpenAPI specification at ${specPath}...`);
  const parsedSpec = parseYaml(specPath);
  console.log("✓ YAML syntax is valid.");

  runRedoclyLint(specPath);
  console.log("✓ Spec conforms to the OpenAPI 3.x schema linted with Redocly CLI.");

  runCustomChecks(parsedSpec);
  console.log("✓ Custom validation checks passed.");
}

function main() {
  const specArgument = process.argv[2];
  if (!specArgument) {
    console.error("Usage: tsx scripts/validate-openapi.ts <path-to-openapi-spec>");
    process.exit(1);
  }

  const specPath = path.resolve(specArgument);

  try {
    validateOpenAPISpec(specPath);
  } catch (error) {
    console.error(`Validation failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
