import fs from "fs";
import path from "path";

export interface ParsedDocstringExample {
  label: string;
  raw: string;
  value?: unknown;
}

export interface ParsedDocstring {
  summary?: string;
  description?: string;
  examples: Record<string, ParsedDocstringExample>;
}

const fileCache = new Map<string, string | null>();
const docCache = new Map<string, Map<string, ParsedDocstring | null>>();
const reExportCache = new Map<
  string,
  {
    named: Map<string, { filePath: string; exportName: string }>;
    star: string[];
  }
>();

function readSourceFile(filePath: string): string | null {
  const normalizedPath = path.resolve(filePath);
  if (fileCache.has(normalizedPath)) {
    return fileCache.get(normalizedPath) ?? null;
  }

  if (!fs.existsSync(normalizedPath)) {
    fileCache.set(normalizedPath, null);
    return null;
  }

  const content = fs.readFileSync(normalizedPath, "utf8");
  fileCache.set(normalizedPath, content);
  return content;
}

function stripCommentDelimiters(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*\*\s?/, "")
        .replace(/\r$/, ""),
    );
}

function parseExampleContent(raw: string): ParsedDocstringExample {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```[\w-]*\n([\s\S]*?)```$/);
  const content = fenceMatch ? fenceMatch[1].trim() : trimmed;

  let parsedValue: unknown;
  if (content.length > 0) {
    try {
      parsedValue = JSON.parse(content);
    } catch (_) {
      parsedValue = undefined;
    }
  }

  return {
    label: "",
    raw: trimmed,
    value: parsedValue,
  };
}

export function parseDocstring(raw: string): ParsedDocstring {
  const lines = stripCommentDelimiters(raw);

  const examples: Record<string, ParsedDocstringExample> = {};
  const preTagLines: string[] = [];
  let summaryFromTag: string | undefined;
  const descriptionFromTags: string[] = [];

  let currentTag: { name: string; label?: string } | null = null;
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (!currentTag) return;
    const content = buffer.join("\n").trimEnd();
    switch (currentTag.name) {
      case "summary": {
        summaryFromTag = content.trim();
        break;
      }
      case "description": {
        if (content.length > 0) {
          descriptionFromTags.push(content);
        }
        break;
      }
      case "example": {
        if (content.length > 0) {
          const example = parseExampleContent(content);
          const label =
            (currentTag.label ?? "default")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "") || "default";
          example.label = label;
          examples[label] = example;
        }
        break;
      }
      default:
        break;
    }
    buffer = [];
    currentTag = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const tagMatch = trimmed.match(/^@(\w+)(?:\s+(.+))?$/);
    if (tagMatch) {
      flushBuffer();
      const tagName = tagMatch[1].toLowerCase();
      const rest = tagMatch[2]?.trim() ?? "";

      let label: string | undefined;
      let inlineContent: string | undefined;

      if (tagName === "example") {
        if (rest.length > 0) {
          const firstWhitespace = rest.search(/\s/);
          if (firstWhitespace === -1) {
            label = rest;
          } else {
            label = rest.slice(0, firstWhitespace);
            inlineContent = rest.slice(firstWhitespace + 1).trim();
          }
        }
      } else if (rest.length > 0) {
        inlineContent = rest;
      }

      currentTag = {
        name: tagName,
        label,
      };

      if (inlineContent && inlineContent.length > 0) {
        buffer.push(inlineContent);
      }
    } else if (currentTag) {
      buffer.push(line);
    } else {
      preTagLines.push(line);
    }
  }

  flushBuffer();

  const trimEmptyEdges = (rawLines: string[]) => {
    let start = 0;
    let end = rawLines.length;
    while (start < end && rawLines[start].trim().length === 0) start++;
    while (end > start && rawLines[end - 1].trim().length === 0) end--;
    return rawLines.slice(start, end);
  };

  let summary = summaryFromTag;
  const descriptionPieces: string[] = [];

  const firstContentIndex = preTagLines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex !== -1) {
    const firstLine = preTagLines[firstContentIndex].trim();
    if (!summary) {
      summary = firstLine;
    }
    const remainingLines = trimEmptyEdges(preTagLines.slice(firstContentIndex + 1));
    if (remainingLines.length > 0) {
      descriptionPieces.push(remainingLines.join("\n"));
    }
  } else if (!summary && preTagLines.length > 0) {
    const trimmedLines = trimEmptyEdges(preTagLines);
    if (trimmedLines.length > 0) {
      summary = trimmedLines[0].trim();
      const remaining = trimEmptyEdges(trimmedLines.slice(1));
      if (remaining.length > 0) {
        descriptionPieces.push(remaining.join("\n"));
      }
    }
  }

  for (const descriptionBlock of descriptionFromTags) {
    const trimmed = descriptionBlock.trim();
    if (trimmed.length > 0) {
      descriptionPieces.push(trimmed);
    }
  }

  const description = descriptionPieces
    .map((piece) =>
      piece
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim(),
    )
    .filter((piece) => piece.length > 0)
    .join("\n\n");

  return {
    summary: summary?.trim(),
    description: description.length > 0 ? description : undefined,
    examples,
  };
}

function extractDocBlock(source: string, exportName: string): string | null {
  const escapedName = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exportPattern = new RegExp(
    `export\\s+(?:async\\s+)?(?:const|function)\\s+${escapedName}\\b`,
  );
  const exportMatch = exportPattern.exec(source);
  if (!exportMatch) {
    return null;
  }

  const prefix = source.slice(0, exportMatch.index);
  const commentStart = prefix.lastIndexOf("/**");
  if (commentStart === -1) {
    return null;
  }

  const commentEnd = prefix.indexOf("*/", commentStart);
  if (commentEnd === -1) {
    return null;
  }

  return prefix.slice(commentStart + 3, commentEnd);
}

function resolveModulePath(
  currentFile: string,
  moduleSpecifier: string,
): string | null {
  const dirname = path.dirname(currentFile);
  let basePath: string;

  if (moduleSpecifier.startsWith(".")) {
    basePath = path.resolve(dirname, moduleSpecifier);
  } else if (moduleSpecifier.startsWith("@convex/")) {
    const relative = moduleSpecifier.slice("@convex/".length);
    basePath = path.resolve(process.cwd(), "convex", relative);
  } else {
    return null;
  }

  const candidates = new Set<string>();
  const ext = path.extname(basePath);

  if (ext) {
    candidates.add(basePath);
  } else {
    candidates.add(`${basePath}.ts`);
    candidates.add(`${basePath}.tsx`);
    candidates.add(`${basePath}.js`);
    candidates.add(`${basePath}.mjs`);
    candidates.add(`${basePath}.cjs`);
    candidates.add(basePath);
  }

  const indexBase = path.join(basePath, "index");
  candidates.add(`${indexBase}.ts`);
  candidates.add(`${indexBase}.tsx`);
  candidates.add(`${indexBase}.js`);
  candidates.add(`${indexBase}.mjs`);
  candidates.add(`${indexBase}.cjs`);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    }
  }

  return null;
}

function parseReExports(
  source: string,
  filePath: string,
): {
  named: Map<string, { filePath: string; exportName: string }>;
  star: string[];
} {
  const normalizedPath = path.resolve(filePath);
  const cached = reExportCache.get(normalizedPath);
  if (cached) {
    return cached;
  }

  const named = new Map<string, { filePath: string; exportName: string }>();
  const star: string[] = [];

  const namedPattern =
    /export\s*\{\s*([^}]+)\s*\}\s*from\s*["']([^"']+)["']/g;

  let match: RegExpExecArray | null;

  while ((match = namedPattern.exec(source)) !== null) {
    const specifiers = match[1];
    const moduleSpecifier = match[2];
    const targetPath = resolveModulePath(normalizedPath, moduleSpecifier);

    if (!targetPath) continue;

    for (const rawSpecifier of specifiers.split(",")) {
      const specifier = rawSpecifier.trim();
      if (!specifier) continue;

      const aliasMatch = specifier.match(/^(.+?)\s+as\s+(.+)$/i);
      let localName: string;
      let exportedName: string;

      if (aliasMatch) {
        localName = aliasMatch[1].trim();
        exportedName = aliasMatch[2].trim();
      } else {
        localName = specifier;
        exportedName = specifier;
      }

      if (!exportedName) continue;

      named.set(exportedName, {
        filePath: targetPath,
        exportName: localName,
      });
    }
  }

  const starPattern = /export\s*\*\s*from\s*["']([^"']+)["']/g;
  while ((match = starPattern.exec(source)) !== null) {
    const moduleSpecifier = match[1];
    const targetPath = resolveModulePath(normalizedPath, moduleSpecifier);
    if (targetPath) {
      star.push(targetPath);
    }
  }

  const info = { named, star };
  reExportCache.set(normalizedPath, info);
  return info;
}

function internalLoadDocstringInfo(
  filePath: string,
  exportName: string,
  visited: Set<string>,
): ParsedDocstring | null {
  const normalizedPath = path.resolve(filePath);
  const visitKey = `${normalizedPath}::${exportName}`;
  if (visited.has(visitKey)) {
    return null;
  }
  visited.add(visitKey);

  const cacheForFile =
    docCache.get(normalizedPath) ?? new Map<string, ParsedDocstring | null>();
  docCache.set(normalizedPath, cacheForFile);

  if (cacheForFile.has(exportName)) {
    return cacheForFile.get(exportName) ?? null;
  }

  const source = readSourceFile(normalizedPath);
  if (!source) {
    cacheForFile.set(exportName, null);
    return null;
  }

  const docBlock = extractDocBlock(source, exportName);
  if (docBlock) {
    const parsed = parseDocstring(docBlock);
    cacheForFile.set(exportName, parsed);
    return parsed;
  }

  const reExports = parseReExports(source, normalizedPath);

  const namedReExport = reExports.named.get(exportName);
  if (namedReExport) {
    const resolved = internalLoadDocstringInfo(
      namedReExport.filePath,
      namedReExport.exportName,
      visited,
    );
    cacheForFile.set(exportName, resolved ?? null);
    return resolved ?? null;
  }

  for (const modulePath of reExports.star) {
    const resolved = internalLoadDocstringInfo(modulePath, exportName, visited);
    if (resolved) {
      cacheForFile.set(exportName, resolved);
      return resolved;
    }
  }

  cacheForFile.set(exportName, null);
  return null;
}

export function loadDocstringInfo(
  filePath: string,
  exportName: string,
): ParsedDocstring | null {
  return internalLoadDocstringInfo(filePath, exportName, new Set());
}
