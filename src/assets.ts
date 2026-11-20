import { isCollapsibleVectorSubtree } from "./formatter.js";
import { AssetTypesFilter, DiscoveredAsset, FigmaNode } from "./types.js";

/**
 * Walks a FigmaNode tree (single image/icon node, block, or whole page)
 * and discovers deduplicated raster image fills and collapsible SVG icons.
 */
export function discoverAssets(
  root: FigmaNode,
  types: AssetTypesFilter = "all"
): DiscoveredAsset[] {
  const discovered: DiscoveredAsset[] = [];
  const seenKeys = new Set<string>();

  const includeImages = types === "all" || types === "images";
  const includeIcons = types === "all" || types === "icons";

  function visit(node: FigmaNode): void {
    if (node.visible === false) {
      return;
    }

    const width = node.absoluteBoundingBox?.width;
    const height = node.absoluteBoundingBox?.height;

    // 1. Check for raster IMAGE fills on this node
    if (includeImages && Array.isArray(node.fills)) {
      for (const paint of node.fills) {
        if (paint.visible !== false && paint.type === "IMAGE" && paint.imageRef) {
          const dedupeKey = `ref:${paint.imageRef}`;
          if (!seenKeys.has(dedupeKey)) {
            seenKeys.add(dedupeKey);
            discovered.push({
              kind: "image",
              nodeId: node.id,
              name: node.name || `image-${node.id}`,
              ...(width !== undefined ? { width } : {}),
              ...(height !== undefined ? { height } : {}),
              imageRef: paint.imageRef,
              dedupeKey,
            });
          }
        }
      }
    }

    // 2. Check if this node is a vector/icon subtree that should be exported as SVG
    if (isCollapsibleVectorSubtree(node)) {
      if (includeIcons) {
        const dedupeKey = node.componentId
          ? `comp:${node.componentId}`
          : `node:${node.id}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          discovered.push({
            kind: "svg",
            nodeId: node.id,
            name: node.name || `icon-${node.id}`,
            ...(width !== undefined ? { width } : {}),
            ...(height !== undefined ? { height } : {}),
            ...(node.componentId ? { componentId: node.componentId } : {}),
            dedupeKey,
          });
        }
      }
      // Do not descend into child vector paths of an already-collapsed icon
      return;
    }

    // 3. Recurse into children
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  visit(root);
  return discovered;
}

/**
 * Detects file extension from magic bytes, Content-Type header, or URL.
 */
export function detectImageExtension(
  buffer: Buffer,
  contentType?: string | null,
  url?: string
): string {
  // Magic bytes check
  if (buffer.length >= 8) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return "png";
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "jpg";
    }
    // GIF: 47 49 46 38
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    ) {
      return "gif";
    }
    // WEBP: RIFF....WEBP
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "webp";
    }
  }

  // Content-Type fallback
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("svg")) return "svg";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("png")) return "png";

  // URL extension fallback
  if (url) {
    const cleanUrl = url.split("?")[0].toLowerCase();
    if (cleanUrl.endsWith(".svg")) return "svg";
    if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "jpg";
    if (cleanUrl.endsWith(".webp")) return "webp";
    if (cleanUrl.endsWith(".gif")) return "gif";
    if (cleanUrl.endsWith(".png")) return "png";
  }

  return "png";
}

/**
 * Generates a clean, filesystem-safe, collision-free filename for an exported asset.
 */
export function buildCleanAssetFilename(
  name: string,
  nodeId: string,
  extension: string,
  usedNames: Set<string>
): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  const safeBase = slug || `asset-${nodeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  let candidate = `${safeBase}.${extension}`;

  if (!usedNames.has(candidate)) {
    usedNames.add(candidate);
    return candidate;
  }

  let counter = 2;
  while (usedNames.has(`${safeBase}-${counter}.${extension}`)) {
    counter++;
  }
  candidate = `${safeBase}-${counter}.${extension}`;
  usedNames.add(candidate);
  return candidate;
}
