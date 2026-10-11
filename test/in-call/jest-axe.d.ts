// jest-axe v11 ships no type declarations (its package is index.js +
// extend-expect.js only). This ambient declaration must stay a GLOBAL script
// (no top-level imports/exports) — a top-level import would turn the file into
// a module and downgrade `declare module` to an augmentation, which cannot fix
// a "no declaration file" resolution.

declare module "jest-axe" {
  /** Minimal structural type of the axe-core results object jest-axe resolves. */
  export interface JestAxeResults {
    violations: Array<{
      id: string;
      help: string;
      helpUrl?: string;
      impact?: string | null;
      nodes: Array<{ html: string; target: string[]; failureSummary?: string }>;
    }>;
    passes: unknown[];
    incomplete: unknown[];
    toolOptions?: { impactLevels?: string[] };
  }

  /** jest-axe's axe() wrapper around axe-core#run (mounted element or HTML string). */
  export function axe(
    html: Element | string,
    options?: Record<string, unknown>,
  ): Promise<JestAxeResults>;

  /** Matcher map — pass directly to expect.extend (not wrapped in an object). */
  export const toHaveNoViolations: {
    toHaveNoViolations(results: JestAxeResults): {
      actual: JestAxeResults;
      pass: boolean;
      // vitest's SyncExpectationResult requires `message: () => string`;
      // jest-axe's runtime only returns a message on failure (on pass it
      // yields undefined, which vitest never calls).
      message: () => string;
    };
  };
}
