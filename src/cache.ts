import fs from "node:fs/promises";
import path from "node:path";
import {
  CacheManagerConfig,
  CacheMetadata,
  CacheTtlConfig,
  CachedNodeEnvelope,
  CleanCacheResult,
  FigmaNode,
  ResolvedNodeResult,
  TtlUnit,
} from "./types.js";

export class CacheConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheConfigError";
  }
}

/**
 * Parses a TTL configuration from an object, string ("30d", "12h"), or JSON string.
 */
export function parseTtlConfig(input: unknown): CacheTtlConfig | undefined {
  if (!input) return undefined;

  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    const val = Number(obj.value);
    const unit = String(obj.unit ?? "").trim().toLowerCase();
    if (
      !isNaN(val) &&
      val > 0 &&
      (unit === "s" || unit === "m" || unit === "h" || unit === "d")
    ) {
      return { value: val, unit: unit as TtlUnit };
    }
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return parseTtlConfig(parsed);
      } catch {
        // fall through to string regex
      }
    }
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
    if (match) {
      const val = parseFloat(match[1]);
      const unit = match[2].toLowerCase() as TtlUnit;
      if (val > 0) {
        return { value: val, unit };
      }
    }
  }

  return undefined;
}

/**
 * Converts a CacheTtlConfig to milliseconds.
 */
export function ttlToMs(ttl: CacheTtlConfig): number {
  const multipliers: Record<TtlUnit, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return ttl.value * multipliers[ttl.unit];
}

/**
 * Recursively searches a FigmaNode tree for a descendant with the matching id.
 */
export function findNodeInTree(root: FigmaNode, targetId: string): FigmaNode | null {
  if (root.id === targetId) {
    return root;
  }
  if (root.children && Array.isArray(root.children)) {
    for (const child of root.children) {
      const found = findNodeInTree(child, targetId);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

export class CacheManager {
  private readonly baseDir: string;
  private readonly autoCleanup: boolean;
  private readonly ttl?: CacheTtlConfig;
  private readonly ttlMs?: number;

  constructor(config?: string | CacheManagerConfig) {
    let customDir: string | undefined;
    let autoCleanupSetting: boolean | undefined;
    let ttlSetting: CacheTtlConfig | undefined;

    if (typeof config === "string") {
      customDir = config;
    } else if (config && typeof config === "object") {
      customDir = config.cacheDir;
      autoCleanupSetting = config.autoCleanup;
      ttlSetting = config.ttl ? parseTtlConfig(config.ttl) : undefined;
    }

    const rawDir =
      (customDir && customDir.trim()) ||
      (process.env.FIGMA_CACHE_DIR && process.env.FIGMA_CACHE_DIR.trim());

    if (!rawDir) {
      throw new CacheConfigError(
        "The FIGMA_CACHE_DIR environment variable is not set. Please set FIGMA_CACHE_DIR to specify the directory path for the disk cache."
      );
    }

    this.baseDir = path.resolve(rawDir);

    // autoCleanup: defaults to false (files kept forever unless configured)
    if (autoCleanupSetting !== undefined) {
      this.autoCleanup = autoCleanupSetting;
    } else if (process.env.FIGMA_CACHE_AUTO_CLEANUP !== undefined) {
      const envVal = process.env.FIGMA_CACHE_AUTO_CLEANUP.trim().toLowerCase();
      this.autoCleanup = envVal === "true" || envVal === "1";
    } else {
      this.autoCleanup = false;
    }

    // ttl: defaults to undefined (no expiration / stored forever)
    if (ttlSetting !== undefined) {
      this.ttl = ttlSetting;
    } else if (process.env.FIGMA_CACHE_TTL !== undefined) {
      this.ttl = parseTtlConfig(process.env.FIGMA_CACHE_TTL);
    } else {
      this.ttl = undefined;
    }

    this.ttlMs = this.ttl ? ttlToMs(this.ttl) : undefined;
  }

  public getCacheDir(): string {
    return this.baseDir;
  }

  public getAutoCleanup(): boolean {
    return this.autoCleanup;
  }

  public getTtl(): CacheTtlConfig | undefined {
    return this.ttl;
  }

  /**
   * Checks whether a cached envelope has exceeded the configured TTL.
   */
  public isExpired(envelope: CachedNodeEnvelope, now = Date.now()): boolean {
    if (!this.ttlMs) return false;
    const fetchedTime = new Date(envelope.fetchedAt).getTime();
    if (isNaN(fetchedTime)) return false;
    return now - fetchedTime > this.ttlMs;
  }

  private sanitizeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private getFileDir(fileKey: string): string {
    return path.join(this.baseDir, this.sanitizeSegment(fileKey));
  }

  private getNodeFilePath(fileKey: string, nodeId: string): string {
    return path.join(
      this.getFileDir(fileKey),
      `${this.sanitizeSegment(nodeId)}.json`
    );
  }

  private async readEnvelope(filePath: string): Promise<CachedNodeEnvelope | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as CachedNodeEnvelope;
      if (parsed && parsed.document && typeof parsed.document.id === "string") {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Removes all expired cache files across all directories.
   */
  public async cleanupExpired(now = Date.now()): Promise<CleanCacheResult> {
    const result: CleanCacheResult = {
      deletedCount: 0,
      deletedFiles: [],
    };

    if (!this.ttlMs) {
      return result;
    }

    let dirEntries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      dirEntries = await fs.readdir(this.baseDir, { withFileTypes: true });
    } catch {
      return result;
    }

    for (const d of dirEntries) {
      if (!d.isDirectory()) continue;
      const fileDir = path.join(this.baseDir, d.name);
      let files: string[] = [];
      try {
        files = await fs.readdir(fileDir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const fullPath = path.join(fileDir, file);
        const envelope = await this.readEnvelope(fullPath);
        if (!envelope) continue;

        if (this.isExpired(envelope, now)) {
          try {
            await fs.unlink(fullPath);
            result.deletedCount++;
            result.deletedFiles.push(fullPath);
            console.error(
              `[figma-cache-design-mcp] Auto-cleanup: deleted expired cache file "${fullPath}" (fetched at ${envelope.fetchedAt}, TTL: ${this.ttl?.value}${this.ttl?.unit}).`
            );
          } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code !== "ENOENT") {
              console.error(
                `[figma-cache-design-mcp] Failed to delete expired cache file "${fullPath}":`,
                err
              );
            }
          }
        }
      }

      try {
        const remaining = await fs.readdir(fileDir);
        if (remaining.length === 0) {
          await fs.rmdir(fileDir);
        }
      } catch {
        // ignore rmdir error
      }
    }

    return result;
  }

  /**
   * Cleans cache files forcefully or selectively for a specific fileKey.
   */
  public async cleanCache(options: {
    fileKey?: string;
    force?: boolean;
    now?: number;
  } = {}): Promise<CleanCacheResult> {
    const { fileKey, force = false, now = Date.now() } = options;

    if (!force && this.ttlMs) {
      return this.cleanupExpired(now);
    }

    const result: CleanCacheResult = {
      deletedCount: 0,
      deletedFiles: [],
    };

    let targetDirs: string[] = [];
    if (fileKey && fileKey.trim()) {
      targetDirs = [this.getFileDir(fileKey.trim())];
    } else {
      try {
        const dirEntries = await fs.readdir(this.baseDir, { withFileTypes: true });
        targetDirs = dirEntries
          .filter((d) => d.isDirectory())
          .map((d) => path.join(this.baseDir, d.name));
      } catch {
        return result;
      }
    }

    for (const dirPath of targetDirs) {
      let files: string[] = [];
      try {
        files = await fs.readdir(dirPath);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const fullPath = path.join(dirPath, file);

        if (force) {
          try {
            await fs.unlink(fullPath);
            result.deletedCount++;
            result.deletedFiles.push(fullPath);
          } catch {
            // ignore
          }
        } else if (this.ttlMs) {
          const envelope = await this.readEnvelope(fullPath);
          if (envelope && this.isExpired(envelope, now)) {
            try {
              await fs.unlink(fullPath);
              result.deletedCount++;
              result.deletedFiles.push(fullPath);
            } catch {
              // ignore
            }
          }
        }
      }

      try {
        const remaining = await fs.readdir(dirPath);
        if (remaining.length === 0) {
          await fs.rmdir(dirPath);
        }
      } catch {
        // ignore
      }
    }

    return result;
  }

  /**
   * Finds a node in local disk cache for the given fileKey and targetNodeId.
   * 1. Checks direct node file (<fileKey>/<targetNodeId>.json).
   * 2. Scans other cached node trees (e.g. full pages) under the same <fileKey>.
   * If found in both, returns the one with the newer fetchedAt timestamp.
   * Automatically deletes expired files if autoCleanup is true.
   */
  public async get(
    fileKey: string,
    targetNodeId: string
  ): Promise<ResolvedNodeResult | null> {
    const fileDir = this.getFileDir(fileKey);
    const now = Date.now();

    let directCandidate: ResolvedNodeResult | null = null;
    const directPath = this.getNodeFilePath(fileKey, targetNodeId);
    const directEnvelope = await this.readEnvelope(directPath);
    if (directEnvelope && directEnvelope.document.id === targetNodeId) {
      if (this.isExpired(directEnvelope, now)) {
        if (this.autoCleanup) {
          await fs.unlink(directPath).catch(() => {});
          console.error(
            `[figma-cache-design-mcp] Cache direct candidate for node "${targetNodeId}" has expired (TTL: ${this.ttl?.value}${this.ttl?.unit}). Deleted file.`
          );
        }
      } else {
        directCandidate = {
          document: directEnvelope.document,
          source: "cache-direct",
          fetchedAt: directEnvelope.fetchedAt,
          ...(directEnvelope.fileName ? { fileName: directEnvelope.fileName } : {}),
        };
      }
    }

    // Also scan all cached files in the same fileKey folder for subtree matches
    // (or in case a parent page was refreshed more recently than a standalone block).
    let entries: string[] = [];
    try {
      entries = await fs.readdir(fileDir);
    } catch {
      return directCandidate;
    }

    let bestSubtreeCandidate: ResolvedNodeResult | null = null;

    for (const fileName of entries) {
      if (!fileName.endsWith(".json")) continue;
      const fullPath = path.join(fileDir, fileName);
      if (fullPath === directPath) continue;

      const envelope = await this.readEnvelope(fullPath);
      if (!envelope) continue;

      if (this.isExpired(envelope, now)) {
        if (this.autoCleanup) {
          await fs.unlink(fullPath).catch(() => {});
          console.error(
            `[figma-cache-design-mcp] Cache file "${fileName}" in file "${fileKey}" has expired (TTL: ${this.ttl?.value}${this.ttl?.unit}). Deleted file.`
          );
        }
        continue;
      }

      const found = findNodeInTree(envelope.document, targetNodeId);
      if (found) {
        if (
          !bestSubtreeCandidate ||
          envelope.fetchedAt > bestSubtreeCandidate.fetchedAt
        ) {
          bestSubtreeCandidate = {
            document: found,
            source: "cache-subtree",
            parentNodeId: envelope.nodeId,
            fetchedAt: envelope.fetchedAt,
            ...(envelope.fileName ? { fileName: envelope.fileName } : {}),
          };
        }
      }
    }

    if (directCandidate && bestSubtreeCandidate) {
      return directCandidate.fetchedAt >= bestSubtreeCandidate.fetchedAt
        ? directCandidate
        : bestSubtreeCandidate;
    }

    return directCandidate ?? bestSubtreeCandidate;
  }

  /**
   * Saves a fetched FigmaNode document to disk cache.
   */
  public async set(
    fileKey: string,
    nodeId: string,
    document: FigmaNode,
    fileName?: string,
    metadata?: CacheMetadata
  ): Promise<CachedNodeEnvelope> {
    const fileDir = this.getFileDir(fileKey);
    await fs.mkdir(fileDir, { recursive: true });

    const envelope: CachedNodeEnvelope = {
      fileKey,
      nodeId,
      fetchedAt: new Date().toISOString(),
      ...(fileName ? { fileName } : {}),
      ...(metadata?.originalUrl ? { originalUrl: metadata.originalUrl } : {}),
      ...(metadata?.label ? { label: metadata.label } : {}),
      document,
    };

    const filePath = this.getNodeFilePath(fileKey, nodeId);
    await fs.writeFile(filePath, JSON.stringify(envelope, null, 2), "utf-8");
    return envelope;
  }

  /**
   * Returns list of cached node IDs for a specific fileKey.
   */
  public async getCachedNodeIds(fileKey: string): Promise<string[]> {
    const fileDir = this.getFileDir(fileKey);
    try {
      const entries = await fs.readdir(fileDir);
      return entries
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5).replace(/_/g, ":"));
    } catch {
      return [];
    }
  }

  /**
   * Lists all cached node envelopes in the cache directory (optionally filtered by fileKey).
   */
  public async list(filterFileKey?: string): Promise<CachedNodeEnvelope[]> {
    if (this.autoCleanup && this.ttlMs) {
      await this.cleanupExpired();
    }

    const results: CachedNodeEnvelope[] = [];

    let fileDirs: string[] = [];
    if (filterFileKey && filterFileKey.trim()) {
      fileDirs = [this.getFileDir(filterFileKey.trim())];
    } else {
      try {
        const dirEntries = await fs.readdir(this.baseDir, {
          withFileTypes: true,
        });
        fileDirs = dirEntries
          .filter((d) => d.isDirectory())
          .map((d) => path.join(this.baseDir, d.name));
      } catch {
        return [];
      }
    }

    for (const dirPath of fileDirs) {
      let files: string[] = [];
      try {
        files = await fs.readdir(dirPath);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const envelope = await this.readEnvelope(path.join(dirPath, file));
        if (envelope) {
          results.push(envelope);
        }
      }
    }

    results.sort((a, b) => (b.fetchedAt > a.fetchedAt ? 1 : -1));
    return results;
  }
}
