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
      currentTag = {
        name: tagMatch[1].toLowerCase(),
        label: tagMatch[2]?.trim(),
      };
    } else if (currentTag) {
      buffer.push(line);
    } else {
      preTagLines.push(line);
    }
  }

  flushBuffer();

  const descriptionPieces: string[] = [];

  const firstContentIndex = preTagLines.findIndex((line) => line.trim().length > 0);
  let summary = summaryFromTag;

  if (firstContentIndex !== -1) {
    const firstLine = preTagLines[firstContentIndex].trim();
    if (!summary) {
      summary = firstLine;
    }
    const remainingLines = preTagLines.slice(firstContentIndex + 1);
    if (remainingLines.length > 0) {
      descriptionPieces.push(remainingLines.join("\n"));
    }
  }

  if (!summary && preTagLines.length > 0) {
    summary = preTagLines.join("\n").trim();
  }

  if (summaryFromTag && !descriptionPieces.includes(summaryFromTag)) {
    descriptionPieces.unshift(summaryFromTag);
  }

  if (descriptionFromTags.length > 0) {
    descriptionPieces.push(...descriptionFromTags);
  }

  const description = descriptionPieces
    .map((piece) => piece.trimEnd())
    .join("\n")
    .trim();

  return {
    summary: summary?.trim(),
    description: description.length > 0 ? description : summary?.trim(),
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

export function loadDocstringInfo(
  filePath: string,
  exportName: string,
): ParsedDocstring | null {
  const normalizedPath = path.resolve(filePath);
  const cacheForFile = docCache.get(normalizedPath) ?? new Map<string, ParsedDocstring | null>();
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
  if (!docBlock) {
    cacheForFile.set(exportName, null);
    return null;
  }

  const parsed = parseDocstring(docBlock);
  cacheForFile.set(exportName, parsed);
  return parsed;
}
