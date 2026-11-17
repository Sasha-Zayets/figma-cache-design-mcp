# figma-cache-design-mcp

Cache-first Model Context Protocol (MCP) server that delivers compact, CSS-like Figma block designs and page outlines from a persistent local disk cache, calling the Figma REST API only on a cache miss or when explicitly refreshed.

Designed specifically for AI coding agents to minimize LLM token consumption, avoid Figma API rate limits, and streamline frontend implementation.

---

## Quick Start & MCP Client Configuration

No manual git clone or repository building is required. You can run `figma-cache-design-mcp` directly via `npx` in any MCP client (Claude Desktop, Cursor, Antigravity, Cline, Windsurf, etc.).

### 1. Configuration (`npx`)

Add `figma-cache-design-mcp` to your MCP client configuration file:

```json
{
  "mcpServers": {
    "figma-cache-design-mcp": {
      "command": "npx",
      "args": ["-y", "figma-cache-design-mcp"],
      "env": {
        "FIGMA_TOKEN": "figd_your_personal_access_token",
        "FIGMA_CACHE_DIR": "/absolute/path/to/cache/directory",
        "FIGMA_CACHE_AUTO_CLEANUP": "true",
        "FIGMA_CACHE_TTL": "30d"
      }
    }
  }
}
```

### 2. Environment Variables
- `FIGMA_TOKEN` *(required for Figma API requests)* — Personal Access Token from Figma (Settings ➔ Security ➔ Personal access tokens).
- `FIGMA_CACHE_DIR` *(required)* — Absolute directory path for the local disk cache.
- `FIGMA_CACHE_AUTO_CLEANUP` *(optional, default: `false`)* — Set to `"true"` to automatically delete files older than TTL. If `false`, files are never deleted automatically.
- `FIGMA_CACHE_TTL` *(optional, default: stored forever)* — Time to live / retention period. Supported units: `s` (seconds), `m` (minutes), `h` (hours), `d` (days). Examples: `"30d"`, `"12h"`, `"45m"`, `"60s"`, or JSON `'{"value": 30, "unit": "d"}'`. By default, files are stored forever.

---

## How to Use

### A. MCP Tools (Inside Agent / Chat)

All link-based tools accept parameters in any combination (at least one of `desktop`, `mobile`, `url`, or `urls` is required):
- `desktop?: string` — Figma link to the desktop version (page or block) with `node-id`.
- `mobile?: string` — Figma link to the mobile version (page or block) with `node-id`.
- `url?: string` — Single Figma link without a viewport label.
- `urls?: string[]` — Multiple Figma links at once (pages, sections, or individual blocks).
- `refresh?: boolean` — Force refresh from Figma API, bypassing disk cache (`false` by default).

#### 1. `cache_design`
Downloads one or more Figma designs (whole pages or individual blocks/parts) and saves them to the local disk cache without dumping large CSS trees into the chat context. Once cached, `get_outline` and `get_block` can work with them (and any nested child elements) completely offline without making Figma API calls.

#### 2. `get_outline`
Downloads a whole page or section into cache and returns a compact outline of top-level frames/blocks with their IDs, names, dimensions (`W×H`), and ready-to-use links for `get_block`.

#### 3. `get_block`
Returns an aggregated **Design Tokens Summary** (colors, typography, spacing, radii, shadows) and a compact **CSS-like Layout Tree** for the block. If its parent page or section was already cached via `cache_design` or `get_outline`, the block is extracted directly from the local cache with zero API calls.

#### 4. `list_cache`
Lists all designs currently stored in the local MCP disk cache (`fileKey?: string` optional filter) along with node IDs, dimensions, timestamps, and ready-to-use URLs.

#### 5. `clean_cache`
Cleans up expired Figma designs from disk cache based on configured TTL (`force?: boolean` to remove all files, `fileKey?: string` to target a specific file).

---

### B. CLI Usage (Pre-caching from Terminal via npx)

You can pre-populate, inspect, or clean the local disk cache directly from your terminal using `npx`:

```bash
# Pre-cache desktop and mobile designs
npx -y figma-cache-design-mcp cache --desktop "https://www.figma.com/design/<fileKey>/...?node-id=0-1" --mobile "https://www.figma.com/design/<fileKey>/...?node-id=99-100"

# Pre-cache multiple blocks or pages at once
npx -y figma-cache-design-mcp cache "https://www.figma.com/design/<fileKey>/...?node-id=10-100" "https://www.figma.com/design/<fileKey>/...?node-id=20-200"

# Force refresh from Figma API
npx -y figma-cache-design-mcp cache --refresh "https://www.figma.com/design/<fileKey>/...?node-id=10-100"

# List all designs currently cached on disk
npx -y figma-cache-design-mcp list

# Clean expired cache files based on TTL
npx -y figma-cache-design-mcp clean

# Force-clean all cached files
npx -y figma-cache-design-mcp clean --force
```

*(Note: ensure `FIGMA_TOKEN` and `FIGMA_CACHE_DIR` environment variables are exported in your terminal session when running CLI commands).*

---

## Cache Retention & Auto-Cleanup (TTL)

`figma-cache-design-mcp` includes an automated cache lifecycle management system to control disk usage and ensure designs stay fresh:

### 1. Default Behavior
- **`autoCleanup`: `false`** — Cache files are **never deleted automatically**.
- **`ttl`: `undefined`** — Cache files are kept **forever** and never expire unless refreshed or manually deleted.

### 2. Enabling Auto-Cleanup & TTL
When `autoCleanup: true` and `ttl` are configured:
- **On Reads (`get_block`, `get_outline`):** If a cached file is older than the configured TTL, it is immediately deleted from disk and treated as a cache miss, prompting a fresh fetch from Figma API.
- **On Listing / Cleanup:** Scans the cache directory, unlinks any expired JSON files, and removes empty project folders.
- **Supported Units:**
  - `s` — seconds (e.g., `"60s"`)
  - `m` — minutes (e.g., `"15m"`)
  - `h` — hours (e.g., `"12h"`)
  - `d` — days (e.g., `"30d"`)

### 3. Configuration Examples

**In MCP Client configuration (`env`):**
```json
{
  "env": {
    "FIGMA_TOKEN": "figd_...",
    "FIGMA_CACHE_DIR": "/path/to/cache",
    "FIGMA_CACHE_AUTO_CLEANUP": "true",
    "FIGMA_CACHE_TTL": "30d"
  }
}
```
*(Also accepts JSON format: `"FIGMA_CACHE_TTL": "{\"value\": 30, \"unit\": \"d\"}"`)*

**In TypeScript / Node.js API:**
```typescript
import { CacheManager } from "figma-cache-design-mcp";

const cache = new CacheManager({
  cacheDir: "/path/to/cache",
  autoCleanup: true,
  ttl: { value: 30, unit: "d" }
});
```

---

## Why Use figma-cache-design-mcp Over the Official Figma MCP?

The official Figma MCP (and standard Figma REST API) was designed for design editors, returning raw, deeply nested scene graphs packed with transformation matrices, bezier curve coordinates, plugin metadata, and internal flags. While comprehensive, this raw format is poorly suited for LLM coding agents.

`figma-cache-design-mcp` is purpose-built for frontend development with AI agents:

1. **Massive Context & Token Savings (up to 90–95% reduction):**
   - **Official MCP:** Returning raw JSON for a medium-to-large page or frame can consume 50k–500k+ tokens, rapidly exhausting the LLM context window and degrading reasoning quality.
   - **figma-cache-design-mcp:** Strips away graphical boilerplate and translates the node tree into an aggregated **Design Tokens Summary** and a concise, indented **CSS-like Layout Tree**.
2. **Subtree Cache-First Architecture (Zero API calls for cached elements):**
   - **Official MCP:** Makes live network calls to Figma on every tool invocation.
   - **figma-cache-design-mcp:** Caching a page or section (via `cache_design` or `get_outline`) allows any child button, card, or section to be resolved immediately from local disk via **recursive subtree lookup** — requiring **0 additional API requests and 0 network latency**.
3. **Protection Against Figma API Rate Limits (`429 Too Many Requests`):**
   - An autonomous agent can run dozens of inspection steps in a loop. By caching once on disk (`FIGMA_CACHE_DIR`), you avoid triggering Figma API tier limits.
   - Built-in **exponential backoff and auto-retry** honoring the `Retry-After` header automatically recovers from transient rate spikes.
4. **Transparent Diagnostic Logging:**
   - Real-time `stderr` logs clearly indicate `Cache HIT (direct)`, `Cache HIT (subtree)`, or `Cache MISS` (displaying existing cached nodes in the file) so you always know why a request went to the network.
5. **Intelligent Vector & Icon Collapsing:**
   - SVG icons in Figma often contain dozens of nested `<VECTOR>` nodes and boolean operations. This MCP automatically collapses them into a single `[ICON/SVG "IconName" (24×24) { color: #... }]` line, eliminating hundreds of lines of vector noise.
6. **Native Multi-Viewport (Desktop + Mobile) in One Call:**
   - Inspect both desktop and mobile layouts side-by-side in a single tool call to implement clean responsive styles without switching contexts.
7. **Pre-Caching & Offline Support via CLI:**
   - Pre-populate the cache from your terminal before starting an agent session (`npm run cache`). The agent can then work completely offline or without consuming Figma API quotas.

### Comparison Summary

| Capability | Official Figma MCP | figma-cache-design-mcp |
| :--- | :--- | :--- |
| **Output Format** | Raw multi-megabyte JSON | Compact CSS-like Tree + Design Tokens |
| **LLM Token Footprint** | Extremely heavy (10k–100k+ tokens) | Minimal (only relevant CSS layout properties) |
| **Caching Model** | None / ephemeral in-memory | Persistent disk cache + recursive subtree search |
| **Figma API Rate Limits** | High risk during agent loops | Minimal (page fetched once, reused indefinitely) |
| **Vector Icon Handling** | Dumps every vector path & coordinate | Collapsed to single `[ICON/SVG]` tag |
| **Multi-Viewport Support** | Single URL per request | Native side-by-side `desktop` + `mobile` |
| **CLI Pre-caching** | No | Yes (`npm run cache`, `npm run cache:list`) |

---

## What the Formatters Do

The formatting engine (`src/formatter.ts`) acts as an intelligent compiler that converts raw Figma node schemas into standard web layout models:

### 1. Figma Primitives to Standard CSS
- **Colors & Opacity:** Converts Figma float RGBA values (`0..1`) into clean `#HEX` or `rgba(r, g, b, a)`.
- **Gradients:** Computes rotation angles from Figma handle vectors to generate standard CSS `linear-gradient(deg, ...)` and `radial-gradient(...)`.
- **Auto-Layout to Flexbox:** Translates Figma auto-layout properties into CSS flex properties:
  - `display: flex`, `flex-direction: row | column`, `flex-wrap: wrap`
  - `justify-content` (`center`, `flex-end`, `space-between`)
  - `align-items` (`center`, `flex-end`, `baseline`)
  - `gap: <value>px`
- **Shorthand Box Models:** Aggregates individual edge values into CSS shorthands:
  - `padding: 12px 24px` instead of separate top/right/bottom/left fields.
  - `radius: 12px` or `radius: 8px 8px 0px 0px` for multi-corner radii.
  - `border: 1px solid #...` or directional `border-width`.
- **Effects & Typography:** Converts shadows to CSS `shadow: 0px 4px 16px rgba(...)`, blurs to `backdrop-filter: blur(...)`, and type properties into concise font descriptors: `700 48px/56px "Inter"; ls: -0.5px; align: center; case: uppercase`.

### 2. Noise & Icon Reduction
- **Collapsible Vector Detection (`isCollapsibleVectorSubtree`):** Inspects subtrees containing vector shapes (`VECTOR`, `BOOLEAN_OPERATION`, `STAR`, `LINE`, etc.) under icon-sized dimensions (≤240×240px). Instead of outputting internal vector geometry, it generates a single entry with dominant colors:
  ```text
  - [10:104] ICON/SVG "ArrowRightIcon" (24×24) { color: #ffffff }
  ```
- **Invisible Layers:** Filters out all hidden layers (`visible: false`), preventing debug frames or hidden alternatives from polluting context.

### 3. Automated Design Token Collector (`TokenCollector`)
While traversing the node hierarchy, the formatter collects unique design tokens used across the block:
- Background & surface colors
- Text colors & border colors
- Typography definitions
- Spacing scales (`gap`, `padding`)
- Corner radii and elevation shadows

These are rendered at the top of the block response, allowing LLMs to immediately define CSS variables, Tailwind utility classes, or theme tokens.

### 4. Specialized Formatting Outputs
- **`formatBlockSection` (for `get_block`):** Complete design tokens summary + full CSS-like layout tree for the target block.
- **`formatOutlineSection` (for `get_outline`):** High-level view of top-level frames and sections with dimensions and ready-to-use links for subsequent block queries.
- **`formatCacheSection` (for `cache_design`):** Compact confirmation detailing cached nodes, dimensions, and child node URLs without flooding the chat with CSS trees.
- **`formatCachedList` (for `list_cache`):** Overview of all locally cached files, viewports, and timestamps.

---

## Core Principles

1. **Cache-First:** Every request checks the local disk cache (`FIGMA_CACHE_DIR`) first — including **recursive lookup inside previously cached pages**. The Figma API is only called on a cache miss or when `refresh: true` is passed.
2. **Unified Link Parsing:** Supports `/design/<fileKey>`, `/file/<fileKey>`, and branch links `/branch/<branchKey>` with automatic `node-id` normalization (`123-456` → `123:456`).
3. **Compact Output:** Instead of hundreds of kilobytes of raw JSON, the agent receives an aggregated `Design Tokens Summary` and a concise CSS-like `Layout & Styles Tree`. Complex vector icon groups are automatically collapsed into a single `ICON/SVG` entry.
4. **Environment-Only Authentication:** The Figma personal access token is read strictly from the `FIGMA_TOKEN` environment variable.
