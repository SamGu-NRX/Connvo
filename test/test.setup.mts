/// <reference types="vite/client" />
// Adjust the relative glob as needed depending on where this file lives.
export const modules = import.meta.glob(
  "../convex/**/*.{ts,tsx,js,mjs,mts,cts,cjs,jsx,tsx}"
);