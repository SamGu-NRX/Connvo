/// <reference types="vite/client" />

// This file is required by vitest.config.ts and is executed before tests are run.
// It is a good place to put global setup and configuration.

// The following is a workaround for the error "import.meta.glob is not a function".
// It explicitly imports the modules and makes them available to convex-test.
export const modules = import.meta.glob("../**/*.ts");