import { CacheManager } from "./cache.js";
import {
  CacheMetadata,
  CachedNodeEnvelope,
  FigmaNodesApiResponse,
  ResolvedNodeResult,
} from "./types.js";

export class FigmaApiError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "FigmaApiError";
    this.statusCode = statusCode;
  }
}

export interface FigmaClientOptions {
  cacheManager?: CacheManager;
  token?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

export class FigmaClient {
  private readonly cache: CacheManager;
  private readonly customToken?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: FigmaClientOptions = {}) {
    this.cache = options.cacheManager ?? new CacheManager();
    this.customToken = options.token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 2000;
    this.maxDelayMs = options.maxDelayMs ?? 60000;
    this.sleepImpl =
      options.sleepImpl ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private getToken(): string {
    const token = this.customToken ?? process.env.FIGMA_TOKEN;
    if (!token || !token.trim()) {
      throw new FigmaApiError(
        "The FIGMA_TOKEN environment variable is not set. Please set FIGMA_TOKEN to fetch data from the Figma API."
      );
    }
    return token.trim();
  }

  public getCacheManager(): CacheManager {
    return this.cache;
  }

  public async listCached(fileKey?: string): Promise<CachedNodeEnvelope[]> {
    return this.cache.list(fileKey);
  }

  public async cleanCache(options?: {
    fileKey?: string;
    force?: boolean;
    now?: number;
  }) {
    return this.cache.cleanCache(options);
  }

  /**
   * Resolves a Figma node by (fileKey, nodeId).
   * - Cache-first unless refresh === true.
   * - Searches both direct node cache and cached parent subtrees (e.g., pages).
   * - Calls Figma REST API only on cache miss or explicit refresh.
   */
  public async resolveNode(
    fileKey: string,
    nodeId: string,
    refresh = false,
    metadata?: CacheMetadata
  ): Promise<ResolvedNodeResult> {
    if (!refresh) {
      const cached = await this.cache.get(fileKey, nodeId);
      if (cached) {
        if (cached.source === "cache-direct") {
          console.error(
            `[figma-cache-design-mcp] Cache HIT (direct): node "${nodeId}" found in disk cache (${fileKey})`
          );
        } else {
          console.error(
            `[figma-cache-design-mcp] Cache HIT (subtree): node "${nodeId}" extracted from cached parent "${cached.parentNodeId}" (${fileKey})`
          );
        }
        return cached;
      }

      const existingCachedNodes = await this.cache.getCachedNodeIds(fileKey);
      if (existingCachedNodes.length > 0) {
        console.error(
          `[figma-cache-design-mcp] Cache MISS: node "${nodeId}" was NOT found inside locally cached nodes [${existingCachedNodes.join(
            ", "
          )}] for file "${fileKey}". Making live Figma API request...`
        );
      } else {
        console.error(
          `[figma-cache-design-mcp] Cache MISS: no local cache found for file "${fileKey}". Making live Figma API request for node "${nodeId}"...`
        );
      }
    } else {
      console.error(
        `[figma-cache-design-mcp] Refresh forced (refresh=true): bypassing cache and requesting Figma API for node "${nodeId}" (${fileKey})...`
      );
    }

    const token = this.getToken();
    const url = `https://api.figma.com/v1/files/${encodeURIComponent(
      fileKey
    )}/nodes?ids=${encodeURIComponent(nodeId)}`;

    let response: Response | undefined;
    let attempts = 0;

    while (attempts <= this.maxRetries) {
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            "X-Figma-Token": token,
            Accept: "application/json",
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new FigmaApiError(
          `Network error while requesting Figma API: ${msg}`
        );
      }

      if (response.status === 429 && attempts < this.maxRetries) {
        const retryAfterHeader = response.headers.get("retry-after");
        let delayMs = Math.min(
          this.baseDelayMs * Math.pow(2, attempts) + Math.floor(Math.random() * 300),
          this.maxDelayMs
        );

        if (retryAfterHeader) {
          const parsedSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
            delayMs = Math.min(parsedSeconds * 1000, this.maxDelayMs);
          }
        }

        console.error(
          `[figma-cache-design-mcp] Figma API rate limit (429) hit for node "${nodeId}" in file "${fileKey}". Retrying in ${(
            delayMs / 1000
          ).toFixed(1)}s (attempt ${attempts + 1}/${this.maxRetries})...`
        );

        await this.sleepImpl(delayMs);
        attempts++;
        continue;
      }

      break;
    }

    if (!response || !response.ok) {
      const status = response?.status ?? 500;
      const retryAfter = response?.headers.get("retry-after");
      let errorDetail = "";
      try {
        const errBody = (await response?.json()) as { err?: string; message?: string };
        errorDetail = errBody?.err || errBody?.message || "";
      } catch {
        // ignore JSON parse failure on error body
      }

      if (status === 401 || status === 403) {
        throw new FigmaApiError(
          `Figma API access denied (${status}): verify FIGMA_TOKEN and permissions for file "${fileKey}". ${errorDetail}`.trim(),
          status
        );
      }
      if (status === 404) {
        throw new FigmaApiError(
          `File or branch "${fileKey}" not found in Figma (404). ${errorDetail}`.trim(),
          404
        );
      }
      if (status === 429) {
        const retryMsg = retryAfter ? ` Retry after ${retryAfter}s.` : "";
        throw new FigmaApiError(
          `Figma API rate limit exceeded (429 Too Many Requests) after ${attempts} retries.${retryMsg} Tip: cache the whole page (node-id=0:1) with cache_design to avoid live API calls. ${errorDetail}`.trim(),
          429
        );
      }

      throw new FigmaApiError(
        `Figma API error (${status} ${response?.statusText ?? ""}): ${errorDetail}`.trim(),
        status
      );
    }

    const data = (await response.json()) as FigmaNodesApiResponse;
    const nodeEntry =
      data.nodes?.[nodeId] ??
      data.nodes?.[decodeURIComponent(nodeId)] ??
      Object.values(data.nodes ?? {})[0];

    if (!nodeEntry || !nodeEntry.document) {
      throw new FigmaApiError(
        `Node "${nodeId}" was not found in file "${fileKey}". Please check the node-id parameter in the URL.`
      );
    }

    const envelope = await this.cache.set(
      fileKey,
      nodeEntry.document.id || nodeId,
      nodeEntry.document,
      data.name,
      metadata
    );

    console.error(
      `[figma-cache-design-mcp] Successfully fetched and cached node "${nodeEntry.document.id || nodeId}" ("${
        nodeEntry.document.name
      }", type: ${nodeEntry.document.type}) to disk.`
    );

    return {
      document: nodeEntry.document,
      source: "figma-api",
      fetchedAt: envelope.fetchedAt,
      ...(data.name ? { fileName: data.name } : {}),
    };
  }
}
