import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CacheConfigError,
  CacheManager,
  parseTtlConfig,
  ttlToMs,
} from "../cache.js";
import { FigmaApiError, FigmaClient } from "../figma-client.js";
import {
  createFigmaBlockServer,
  handleCacheDesign,
  handleCleanCache,
  handleGetBlock,
  handleGetOutline,
  handleListCache,
} from "../server.js";
import { FigmaNode, FigmaNodesApiResponse } from "../types.js";
import {
  FigmaUrlError,
  buildNodeUrl,
  extractViewportEntries,
  parseCacheCliArgs,
  parseFigmaUrl,
} from "../url-parser.js";

const MOCK_PAGE_NODE: FigmaNode = {
  id: "0:1",
  name: "Landing Page Desktop",
  type: "CANVAS",
  children: [
    {
      id: "10:100",
      name: "Hero Section",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 720 },
      layoutMode: "VERTICAL",
      primaryAxisAlignItems: "CENTER",
      counterAxisAlignItems: "CENTER",
      itemSpacing: 24,
      paddingTop: 80,
      paddingRight: 120,
      paddingBottom: 80,
      paddingLeft: 120,
      fills: [{ type: "SOLID", color: { r: 0.05, g: 0.07, b: 0.12, a: 1 } }],
      children: [
        {
          id: "10:101",
          name: "Hero Title",
          type: "TEXT",
          absoluteBoundingBox: { x: 120, y: 80, width: 800, height: 64 },
          layoutSizingHorizontal: "FILL",
          layoutSizingVertical: "HUG",
          fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
          characters: "Build Faster with Cache-First Figma MCP",
          style: {
            fontFamily: "Inter",
            fontWeight: 700,
            fontSize: 48,
            lineHeightPx: 56,
            textAlignHorizontal: "CENTER",
          },
        },
        {
          id: "10:102",
          name: "CTA Button",
          type: "FRAME",
          absoluteBoundingBox: { x: 600, y: 168, width: 240, height: 52 },
          layoutMode: "HORIZONTAL",
          primaryAxisAlignItems: "CENTER",
          counterAxisAlignItems: "CENTER",
          itemSpacing: 12,
          paddingTop: 14,
          paddingRight: 28,
          paddingBottom: 14,
          paddingLeft: 28,
          cornerRadius: 12,
          fills: [{ type: "SOLID", color: { r: 0.23, g: 0.51, b: 0.96, a: 1 } }],
          effects: [
            {
              type: "DROP_SHADOW",
              visible: true,
              radius: 16,
              offset: { x: 0, y: 4 },
              spread: 0,
              color: { r: 0, g: 0, b: 0, a: 0.25 },
            },
          ],
          children: [
            {
              id: "10:103",
              name: "Button Label",
              type: "TEXT",
              absoluteBoundingBox: { x: 628, y: 182, width: 140, height: 24 },
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
              characters: "Get Started",
              style: {
                fontFamily: "Inter",
                fontWeight: 600,
                fontSize: 16,
                lineHeightPx: 24,
              },
            },
            {
              id: "10:104",
              name: "ArrowRightIcon",
              type: "FRAME",
              absoluteBoundingBox: { x: 780, y: 182, width: 24, height: 24 },
              children: [
                {
                  id: "10:105",
                  name: "Vector 1",
                  type: "VECTOR",
                  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                },
                {
                  id: "10:106",
                  name: "Vector 2",
                  type: "VECTOR",
                  strokes: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                },
              ],
            },
          ],
        },
        {
          id: "10:107",
          name: "Hidden Debug Layer",
          type: "FRAME",
          visible: false,
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        },
      ],
    },
    {
      id: "20:200",
      name: "Features Block",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 720, width: 1440, height: 600 },
      children: [],
    },
  ],
};

const MOCK_MOBILE_HERO_NODE: FigmaNode = {
  id: "99:100",
  name: "Hero Section Mobile",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 560 },
  layoutMode: "VERTICAL",
  itemSpacing: 16,
  paddingTop: 40,
  paddingRight: 20,
  paddingBottom: 40,
  paddingLeft: 20,
  fills: [{ type: "SOLID", color: { r: 0.05, g: 0.07, b: 0.12, a: 1 } }],
  children: [
    {
      id: "99:101",
      name: "Hero Title Mobile",
      type: "TEXT",
      absoluteBoundingBox: { x: 20, y: 40, width: 335, height: 72 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      characters: "Build Faster with Cache-First Figma MCP",
      style: {
        fontFamily: "Inter",
        fontWeight: 700,
        fontSize: 28,
        lineHeightPx: 36,
      },
    },
  ],
};

describe("URL Parser", () => {
  it("extracts fileKey and normalizes node-id from /design/ and /file/ links", () => {
    const parsed1 = parseFigmaUrl(
      "https://www.figma.com/design/AbCdEf123/My-Project?node-id=123-456&t=xyz"
    );
    assert.equal(parsed1.fileKey, "AbCdEf123");
    assert.equal(parsed1.nodeId, "123:456");

    const parsed2 = parseFigmaUrl(
      "https://www.figma.com/file/FileKey999/Old-Format?node-id=10%3A20"
    );
    assert.equal(parsed2.fileKey, "FileKey999");
    assert.equal(parsed2.nodeId, "10:20");
  });

  it("extracts branchKey as fileKey when URL points to a branch", () => {
    const parsed = parseFigmaUrl(
      "https://www.figma.com/design/MainFileKey/branch/BranchKey777/My-Project?node-id=10-100"
    );
    assert.equal(parsed.fileKey, "BranchKey777");
    assert.equal(parsed.nodeId, "10:100");
  });

  it("throws actionable error when node-id is missing (whole file link)", () => {
    assert.throws(
      () => parseFigmaUrl("https://www.figma.com/design/AbCdEf123/My-Project"),
      (err: unknown) => {
        assert(err instanceof FigmaUrlError);
        assert.match(err.message, /Copy link to selection/);
        return true;
      }
    );
  });

  it("validates that at least one of desktop, mobile, or url is provided", () => {
    assert.throws(
      () => extractViewportEntries({}),
      (err: unknown) => {
        assert(err instanceof FigmaUrlError);
        assert.match(err.message, /desktop.*mobile.*url/);
        return true;
      }
    );
  });

  it("builds child node URLs preserving base URL structure", () => {
    const parsed = parseFigmaUrl(
      "https://www.figma.com/design/AbCdEf123/My-Project?node-id=0-1"
    );
    const childUrl = buildNodeUrl(parsed, "10:100");
    assert.equal(
      childUrl,
      "https://www.figma.com/design/AbCdEf123/My-Project?node-id=10-100"
    );
  });
});

describe("Cache-First & Subtree Lookup Scenarios", () => {
  let tmpDir: string;
  let cacheManager: CacheManager;
  let apiCalls: Array<{ url: string }>;
  let mockFetch: typeof fetch;
  let client: FigmaClient;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "figma-mcp-test-"));
    cacheManager = new CacheManager(tmpDir);
    apiCalls = [];

    mockFetch = (async (input: string | URL | Request) => {
      const urlStr = String(input);
      apiCalls.push({ url: urlStr });
      const urlObj = new URL(urlStr);
      const ids = decodeURIComponent(urlObj.searchParams.get("ids") ?? "");

      const responseMap: Record<string, FigmaNode> = {
        "0:1": MOCK_PAGE_NODE,
        "10:100": MOCK_PAGE_NODE.children![0],
        "99:100": MOCK_MOBILE_HERO_NODE,
      };

      const targetDoc = responseMap[ids];
      if (!targetDoc) {
        return new Response(JSON.stringify({ nodes: {} }), { status: 200 });
      }

      const payload: FigmaNodesApiResponse = {
        name: "Mock Figma File",
        nodes: {
          [ids]: { document: targetDoc },
        },
      };

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    client = new FigmaClient({
      cacheManager,
      token: "figd_test_token",
      fetchImpl: mockFetch,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("requires FIGMA_CACHE_DIR environment variable when no custom directory is passed", () => {
    const origEnv = process.env.FIGMA_CACHE_DIR;
    delete process.env.FIGMA_CACHE_DIR;
    try {
      assert.throws(
        () => new CacheManager(),
        (err: unknown) => {
          assert(err instanceof CacheConfigError);
          assert.match(err.message, /FIGMA_CACHE_DIR environment variable is not set/);
          return true;
        }
      );

      process.env.FIGMA_CACHE_DIR = tmpDir;
      const manager = new CacheManager();
      assert.equal(manager.getCacheDir(), tmpDir);
    } finally {
      if (origEnv !== undefined) {
        process.env.FIGMA_CACHE_DIR = origEnv;
      } else {
        delete process.env.FIGMA_CACHE_DIR;
      }
    }
  });

  it("Scenario 1 & 2: Page cached via get_outline -> get_block finds block inside cached page WITHOUT calling Figma API", async () => {
    // 1. Load page outline
    const outlineOutput = await handleGetOutline(
      {
        desktop:
          "https://www.figma.com/design/FileABC/Landing?node-id=0-1",
      },
      client
    );

    assert.equal(apiCalls.length, 1, "Should make 1 API request for the page");
    assert.match(outlineOutput, /## Desktop Outline/);
    assert.match(outlineOutput, /\[10:100\].*Hero Section.*1440×720/);
    assert.match(outlineOutput, /\[20:200\].*Features Block.*1440×600/);
    // Should not dump nested children like "Hero Title" in the outline
    assert.doesNotMatch(outlineOutput, /Hero Title/);

    // 2. Now request "Hero Section" block (10:100) which is inside the cached page (0:1)
    const blockOutput = await handleGetBlock(
      {
        desktop:
          "https://www.figma.com/design/FileABC/Landing?node-id=10-100",
      },
      client
    );

    assert.equal(
      apiCalls.length,
      1,
      "Should NOT make any new Figma API calls because block is inside cached page"
    );
    assert.match(blockOutput, /from parent page 0:1/);
    assert.match(blockOutput, /## Desktop: "Hero Section" \[10:100\]/);
    assert.match(blockOutput, /### Design Tokens Summary/);
    assert.match(blockOutput, /Build Faster with Cache-First Figma MCP/);
    // Vector icon children should be collapsed into ICON/SVG
    assert.match(blockOutput, /\[10:104\] ICON\/SVG "ArrowRightIcon" \(24×24\)/);
    assert.doesNotMatch(blockOutput, /Vector 1/);
    // Hidden layers must be excluded
    assert.doesNotMatch(blockOutput, /Hidden Debug Layer/);
  });

  it("Scenario 3: Block requested when page is NOT in cache -> fetches only that block and caches it separately", async () => {
    const blockOutput1 = await handleGetBlock(
      {
        url: "https://www.figma.com/design/FileABC/Landing?node-id=10-100",
      },
      client
    );

    assert.equal(apiCalls.length, 1);
    assert.match(blockOutput1, /figma-api/);
    assert.match(blockOutput1, /## Block: "Hero Section" \[10:100\]/);

    // Second request for the same block hits direct cache
    const blockOutput2 = await handleGetBlock(
      {
        url: "https://www.figma.com/design/FileABC/Landing?node-id=10-100",
      },
      client
    );

    assert.equal(apiCalls.length, 1, "Second request should come from disk cache");
    assert.match(blockOutput2, /cache \(direct/);
  });

  it("Scenario 4 & 5: Single viewport vs Both desktop and mobile viewports", async () => {
    // Only mobile passed
    const mobileOnly = await handleGetBlock(
      {
        mobile: "https://www.figma.com/design/FileABC/Landing?node-id=99-100",
      },
      client
    );
    assert.equal(apiCalls.length, 1);
    assert.match(mobileOnly, /## Mobile: "Hero Section Mobile" \[99:100\]/);
    assert.doesNotMatch(mobileOnly, /## Desktop:/);

    // Both desktop and mobile passed (mobile is already cached, desktop will be fetched)
    const bothOutput = await handleGetBlock(
      {
        desktop: "https://www.figma.com/design/FileABC/Landing?node-id=10-100",
        mobile: "https://www.figma.com/design/FileABC/Landing?node-id=99-100",
      },
      client
    );
    assert.equal(apiCalls.length, 2, "Only desktop needed fetching; mobile was cached");
    assert.match(bothOutput, /## Desktop: "Hero Section" \[10:100\]/);
    assert.match(bothOutput, /## Mobile: "Hero Section Mobile" \[99:100\]/);
  });

  it("Scenario 6: Explicit refresh=true bypasses cache and calls Figma API", async () => {
    await handleGetBlock(
      {
        url: "https://www.figma.com/design/FileABC/Landing?node-id=10-100",
      },
      client
    );
    assert.equal(apiCalls.length, 1);

    await handleGetBlock(
      {
        url: "https://www.figma.com/design/FileABC/Landing?node-id=10-100",
        refresh: true,
      },
      client
    );
    assert.equal(apiCalls.length, 2, "refresh=true should force a new API call");
  });

  it("Scenario 7: cache_design with a whole page or a part -> subsequent get_block / get_outline works from cache (including nested elements inside a cached part)", async () => {
    // 1. Cache a part (Hero Section 10:100) and mobile part (99:100) via cache_design
    const cacheOutput = await handleCacheDesign(
      {
        desktop: "https://www.figma.com/design/FileABC/Landing?node-id=10-100",
        mobile: "https://www.figma.com/design/FileABC/Landing?node-id=99-100",
      },
      client
    );

    assert.equal(apiCalls.length, 2, "Should fetch both desktop and mobile parts into cache");
    assert.match(cacheOutput, /## Cached Desktop: "Hero Section" \[10:100\]/);
    assert.match(cacheOutput, /## Cached Mobile: "Hero Section Mobile" \[99:100\]/);
    // Should not dump full CSS layout tree during cache_design
    assert.doesNotMatch(cacheOutput, /### Layout & Styles Tree/);

    // 2. Work with the cached part via get_block -> 0 new API calls
    const blockOutput = await handleGetBlock(
      {
        desktop: "https://www.figma.com/design/FileABC/Landing?node-id=10-100",
        mobile: "https://www.figma.com/design/FileABC/Landing?node-id=99-100",
      },
      client
    );
    assert.equal(apiCalls.length, 2, "Should read both parts directly from cache");
    assert.match(blockOutput, /cache \(direct/);

    // 3. Request a smaller sub-part (CTA Button 10:102) inside the cached part (10:100) -> 0 new API calls!
    const subBlockOutput = await handleGetBlock(
      {
        url: "https://www.figma.com/design/FileABC/Landing?node-id=10-102",
      },
      client
    );
    assert.equal(
      apiCalls.length,
      2,
      "Should extract nested sub-element 10:102 from cached part 10:100 without API calls"
    );
    assert.match(subBlockOutput, /from parent page 10:100/);
    assert.match(subBlockOutput, /Get Started/);

    // 4. List cached items via handleListCache
    const listOutput = await handleListCache({}, client);
    assert.match(listOutput, /## Cached Figma Designs \(2\)/);
    assert.match(listOutput, /\[10:100\].*Hero Section/);
    assert.match(listOutput, /\[99:100\].*Hero Section Mobile/);
  });

  it("Scenario 8: cache_design with urls array and CLI argument parser", async () => {
    const cliArgs = parseCacheCliArgs([
      "--desktop",
      "https://www.figma.com/design/FileABC/Landing?node-id=0-1",
      "https://www.figma.com/design/FileABC/Landing?node-id=99-100",
      "--refresh",
    ]);
    assert.equal(
      cliArgs.desktop,
      "https://www.figma.com/design/FileABC/Landing?node-id=0-1"
    );
    assert.deepEqual(cliArgs.urls, [
      "https://www.figma.com/design/FileABC/Landing?node-id=99-100",
    ]);
    assert.equal(cliArgs.refresh, true);

    const cacheRes = await handleCacheDesign(cliArgs, client);
    assert.equal(apiCalls.length, 2);
    assert.match(cacheRes, /Landing Page Desktop/);
    assert.match(cacheRes, /Hero Section Mobile/);
  });

  it("Scenario 9: Figma API 429 auto-retry with Retry-After header succeeds", async () => {
    let callCount = 0;
    const sleeps: number[] = [];

    const retryMockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ err: "Rate limit exceeded" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "2",
          },
        });
      }
      return new Response(
        JSON.stringify({
          name: "Recovered File",
          nodes: {
            "10:100": { document: MOCK_PAGE_NODE.children![0] },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    const retryClient = new FigmaClient({
      cacheManager,
      token: "figd_test_token",
      fetchImpl: retryMockFetch,
      maxRetries: 2,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

    const result = await retryClient.resolveNode("FileABC", "10:100");
    assert.equal(callCount, 2, "Should have retried once after 429");
    assert.deepEqual(sleeps, [2000], "Should have slept for 2000ms from Retry-After");
    assert.equal(result.document.id, "10:100");
    assert.equal(result.source, "figma-api");
  });

  it("Scenario 10: Figma API 429 exhausts retries and throws actionable error with tip", async () => {
    let callCount = 0;
    const sleeps: number[] = [];

    const persistent429Fetch = (async () => {
      callCount++;
      return new Response(JSON.stringify({ err: "Too Many Requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const retryClient = new FigmaClient({
      cacheManager,
      token: "figd_test_token",
      fetchImpl: persistent429Fetch,
      maxRetries: 2,
      baseDelayMs: 100,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

    await assert.rejects(
      async () => retryClient.resolveNode("FileABC", "10:100"),
      (err: unknown) => {
        assert(err instanceof FigmaApiError);
        assert.equal(err.statusCode, 429);
        assert.match(err.message, /Figma API rate limit exceeded \(429 Too Many Requests\) after 2 retries/);
        assert.match(err.message, /node-id=0:1/);
        return true;
      }
    );

    assert.equal(callCount, 3, "1 initial attempt + 2 retries");
    assert.equal(sleeps.length, 2);
  });

  it("Scenario 11: TTL parsing, expiration detection, and autoCleanup behavior", async () => {
    // 1. parseTtlConfig
    assert.deepEqual(parseTtlConfig("30d"), { value: 30, unit: "d" });
    assert.deepEqual(parseTtlConfig("12h"), { value: 12, unit: "h" });
    assert.deepEqual(parseTtlConfig("45m"), { value: 45, unit: "m" });
    assert.deepEqual(parseTtlConfig("60s"), { value: 60, unit: "s" });
    assert.deepEqual(parseTtlConfig({ value: 30, unit: "d" }), { value: 30, unit: "d" });
    assert.deepEqual(parseTtlConfig('{"value": 15, "unit": "m"}'), { value: 15, unit: "m" });
    assert.equal(parseTtlConfig("invalid"), undefined);
    assert.equal(parseTtlConfig(null), undefined);

    // 2. ttlToMs
    assert.equal(ttlToMs({ value: 2, unit: "s" }), 2000);
    assert.equal(ttlToMs({ value: 5, unit: "m" }), 300000);
    assert.equal(ttlToMs({ value: 1, unit: "h" }), 3600000);
    assert.equal(ttlToMs({ value: 30, unit: "d" }), 30 * 24 * 3600 * 1000);

    // 3. Default behavior: files are stored forever, autoCleanup is false
    const defaultManager = new CacheManager(tmpDir);
    assert.equal(defaultManager.getAutoCleanup(), false);
    assert.equal(defaultManager.getTtl(), undefined);

    const oldDate = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const testDoc: FigmaNode = { id: "test:1", name: "Test Node", type: "FRAME" };

    // Set file with old timestamp
    await defaultManager.set("FileABC", "test:1", testDoc);
    // Overwrite envelope fetchedAt to 1 year ago
    const filePath = path.join(tmpDir, "FileABC", "test_1.json");
    const raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
    raw.fetchedAt = oldDate;
    await fs.writeFile(filePath, JSON.stringify(raw));

    // Under default settings, it is NOT expired and is NOT deleted
    assert.equal(defaultManager.isExpired(raw), false);
    const candidateDefault = await defaultManager.get("FileABC", "test:1");
    assert.ok(candidateDefault);
    assert.equal(candidateDefault.document.id, "test:1");

    // 4. With TTL configured and autoCleanup: true -> auto-deletes expired file
    const cleanupManager = new CacheManager({
      cacheDir: tmpDir,
      autoCleanup: true,
      ttl: { value: 30, unit: "d" },
    });
    assert.equal(cleanupManager.getAutoCleanup(), true);
    assert.deepEqual(cleanupManager.getTtl(), { value: 30, unit: "d" });

    // Node from 1 year ago is expired for 30d TTL
    assert.equal(cleanupManager.isExpired(raw), true);

    // Calling get with autoCleanup deletes expired candidate and returns null
    const candidateExpired = await cleanupManager.get("FileABC", "test:1");
    assert.equal(candidateExpired, null);

    // Verify file was unlinked from disk
    await assert.rejects(async () => fs.readFile(filePath, "utf-8"));

    // 5. cleanupExpired method cleans stale files across all folders
    await cleanupManager.set("FileXYZ", "node:10", testDoc);
    const xyzPath = path.join(tmpDir, "FileXYZ", "node_10.json");
    const xyzRaw = JSON.parse(await fs.readFile(xyzPath, "utf-8"));
    xyzRaw.fetchedAt = oldDate;
    await fs.writeFile(xyzPath, JSON.stringify(xyzRaw));

    const cleanResult = await cleanupManager.cleanupExpired();
    assert.equal(cleanResult.deletedCount, 1);
    assert.equal(cleanResult.deletedFiles.length, 1);

    // 6. Manual handleCleanCache with force: true
    await defaultManager.set("FileFresh", "fresh:1", testDoc);
    const forceCleanRes = await handleCleanCache({ force: true }, client);
    assert.match(forceCleanRes, /## Cache Cleanup \(Forced\)/);
    assert.match(forceCleanRes, /Deleted Files Count:/);
  });

  it("End-to-end MCP protocol test (tools/list and tools/call via InMemoryTransport)", async () => {
    const server = createFigmaBlockServer(client);
    const mcpClient = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    const toolsList = await mcpClient.listTools();
    const toolNames = toolsList.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      "cache_design",
      "clean_cache",
      "get_block",
      "get_outline",
      "list_cache",
    ]);

    // Call cache_design over MCP for the full page
    const cacheRes = await mcpClient.callTool({
      name: "cache_design",
      arguments: {
        desktop: "https://www.figma.com/design/FileABC/Landing?node-id=0-1",
      },
    });
    assert.equal(cacheRes.isError, undefined);
    assert.equal(apiCalls.length, 1);

    // Call list_cache over MCP
    const listRes = await mcpClient.callTool({
      name: "list_cache",
      arguments: {},
    });
    assert.equal(listRes.isError, undefined);

    // Call clean_cache over MCP
    const cleanRes = await mcpClient.callTool({
      name: "clean_cache",
      arguments: { force: false },
    });
    assert.equal(cleanRes.isError, undefined);

    // Call get_outline over MCP (should hit cache from cache_design)
    const outlineRes = await mcpClient.callTool({
      name: "get_outline",
      arguments: {
        desktop: "https://www.figma.com/design/FileABC/Landing?node-id=0-1",
      },
    });
    assert.equal(outlineRes.isError, undefined);

    // Call get_block over MCP (should hit subtree cache from cache_design)
    const blockRes = await mcpClient.callTool({
      name: "get_block",
      arguments: {
        desktop: "https://www.figma.com/design/FileABC/Landing?node-id=10-100",
      },
    });
    assert.equal(blockRes.isError, undefined);
    assert.equal(
      apiCalls.length,
      1,
      "Only 1 API call total across cache_design, get_outline, and get_block"
    );

    // Call get_block with link missing node-id -> returns isError: true
    const errorRes = await mcpClient.callTool({
      name: "get_block",
      arguments: {
        url: "https://www.figma.com/design/FileABC/Landing",
      },
    });
    assert.equal(errorRes.isError, true);

    await mcpClient.close();
    await server.close();
  });
});
