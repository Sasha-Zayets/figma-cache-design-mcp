import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FigmaClient } from "./figma-client.js";
import {
  formatAssetsReport,
  formatBlockSection,
  formatCacheSection,
  formatCachedList,
  formatCleanCacheSummary,
  formatOutlineSection,
} from "./formatter.js";
import {
  CacheDesignInput,
  GetAssetsInput,
  ListCacheInput,
  ViewportLinksInput,
} from "./types.js";
import { extractViewportEntries } from "./url-parser.js";

const viewportLinksSchemaShape = {
  desktop: z
    .string()
    .optional()
    .describe("Figma link to the desktop version (page or block) with node-id"),
  mobile: z
    .string()
    .optional()
    .describe("Figma link to the mobile version (page or block) with node-id"),
  url: z
    .string()
    .optional()
    .describe("Single Figma link with node-id without a specific viewport label"),
  urls: z
    .array(z.string())
    .optional()
    .describe(
      "Multiple Figma links with node-id (whole pages, sections, or individual blocks)"
    ),
  refresh: z
    .boolean()
    .optional()
    .default(false)
    .describe("Force refresh from Figma API instead of reading from local cache"),
};

const cacheDesignSchemaShape = {
  ...viewportLinksSchemaShape,
  includeAssets: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, also downloads and caches all raster images and SVG icons found in the design so subsequent get_assets calls require 0 Figma API requests"
    ),
};

const getAssetsSchemaShape = {
  ...viewportLinksSchemaShape,
  outputDir: z
    .string()
    .optional()
    .describe(
      "Optional directory path (relative to project root or absolute) to copy the extracted assets into with clean filenames"
    ),
  types: z
    .enum(["all", "images", "icons"])
    .optional()
    .default("all")
    .describe(
      "Filter asset types to extract: 'all' (raster images + SVG icons), 'images' (raster IMAGE fills only), or 'icons' (SVG vector icons only)"
    ),
};

const listCacheSchemaShape = {
  fileKey: z
    .string()
    .optional()
    .describe("Optional Figma fileKey to filter cached items"),
};

const cleanCacheSchemaShape = {
  fileKey: z
    .string()
    .optional()
    .describe("Optional Figma fileKey to clean cache for"),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, forcefully removes cached files regardless of TTL expiration"
    ),
};

/**
 * Core handler for cache_design tool.
 * Downloads designs (whole pages or individual blocks/parts) and stores them in local cache.
 */
export async function handleCacheDesign(
  input: CacheDesignInput,
  client: FigmaClient
): Promise<string> {
  const entries = extractViewportEntries(input);
  const sections: string[] = [];
  const resolvedItems: Array<{ fileKey: string; document: import("./types.js").FigmaNode }> = [];

  for (const entry of entries) {
    const resolved = await client.resolveNode(
      entry.parsed.fileKey,
      entry.parsed.nodeId,
      Boolean(input.refresh),
      {
        originalUrl: entry.rawUrl,
        label: entry.label,
      }
    );
    resolvedItems.push({
      fileKey: entry.parsed.fileKey,
      document: resolved.document,
    });
    sections.push(formatCacheSection(entry, resolved));
  }

  if (input.includeAssets && resolvedItems.length > 0) {
    const assets = await client.fetchAssetsForNodes(resolvedItems, {
      types: "all",
      refresh: Boolean(input.refresh),
    });
    sections.push(formatAssetsReport(assets, { types: "all" }));
  }

  return sections.join("\n\n---\n\n");
}

/**
 * Core handler for get_assets tool.
 * Extracts raster images and SVG icons from one or more Figma links (single asset, block, or whole page),
 * using local disk cache first and minimizing Figma API calls.
 */
export async function handleGetAssets(
  input: GetAssetsInput,
  client: FigmaClient
): Promise<string> {
  const entries = extractViewportEntries(input);
  const resolvedItems: Array<{ fileKey: string; document: import("./types.js").FigmaNode }> = [];

  for (const entry of entries) {
    const resolved = await client.resolveNode(
      entry.parsed.fileKey,
      entry.parsed.nodeId,
      Boolean(input.refresh),
      {
        originalUrl: entry.rawUrl,
        label: entry.label,
      }
    );
    resolvedItems.push({
      fileKey: entry.parsed.fileKey,
      document: resolved.document,
    });
  }

  const assets = await client.fetchAssetsForNodes(resolvedItems, {
    types: input.types ?? "all",
    outputDir: input.outputDir,
    refresh: Boolean(input.refresh),
  });

  return formatAssetsReport(assets, {
    outputDir: input.outputDir,
    types: input.types ?? "all",
  });
}

/**
 * Core handler for list_cache tool.
 */
export async function handleListCache(
  input: ListCacheInput,
  client: FigmaClient
): Promise<string> {
  const envelopes = await client.listCached(input.fileKey);
  return formatCachedList(envelopes);
}

/**
 * Core handler for clean_cache tool.
 */
export async function handleCleanCache(
  input: { fileKey?: string; force?: boolean },
  client: FigmaClient
): Promise<string> {
  const result = await client.cleanCache(input);
  return formatCleanCacheSummary(result, { force: input.force });
}

/**
 * Core handler for get_outline tool.
 */
export async function handleGetOutline(
  input: ViewportLinksInput,
  client: FigmaClient
): Promise<string> {
  const entries = extractViewportEntries(input);
  const sections: string[] = [];

  for (const entry of entries) {
    const resolved = await client.resolveNode(
      entry.parsed.fileKey,
      entry.parsed.nodeId,
      Boolean(input.refresh),
      {
        originalUrl: entry.rawUrl,
        label: entry.label,
      }
    );
    sections.push(formatOutlineSection(entry, resolved));
  }

  return sections.join("\n\n---\n\n");
}

/**
 * Core handler for get_block tool.
 */
export async function handleGetBlock(
  input: ViewportLinksInput,
  client: FigmaClient
): Promise<string> {
  const entries = extractViewportEntries(input);
  const sections: string[] = [];

  for (const entry of entries) {
    const resolved = await client.resolveNode(
      entry.parsed.fileKey,
      entry.parsed.nodeId,
      Boolean(input.refresh),
      {
        originalUrl: entry.rawUrl,
        label: entry.label,
      }
    );
    sections.push(formatBlockSection(entry, resolved));
  }

  return sections.join("\n\n---\n\n");
}

/**
 * Creates and configures the MCP server instance for figma-cache-design-mcp.
 */
export function createFigmaBlockServer(client = new FigmaClient()): McpServer {
  const server = new McpServer({
    name: "figma-cache-design-mcp",
    version: "1.0.0",
  });

  server.tool(
    "cache_design",
    "Downloads one or more Figma designs (whole pages, sections, or individual blocks/parts) and stores them in the local MCP disk cache so that get_outline, get_block, and get_assets can work with them (and any nested child blocks) later without calling the Figma API. Set includeAssets=true to also pre-cache all raster images and SVG icons. Provide at least one of: desktop, mobile, url, or urls.",
    cacheDesignSchemaShape,
    async (args) => {
      try {
        const output = await handleCacheDesign(args, client);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    }
  );

  server.tool(
    "list_cache",
    "Lists all Figma designs (pages, sections, and blocks) currently stored in the local MCP disk cache along with their node IDs, dimensions, and ready-to-use URLs for get_outline and get_block.",
    listCacheSchemaShape,
    async (args) => {
      try {
        const output = await handleListCache(args, client);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    }
  );

  server.tool(
    "clean_cache",
    "Cleans up expired Figma designs from disk cache based on configured TTL (or forcefully deletes all cached files when force=true).",
    cleanCacheSchemaShape,
    async (args) => {
      try {
        const output = await handleCleanCache(args, client);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    }
  );

  server.tool(
    "get_outline",
    "Downloads a page (or container frame) from Figma into local cache and returns a compact outline of top-level frames/blocks with names, IDs, dimensions, and ready-to-use links. Provide at least one of: desktop, mobile, url, or urls.",
    viewportLinksSchemaShape,
    async (args) => {
      try {
        const output = await handleGetOutline(args, client);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    }
  );

  server.tool(
    "get_block",
    "Returns a compact CSS-like description and aggregated design tokens for a block (or both desktop and mobile versions). Checks local disk cache first (including previously cached parent pages or sections) and calls Figma API only on cache miss or when refresh=true. Provide at least one of: desktop, mobile, url, or urls.",
    viewportLinksSchemaShape,
    async (args) => {
      try {
        const output = await handleGetBlock(args, client);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    }
  );

  server.tool(
    "get_assets",
    "Extracts raster images and/or SVG icons from one or more Figma links (a single image/icon node, a block containing assets, or an entire page). Uses the local JSON and asset disk cache first (0 Figma API calls when cached), deduplicates by imageRef/componentId, and batches any missing downloads into minimal Figma API calls. Optionally copies files to outputDir with clean filenames.",
    getAssetsSchemaShape,
    async (args) => {
      try {
        const output = await handleGetAssets(args, client);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    }
  );

  return server;
}
