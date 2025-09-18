import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "convex/**/*.test.ts",
      "convex/**/*.spec.ts",
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
    ],
    exclude: ["node_modules/**", ".next/**", "dist/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    // Type testing configuration
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@convex": path.resolve(__dirname, "./convex"),
    },
  },
});
