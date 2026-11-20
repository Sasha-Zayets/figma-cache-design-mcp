import fs from "node:fs/promises";
import path from "node:path";
import {
  buildCleanAssetFilename,
  detectImageExtension,
  discoverAssets,
} from "./assets.js";
import { CacheManager } from "./cache.js";
import {
  AssetTypesFilter,
  CacheMetadata,
  CachedNodeEnvelope,
  DiscoveredAsset,
  FigmaFileImagesApiResponse,
  FigmaNode,
  FigmaNodesApiResponse,
  FigmaRenderImagesApiResponse,
  ResolvedAssetResult,
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

    const url = `https://api.figma.com/v1/files/${encodeURIComponent(
      fileKey
    )}/nodes?ids=${encodeURIComponent(nodeId)}`;

    const data = await this.fetchFigmaJson<FigmaNodesApiResponse>(
      url,
      fileKey,
      `node "${nodeId}"`
    );

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

  /**
   * Executes a GET request against the Figma REST API with automatic 429 retry/backoff.
   */
  private async fetchFigmaJson<T>(
    url: string,
    fileKey: string,
    contextLabel: string
  ): Promise<T> {
    const token = this.getToken();

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
          `[figma-cache-design-mcp] Figma API rate limit (429) hit for ${contextLabel} in file "${fileKey}". Retrying in ${(
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

    return (await response.json()) as T;
  }

  /**
   * Downloads a binary file from an S3/CDN URL (does not consume Figma API rate limits).
   */
  private async downloadBinary(
    downloadUrl: string
  ): Promise<{ buffer: Buffer; contentType: string | null }> {
    const res = await this.fetchImpl(downloadUrl, { method: "GET" });
    if (!res.ok) {
      throw new FigmaApiError(
        `Failed to download asset from CDN (${res.status} ${res.statusText})`,
        res.status
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: res.headers.get("content-type"),
    };
  }

  /**
   * Runs async tasks with bounded concurrency.
   */
  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    let index = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (index < items.length) {
          const current = items[index++];
          await worker(current);
        }
      }
    );
    await Promise.all(workers);
  }

  /**
   * Extracts, caches, and optionally copies assets (raster images & SVG icons)
   * from one or more resolved FigmaNode trees with minimal Figma API calls:
   * - 0 API calls for assets already in local disk cache.
   * - 1 API call per fileKey for all missing raster images (/v1/files/:fileKey/images).
   * - 1 batched API call per 50 missing SVG icons (/v1/images/:fileKey?format=svg).
   */
  public async fetchAssetsForNodes(
    items: Array<{ fileKey: string; document: FigmaNode }>,
    options: {
      types?: AssetTypesFilter;
      outputDir?: string;
      refresh?: boolean;
    } = {}
  ): Promise<ResolvedAssetResult[]> {
    const types = options.types ?? "all";
    const refresh = Boolean(options.refresh);

    // Group deduplicated discovered assets by fileKey
    const byFileKey = new Map<string, Map<string, DiscoveredAsset>>();
    for (const item of items) {
      const found = discoverAssets(item.document, types);
      let fileMap = byFileKey.get(item.fileKey);
      if (!fileMap) {
        fileMap = new Map();
        byFileKey.set(item.fileKey, fileMap);
      }
      for (const asset of found) {
        if (!fileMap.has(asset.dedupeKey)) {
          fileMap.set(asset.dedupeKey, asset);
        }
      }
    }

    const results: ResolvedAssetResult[] = [];

    for (const [fileKey, assetMap] of byFileKey.entries()) {
      const allAssets = Array.from(assetMap.values());
      const missingImages: DiscoveredAsset[] = [];
      const missingSvgs: DiscoveredAsset[] = [];

      // 1. Check local disk cache first
      for (const asset of allAssets) {
        const cacheKey =
          asset.kind === "image"
            ? asset.imageRef!
            : asset.componentId
              ? `comp_${asset.componentId}`
              : asset.nodeId;

        if (!refresh) {
          const cached = await this.cache.getCachedAsset(
            fileKey,
            asset.kind,
            cacheKey
          );
          if (cached) {
            results.push({
              asset,
              fileKey,
              cachePath: cached.path,
              source: "cache",
              sizeBytes: cached.sizeBytes,
              extension: cached.extension,
            });
            continue;
          }
        }

        if (asset.kind === "image") {
          missingImages.push(asset);
        } else {
          missingSvgs.push(asset);
        }
      }

      // 2. Fetch missing raster images (1 Figma API call for the entire fileKey)
      if (missingImages.length > 0) {
        console.error(
          `[figma-cache-design-mcp] Fetching raster image URLs for ${missingImages.length} uncached image(s) in file "${fileKey}" (1 API call)...`
        );
        const imagesUrl = `https://api.figma.com/v1/files/${encodeURIComponent(
          fileKey
        )}/images`;
        const resp = await this.fetchFigmaJson<FigmaFileImagesApiResponse>(
          imagesUrl,
          fileKey,
          "file images"
        );
        const refMap = resp.meta?.images ?? {};

        await this.runWithConcurrency(missingImages, 6, async (asset) => {
          const ref = asset.imageRef!;
          const s3Url = refMap[ref];
          if (!s3Url) {
            results.push({
              asset,
              fileKey,
              cachePath: "",
              source: "figma-api",
              sizeBytes: 0,
              extension: "png",
              error: `Image ref "${ref}" not found in Figma file images response`,
            });
            return;
          }

          try {
            const { buffer, contentType } = await this.downloadBinary(s3Url);
            const ext = detectImageExtension(buffer, contentType, s3Url);
            const saved = await this.cache.saveCachedAsset(
              fileKey,
              "image",
              ref,
              buffer,
              ext
            );
            results.push({
              asset,
              fileKey,
              cachePath: saved.path,
              source: "figma-api",
              sizeBytes: saved.sizeBytes,
              extension: saved.extension,
            });
          } catch (err) {
            results.push({
              asset,
              fileKey,
              cachePath: "",
              source: "figma-api",
              sizeBytes: 0,
              extension: "png",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
      }

      // 3. Fetch missing SVG icons (1 batched Figma API call per 50 icons)
      if (missingSvgs.length > 0) {
        const CHUNK_SIZE = 50;
        for (let i = 0; i < missingSvgs.length; i += CHUNK_SIZE) {
          const chunk = missingSvgs.slice(i, i + CHUNK_SIZE);
          const idsParam = chunk.map((a) => a.nodeId).join(",");
          console.error(
            `[figma-cache-design-mcp] Rendering ${chunk.length} uncached SVG icon(s) in file "${fileKey}" (1 batched API call)...`
          );
          const renderUrl = `https://api.figma.com/v1/images/${encodeURIComponent(
            fileKey
          )}?ids=${encodeURIComponent(idsParam)}&format=svg`;
          const resp = await this.fetchFigmaJson<FigmaRenderImagesApiResponse>(
            renderUrl,
            fileKey,
            `SVG batch (${chunk.length} icons)`
          );
          const urlMap = resp.images ?? {};

          await this.runWithConcurrency(chunk, 6, async (asset) => {
            const s3Url = urlMap[asset.nodeId];
            if (!s3Url) {
              results.push({
                asset,
                fileKey,
                cachePath: "",
                source: "figma-api",
                sizeBytes: 0,
                extension: "svg",
                error: `Figma did not return an SVG URL for node "${asset.nodeId}"`,
              });
              return;
            }

            try {
              const { buffer } = await this.downloadBinary(s3Url);
              const cacheKey = asset.componentId
                ? `comp_${asset.componentId}`
                : asset.nodeId;
              const saved = await this.cache.saveCachedAsset(
                fileKey,
                "svg",
                cacheKey,
                buffer,
                "svg"
              );
              results.push({
                asset,
                fileKey,
                cachePath: saved.path,
                source: "figma-api",
                sizeBytes: saved.sizeBytes,
                extension: "svg",
              });
            } catch (err) {
              results.push({
                asset,
                fileKey,
                cachePath: "",
                source: "figma-api",
                sizeBytes: 0,
                extension: "svg",
                error: err instanceof Error ? err.message : String(err),
              });
            }
          });
        }
      }
    }

    // 4. Optionally copy assets into user's outputDir with clean filenames
    if (options.outputDir && options.outputDir.trim()) {
      const projectRoot =
        process.env.FIGMA_PROJECT_ROOT?.trim() ||
        process.env.PROJECT_ROOT?.trim() ||
        process.env.WORKSPACE_FOLDER?.trim() ||
        process.cwd();
      const rawOut = options.outputDir.trim();
      const resolvedOutDir = path.isAbsolute(rawOut)
        ? path.normalize(rawOut)
        : path.resolve(projectRoot, rawOut);

      await fs.mkdir(resolvedOutDir, { recursive: true });
      const usedNames = new Set<string>();

      for (const item of results) {
        if (item.error || !item.cachePath) continue;
        const filename = buildCleanAssetFilename(
          item.asset.name,
          item.asset.nodeId,
          item.extension,
          usedNames
        );
        const destPath = path.join(resolvedOutDir, filename);
        await fs.copyFile(item.cachePath, destPath);
        item.outputPath = destPath;
      }
    }

    return results;
  }
}
