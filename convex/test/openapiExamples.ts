"use node";
/**
 * OpenAPI example helpers that pull structured data from Convex docstrings.
 *
 * Tests consume these utilities to ensure the documentation stays synchronized
 * with real-world payloads without maintaining a manual map.
 */

import path from "path";
import { loadDocstringInfo, ParsedDocstring } from "../../scripts/docstringParser";

export function getDocstringInfoForOperation(
  moduleRelativePath: string,
  exportName: string,
): ParsedDocstring {
  const filePath = path.resolve(process.cwd(), moduleRelativePath);
  const info = loadDocstringInfo(filePath, exportName);
  if (!info) {
    throw new Error(`Docstring metadata not found for ${moduleRelativePath}:${exportName}`);
  }
  return info;
}

export function getExampleValue(docstring: ParsedDocstring, label: string) {
  return docstring.examples[label]?.value;
}
