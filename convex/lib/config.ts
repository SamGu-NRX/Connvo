import { config as localConfig } from "@convex/environments/local";
import { config as stagingConfig } from "@convex/environments/staging";
import { config as productionConfig } from "@convex/environments/production";

type Environment = "local" | "staging" | "production";

function getEnvironment(): Environment {
  // In Convex, we can use process.env to determine environment
  const env = (process.env.NODE_ENV ?? "") as string;
  const convexUrl = process.env.CONVEX_URL || "";

  if (env === "production" || convexUrl.includes("prod")) {
    return "production";
  } else if (env === "staging" || convexUrl.includes("staging")) {
    return "staging";
  } else {
    return "local";
  }
}

function getConfig() {
  const environment = getEnvironment();

  switch (environment) {
    case "production":
      return productionConfig;
    case "staging":
      return stagingConfig;
    case "local":
    default:
      return localConfig;
  }
}

export const appConfig = getConfig();

// Helper functions for feature flags
export function isFeatureEnabled(
  feature: keyof typeof appConfig.features,
): boolean {
  return appConfig.features[feature];
}

export function getRateLimit(action: keyof typeof appConfig.rateLimits) {
  return appConfig.rateLimits[action];
}

export function getBatchConfig(type: keyof typeof appConfig.batching) {
  return appConfig.batching[type];
}