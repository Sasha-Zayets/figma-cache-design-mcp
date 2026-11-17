import { ParsedFigmaUrl, ViewportEntry, ViewportLinksInput } from "./types.js";

export class FigmaUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FigmaUrlError";
  }
}

/**
 * Normalizes a Figma node-id query value (e.g., "123-456" or "123%3A456" -> "123:456").
 */
export function normalizeNodeId(rawNodeId: string): string {
  const decoded = decodeURIComponent(rawNodeId.trim());
  if (!decoded) {
    throw new FigmaUrlError(
      "The node-id parameter is empty. Please select a page or block in Figma and copy the link via 'Copy link to selection'."
    );
  }
  return decoded.replace(/-/g, ":");
}

/**
 * Parses a Figma URL into { fileKey, nodeId, originalUrl }.
 * - Supports /design/<fileKey>/... and /file/<fileKey>/...
 * - Supports branch URLs (/design/<fileKey>/branch/<branchKey>/... or /file/<fileKey>/branch/<branchKey>/...)
 *   by selecting <branchKey> as fileKey.
 * - Requires node-id query parameter and normalizes it ("123-456" -> "123:456").
 */
export function parseFigmaUrl(rawUrl: string): ParsedFigmaUrl {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new FigmaUrlError("Empty Figma URL provided.");
  }

  let urlObj: URL;
  try {
    urlObj = new URL(trimmed);
  } catch {
    throw new FigmaUrlError(
      `Invalid URL: "${rawUrl}". Expected a full Figma link (e.g., https://www.figma.com/design/<fileKey>/...?node-id=123-456).`
    );
  }

  const pathname = urlObj.pathname;

  // 1. Check for branch key first: /branch/<branchKey>
  const branchMatch = pathname.match(/\/branch\/([a-zA-Z0-9_-]+)/);
  // 2. Otherwise match /design/<fileKey> or /file/<fileKey>
  const fileMatch = pathname.match(/\/(?:design|file)\/([a-zA-Z0-9_-]+)/);

  const fileKey = branchMatch?.[1] ?? fileMatch?.[1];

  if (!fileKey) {
    throw new FigmaUrlError(
      `Could not extract fileKey from URL "${rawUrl}". Ensure the path contains /design/<fileKey> or /file/<fileKey>.`
    );
  }

  const rawNodeId = urlObj.searchParams.get("node-id");
  if (!rawNodeId || !rawNodeId.trim()) {
    throw new FigmaUrlError(
      `The URL "${rawUrl}" is missing the 'node-id' parameter (it points to the entire file). Please select a specific page or block in Figma and copy the link via "Copy link to selection" (Cmd+L / Ctrl+L).`
    );
  }

  const nodeId = normalizeNodeId(rawNodeId);

  return {
    originalUrl: trimmed,
    fileKey,
    nodeId,
  };
}

/**
 * Builds a Figma URL pointing to a specific nodeId based on an existing parsed URL.
 */
export function buildNodeUrl(parsed: ParsedFigmaUrl, targetNodeId: string): string {
  try {
    const urlObj = new URL(parsed.originalUrl);
    urlObj.searchParams.set("node-id", targetNodeId.replace(/:/g, "-"));
    return urlObj.toString();
  } catch {
    return `https://www.figma.com/design/${parsed.fileKey}?node-id=${targetNodeId.replace(/:/g, "-")}`;
  }
}

/**
 * Extracts and validates viewport link entries from tool arguments.
 * Requires at least one of desktop, mobile, url, or urls.
 */
export function extractViewportEntries(input: ViewportLinksInput): ViewportEntry[] {
  const entries: ViewportEntry[] = [];

  if (input.desktop && input.desktop.trim()) {
    entries.push({
      label: "desktop",
      rawUrl: input.desktop.trim(),
      parsed: parseFigmaUrl(input.desktop),
    });
  }

  if (input.mobile && input.mobile.trim()) {
    entries.push({
      label: "mobile",
      rawUrl: input.mobile.trim(),
      parsed: parseFigmaUrl(input.mobile),
    });
  }

  if (input.url && input.url.trim()) {
    entries.push({
      label: "default",
      rawUrl: input.url.trim(),
      parsed: parseFigmaUrl(input.url),
    });
  }

  if (Array.isArray(input.urls)) {
    for (const raw of input.urls) {
      if (raw && raw.trim()) {
        entries.push({
          label: "default",
          rawUrl: raw.trim(),
          parsed: parseFigmaUrl(raw),
        });
      }
    }
  }

  if (entries.length === 0) {
    throw new FigmaUrlError(
      "At least one link parameter is required: 'desktop', 'mobile', 'url', or 'urls'."
    );
  }

  return entries;
}

/**
 * Parses CLI arguments for the `cache` subcommand into ViewportLinksInput.
 */
export function parseCacheCliArgs(argv: string[]): ViewportLinksInput {
  const input: ViewportLinksInput = {
    urls: [],
    refresh: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--refresh" || arg === "-r") {
      input.refresh = true;
    } else if (arg === "--desktop" && argv[i + 1]) {
      input.desktop = argv[++i];
    } else if (arg.startsWith("--desktop=")) {
      input.desktop = arg.slice("--desktop=".length);
    } else if (arg === "--mobile" && argv[i + 1]) {
      input.mobile = argv[++i];
    } else if (arg.startsWith("--mobile=")) {
      input.mobile = arg.slice("--mobile=".length);
    } else if (arg === "--url" && argv[i + 1]) {
      input.url = argv[++i];
    } else if (arg.startsWith("--url=")) {
      input.url = arg.slice("--url=".length);
    } else if (!arg.startsWith("-")) {
      input.urls!.push(arg);
    }
  }

  return input;
}
