import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FigmaClient } from "./figma-client.js";
import {
  formatBlockSection,
  formatCacheSection,
  formatCachedList,
  formatCleanCacheSummary,
  formatOutlineSection,
} from "./formatter.js";
import { ListCacheInput, ViewportLinksInput } from "./types.js";
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
    sections.push(formatCacheSection(entry, resolved));
  }

  return sections.join("\n\n---\n\n");
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
    "Downloads one or more Figma designs (whole pages, sections, or individual blocks/parts) and stores them in the local MCP disk cache so that get_outline and get_block can work with them (and any nested child blocks) later without calling the Figma API. Provide at least one of: desktop, mobile, url, or urls.",
    viewportLinksSchemaShape,
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

  return server;
}
