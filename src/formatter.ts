import {
  CachedNodeEnvelope,
  CleanCacheResult,
  FigmaColor,
  FigmaEffect,
  FigmaNode,
  FigmaPaint,
  FigmaTypeStyle,
  ResolvedNodeResult,
  ViewportEntry,
} from "./types.js";
import { buildNodeUrl } from "./url-parser.js";

/**
 * Formats a number to at most 2 decimal places, stripping trailing zeros.
 */
export function roundNum(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Converts a Figma RGBA color + optional paint opacity into #HEX or rgba(r, g, b, a).
 */
export function formatFigmaColor(color: FigmaColor, paintOpacity = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = roundNum((color.a ?? 1) * paintOpacity);

  if (a >= 1) {
    const toHex = (n: number) => n.toString(16).padStart(2, "0").toLowerCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Computes approximate CSS gradient angle in degrees from Figma gradientHandlePositions.
 */
function computeGradientAngleDeg(handles?: { x: number; y: number }[]): number {
  if (!handles || handles.length < 2) return 180;
  const dx = handles[1].x - handles[0].x;
  const dy = handles[1].y - handles[0].y;
  // In CSS, 0deg points up, 90deg points right, 180deg points down
  const radians = Math.atan2(dy, dx);
  const deg = Math.round((radians * 180) / Math.PI + 90);
  return ((deg % 360) + 360) % 360;
}

/**
 * Formats a single FigmaPaint into a CSS-like value.
 */
export function formatPaint(paint: FigmaPaint): string | null {
  if (paint.visible === false) return null;
  const opacity = paint.opacity ?? 1;

  if (paint.type === "SOLID" && paint.color) {
    return formatFigmaColor(paint.color, opacity);
  }

  if (
    (paint.type === "GRADIENT_LINEAR" ||
      paint.type === "GRADIENT_RADIAL" ||
      paint.type === "GRADIENT_ANGULAR" ||
      paint.type === "GRADIENT_DIAMOND") &&
    paint.gradientStops &&
    paint.gradientStops.length > 0
  ) {
    const stops = paint.gradientStops
      .map((stop) => {
        const col = formatFigmaColor(stop.color, opacity);
        const pct = Math.round(stop.position * 100);
        return `${col} ${pct}%`;
      })
      .join(", ");

    if (paint.type === "GRADIENT_LINEAR") {
      const angle = computeGradientAngleDeg(paint.gradientHandlePositions);
      return `linear-gradient(${angle}deg, ${stops})`;
    }
    return `radial-gradient(${stops})`;
  }

  if (paint.type === "IMAGE") {
    const mode = paint.scaleMode ? ` (${paint.scaleMode.toLowerCase()})` : "";
    return `[IMAGE fill${mode}]`;
  }

  return null;
}

/**
 * Formats CSS padding shorthand from top, right, bottom, left.
 */
export function formatPadding(
  top = 0,
  right = 0,
  bottom = 0,
  left = 0
): string | null {
  const t = roundNum(top);
  const r = roundNum(right);
  const b = roundNum(bottom);
  const l = roundNum(left);

  if (t === 0 && r === 0 && b === 0 && l === 0) return null;
  if (t === r && r === b && b === l) return `${t}px`;
  if (t === b && r === l) return `${t}px ${r}px`;
  if (r === l) return `${t}px ${r}px ${b}px`;
  return `${t}px ${r}px ${b}px ${l}px`;
}

/**
 * Formats border-radius from cornerRadius or rectangleCornerRadii.
 */
export function formatRadius(node: FigmaNode): string | null {
  if (
    node.rectangleCornerRadii &&
    Array.isArray(node.rectangleCornerRadii) &&
    node.rectangleCornerRadii.length === 4
  ) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii.map(roundNum);
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) return null;
    if (tl === tr && tr === br && br === bl) return `${tl}px`;
    return `${tl}px ${tr}px ${br}px ${bl}px`;
  }
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    return `${roundNum(node.cornerRadius)}px`;
  }
  return null;
}

/**
 * Formats a FigmaEffect into CSS shadow or blur string.
 */
export function formatEffect(effect: FigmaEffect): {
  kind: "shadow" | "blur" | "backdrop-blur";
  value: string;
} | null {
  if (effect.visible === false) return null;

  if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
    const x = roundNum(effect.offset?.x ?? 0);
    const y = roundNum(effect.offset?.y ?? 0);
    const blur = roundNum(effect.radius ?? 0);
    const spread = roundNum(effect.spread ?? 0);
    const color = effect.color
      ? formatFigmaColor(effect.color)
      : "rgba(0, 0, 0, 0.25)";
    const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
    const spreadPart = spread !== 0 ? ` ${spread}px` : "";
    return {
      kind: "shadow",
      value: `${inset}${x}px ${y}px ${blur}px${spreadPart} ${color}`,
    };
  }

  if (effect.type === "LAYER_BLUR") {
    return {
      kind: "blur",
      value: `blur(${roundNum(effect.radius)}px)`,
    };
  }

  if (effect.type === "BACKGROUND_BLUR") {
    return {
      kind: "backdrop-blur",
      value: `blur(${roundNum(effect.radius)}px)`,
    };
  }

  return null;
}

/**
 * Formats typography style into a concise CSS-like descriptor.
 */
export function formatTypography(style?: FigmaTypeStyle): string | null {
  if (!style || !style.fontFamily) return null;

  const weight = style.fontWeight ?? 400;
  const size = style.fontSize ? `${roundNum(style.fontSize)}px` : "16px";

  let lineHeight = "";
  if (style.lineHeightPx && style.fontSize) {
    lineHeight = `/${roundNum(style.lineHeightPx)}px`;
  } else if (style.lineHeightPercentFontSize) {
    lineHeight = `/${roundNum(style.lineHeightPercentFontSize)}%`;
  }

  const parts: string[] = [`${weight} ${size}${lineHeight} "${style.fontFamily}"`];

  if (style.letterSpacing && roundNum(style.letterSpacing) !== 0) {
    parts.push(`ls: ${roundNum(style.letterSpacing)}px`);
  }

  if (
    style.textAlignHorizontal &&
    style.textAlignHorizontal !== "LEFT"
  ) {
    parts.push(`align: ${style.textAlignHorizontal.toLowerCase()}`);
  }

  if (style.textCase) {
    const caseMap: Record<string, string> = {
      UPPER: "uppercase",
      LOWER: "lowercase",
      TITLE: "capitalize",
    };
    if (caseMap[style.textCase]) {
      parts.push(`case: ${caseMap[style.textCase]}`);
    }
  }

  if (style.textDecoration && style.textDecoration !== "NONE") {
    parts.push(`decoration: ${style.textDecoration.toLowerCase()}`);
  }

  return parts.join("; ");
}

const VECTOR_PRIMITIVE_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "LINE",
  "ELLIPSE",
  "REGULAR_POLYGON",
]);

/**
 * Checks whether a subtree represents an icon / pure SVG vector graphic
 * that should be collapsed into a single `[ICON/SVG]` node instead of expanding all vector paths.
 */
function isCollapsibleVectorSubtree(node: FigmaNode): boolean {
  if (VECTOR_PRIMITIVE_TYPES.has(node.type)) {
    return true;
  }

  if (!node.children || node.children.length === 0) {
    return false;
  }

  // Only consider small/medium graphic containers (e.g. icons/illustrations <= 240x240)
  const w = node.absoluteBoundingBox?.width ?? 0;
  const h = node.absoluteBoundingBox?.height ?? 0;
  if (w > 240 || h > 240) {
    return false;
  }

  let hasVectorPrimitive = false;

  function check(current: FigmaNode): boolean {
    if (current.visible === false) return true;
    if (current.type === "TEXT") return false;
    if (current.fills?.some((f) => f.visible !== false && f.type === "IMAGE")) {
      return false;
    }
    if (VECTOR_PRIMITIVE_TYPES.has(current.type)) {
      hasVectorPrimitive = true;
      return true;
    }
    if (current.children && current.children.length > 0) {
      return current.children.every(check);
    }
    // Allow small decorative rects inside an icon (e.g. bounding box or bar)
    if (current.type === "RECTANGLE") {
      return true;
    }
    return false;
  }

  return check(node) && hasVectorPrimitive;
}

/**
 * Collects dominant fill/stroke colors from a collapsed vector icon subtree.
 */
function collectVectorColors(node: FigmaNode, out = new Set<string>()): string[] {
  if (node.visible === false) return Array.from(out);
  for (const paint of node.fills ?? []) {
    const formatted = formatPaint(paint);
    if (formatted && !formatted.startsWith("[IMAGE")) {
      out.add(formatted);
    }
  }
  for (const paint of node.strokes ?? []) {
    const formatted = formatPaint(paint);
    if (formatted && !formatted.startsWith("[IMAGE")) {
      out.add(formatted);
    }
  }
  for (const child of node.children ?? []) {
    collectVectorColors(child, out);
  }
  return Array.from(out);
}

interface TokenCollector {
  bgColors: Set<string>;
  textColors: Set<string>;
  borderColors: Set<string>;
  typography: Set<string>;
  gaps: Set<string>;
  paddings: Set<string>;
  radii: Set<string>;
  shadows: Set<string>;
}

function createTokenCollector(): TokenCollector {
  return {
    bgColors: new Set(),
    textColors: new Set(),
    borderColors: new Set(),
    typography: new Set(),
    gaps: new Set(),
    paddings: new Set(),
    radii: new Set(),
    shadows: new Set(),
  };
}

/**
 * Formats a single node and its children into CSS-like tree lines while collecting tokens.
 */
function formatNodeTree(
  node: FigmaNode,
  tokens: TokenCollector,
  depth = 0,
  parent?: FigmaNode
): string[] {
  if (node.visible === false) {
    return [];
  }

  const indent = "  ".repeat(depth);
  const bbox = node.absoluteBoundingBox;
  const width = bbox ? roundNum(bbox.width) : null;
  const height = bbox ? roundNum(bbox.height) : null;
  const sizeStr =
    width !== null && height !== null ? ` (${width}×${height})` : "";

  // Check if this node is an icon/vector graphic that should be collapsed
  if (depth > 0 && isCollapsibleVectorSubtree(node)) {
    const iconColors = collectVectorColors(node);
    iconColors.forEach((c) => tokens.bgColors.add(c));
    const colorAttr =
      iconColors.length > 0 ? ` { color: ${iconColors.join(", ")} }` : "";
    return [
      `${indent}- [${node.id}] ICON/SVG "${node.name}"${sizeStr}${colorAttr}`,
    ];
  }

  const props: string[] = [];

  // 1. Layout / Flexbox
  if (node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL") {
    props.push("display: flex");
    props.push(
      `flex-direction: ${node.layoutMode === "HORIZONTAL" ? "row" : "column"}`
    );

    if (node.layoutWrap === "WRAP") {
      props.push("flex-wrap: wrap");
    }

    const justifyMap: Record<string, string> = {
      CENTER: "center",
      MAX: "flex-end",
      SPACE_BETWEEN: "space-between",
    };
    if (
      node.primaryAxisAlignItems &&
      justifyMap[node.primaryAxisAlignItems]
    ) {
      props.push(`justify-content: ${justifyMap[node.primaryAxisAlignItems]}`);
    }

    const alignMap: Record<string, string> = {
      CENTER: "center",
      MAX: "flex-end",
      BASELINE: "baseline",
    };
    if (
      node.counterAxisAlignItems &&
      alignMap[node.counterAxisAlignItems]
    ) {
      props.push(`align-items: ${alignMap[node.counterAxisAlignItems]}`);
    }

    if (typeof node.itemSpacing === "number" && node.itemSpacing > 0) {
      const gapVal = `${roundNum(node.itemSpacing)}px`;
      props.push(`gap: ${gapVal}`);
      tokens.gaps.add(gapVal);
    }

    const pad = formatPadding(
      node.paddingTop,
      node.paddingRight,
      node.paddingBottom,
      node.paddingLeft
    );
    if (pad) {
      props.push(`padding: ${pad}`);
      tokens.paddings.add(pad);
    }
  }

  // 2. Relative positioning (when ABSOLUTE or parent has no auto-layout)
  if (
    parent &&
    bbox &&
    parent.absoluteBoundingBox &&
    (node.layoutPositioning === "ABSOLUTE" ||
      (!parent.layoutMode || parent.layoutMode === "NONE"))
  ) {
    const relX = roundNum(bbox.x - parent.absoluteBoundingBox.x);
    const relY = roundNum(bbox.y - parent.absoluteBoundingBox.y);
    if (node.layoutPositioning === "ABSOLUTE") {
      props.push(`position: absolute`);
      props.push(`left: ${relX}px`);
      props.push(`top: ${relY}px`);
    } else if (relX !== 0 || relY !== 0) {
      props.push(`offset: ${relX}px, ${relY}px`);
    }
  }

  // 3. Sizing modes (FILL / HUG / min / max)
  if (node.layoutSizingHorizontal === "FILL") {
    props.push("w: fill");
  } else if (node.layoutSizingHorizontal === "HUG") {
    props.push("w: hug");
  }
  if (node.layoutSizingVertical === "FILL") {
    props.push("h: fill");
  } else if (node.layoutSizingVertical === "HUG") {
    props.push("h: hug");
  }

  if (typeof node.minWidth === "number") {
    props.push(`min-w: ${roundNum(node.minWidth)}px`);
  }
  if (typeof node.maxWidth === "number") {
    props.push(`max-w: ${roundNum(node.maxWidth)}px`);
  }
  if (typeof node.minHeight === "number") {
    props.push(`min-h: ${roundNum(node.minHeight)}px`);
  }
  if (typeof node.maxHeight === "number") {
    props.push(`max-h: ${roundNum(node.maxHeight)}px`);
  }

  if (node.clipsContent && node.children && node.children.length > 0) {
    props.push("overflow: hidden");
  }

  // 4. Fills (bg for frames/shapes, color for TEXT)
  const visibleFills = (node.fills ?? [])
    .map(formatPaint)
    .filter((v): v is string => Boolean(v));

  if (visibleFills.length > 0) {
    const joinedFills = visibleFills.join(", ");
    if (node.type === "TEXT") {
      props.push(`color: ${joinedFills}`);
      visibleFills.forEach((c) => {
        if (!c.startsWith("[IMAGE")) tokens.textColors.add(c);
      });
    } else {
      props.push(`bg: ${joinedFills}`);
      visibleFills.forEach((c) => {
        if (!c.startsWith("[IMAGE")) tokens.bgColors.add(c);
      });
    }
  }

  // 5. Strokes / Borders
  const visibleStrokes = (node.strokes ?? [])
    .map(formatPaint)
    .filter((v): v is string => Boolean(v));

  if (visibleStrokes.length > 0) {
    const strokeColor = visibleStrokes[0];
    const strokeStyle =
      node.strokeDashes && node.strokeDashes.length > 0 ? "dashed" : "solid";

    if (node.individualStrokeWeights) {
      const { top, right, bottom, left } = node.individualStrokeWeights;
      const wStr = formatPadding(top, right, bottom, left);
      if (wStr) {
        props.push(`border-width: ${wStr}`);
        props.push(`border-style: ${strokeStyle}`);
        props.push(`border-color: ${strokeColor}`);
        tokens.borderColors.add(strokeColor);
      }
    } else {
      const weight = roundNum(node.strokeWeight ?? 1);
      if (weight > 0) {
        props.push(`border: ${weight}px ${strokeStyle} ${strokeColor}`);
        tokens.borderColors.add(strokeColor);
      }
    }
  }

  // 6. Corner Radius
  const radius = formatRadius(node);
  if (radius) {
    props.push(`radius: ${radius}`);
    tokens.radii.add(radius);
  }

  // 7. Effects (Shadows & Blurs)
  const shadows: string[] = [];
  for (const eff of node.effects ?? []) {
    const formatted = formatEffect(eff);
    if (!formatted) continue;
    if (formatted.kind === "shadow") {
      shadows.push(formatted.value);
      tokens.shadows.add(formatted.value);
    } else if (formatted.kind === "blur") {
      props.push(`filter: ${formatted.value}`);
    } else if (formatted.kind === "backdrop-blur") {
      props.push(`backdrop-filter: ${formatted.value}`);
    }
  }
  if (shadows.length > 0) {
    props.push(`shadow: ${shadows.join(", ")}`);
  }

  // 8. Opacity
  if (typeof node.opacity === "number" && node.opacity < 1) {
    props.push(`opacity: ${roundNum(node.opacity)}`);
  }

  // 9. Typography & Text Content
  if (node.type === "TEXT") {
    const typo = formatTypography(node.style);
    if (typo) {
      props.push(`font: ${typo}`);
      tokens.typography.add(typo);
    }
    if (typeof node.characters === "string") {
      const cleanText = node.characters.replace(/\r?\n/g, "\\n");
      props.push(`text: ${JSON.stringify(cleanText)}`);
    }
  }

  const propsBlock = props.length > 0 ? ` { ${props.join("; ")} }` : "";
  const lines: string[] = [
    `${indent}- [${node.id}] ${node.type} "${node.name}"${sizeStr}${propsBlock}`,
  ];

  for (const child of node.children ?? []) {
    lines.push(...formatNodeTree(child, tokens, depth + 1, node));
  }

  return lines;
}

function formatViewportHeading(label: ViewportEntry["label"]): string {
  if (label === "desktop") return "Desktop";
  if (label === "mobile") return "Mobile";
  return "Block";
}

function formatCacheSourceBadge(result: ResolvedNodeResult): string {
  if (result.source === "cache-direct") {
    return `cache (direct, fetched ${result.fetchedAt})`;
  }
  if (result.source === "cache-subtree") {
    return `cache (from parent page ${result.parentNodeId}, fetched ${result.fetchedAt})`;
  }
  return `figma-api (LIVE API REQUEST, cached at ${result.fetchedAt})`;
}

/**
 * Formats the top-level outline of a page or container frame.
 */
export function formatOutlineSection(
  entry: ViewportEntry,
  result: ResolvedNodeResult
): string {
  const doc = result.document;
  const heading =
    entry.label === "default"
      ? "## Page Outline"
      : `## ${formatViewportHeading(entry.label)} Outline`;

  const bbox = doc.absoluteBoundingBox;
  const rootSize = bbox
    ? ` (${roundNum(bbox.width)}×${roundNum(bbox.height)})`
    : "";

  const lines: string[] = [
    heading,
    `- **Root Node:** \`${doc.id}\` "${doc.name}" [${doc.type}]${rootSize}`,
    `- **File Key:** \`${entry.parsed.fileKey}\``,
    `- **Source:** ${formatCacheSourceBadge(result)}`,
    "",
    "### Top-Level Frames / Blocks:",
  ];

  const visibleChildren = (doc.children ?? []).filter(
    (c) => c.visible !== false
  );

  if (visibleChildren.length === 0) {
    lines.push("_No visible child elements found in this node._");
    return lines.join("\n");
  }

  for (const child of visibleChildren) {
    const cBox = child.absoluteBoundingBox;
    const cSize = cBox
      ? `${roundNum(cBox.width)}×${roundNum(cBox.height)}`
      : "n/a";
    const childUrl = buildNodeUrl(entry.parsed, child.id);
    lines.push(
      `- **[${child.id}]** \`${child.type}\` **"${child.name}"** — \`${cSize}\`  \n  URL: ${childUrl}`
    );

    // If a top-level item is a SECTION, also list its immediate visible frames
    if (child.type === "SECTION" && child.children && child.children.length > 0) {
      for (const secChild of child.children) {
        if (secChild.visible === false) continue;
        const sBox = secChild.absoluteBoundingBox;
        const sSize = sBox
          ? `${roundNum(sBox.width)}×${roundNum(sBox.height)}`
          : "n/a";
        const secChildUrl = buildNodeUrl(entry.parsed, secChild.id);
        lines.push(
          `  - **[${secChild.id}]** \`${secChild.type}\` **"${secChild.name}"** — \`${sSize}\`  \n    URL: ${secChildUrl}`
        );
      }
    }
  }

  return lines.join("\n");
}

/**
 * Formats a compact CSS-like description + aggregated design tokens for a block.
 */
export function formatBlockSection(
  entry: ViewportEntry,
  result: ResolvedNodeResult
): string {
  const doc = result.document;
  const heading = `## ${formatViewportHeading(entry.label)}: "${doc.name}" [${doc.id}]`;

  const tokens = createTokenCollector();
  const treeLines = formatNodeTree(doc, tokens, 0);

  const tokenLines: string[] = ["### Design Tokens Summary"];
  if (tokens.bgColors.size > 0) {
    tokenLines.push(`- **Backgrounds / Fills:** ${Array.from(tokens.bgColors).join(", ")}`);
  }
  if (tokens.textColors.size > 0) {
    tokenLines.push(`- **Text Colors:** ${Array.from(tokens.textColors).join(", ")}`);
  }
  if (tokens.borderColors.size > 0) {
    tokenLines.push(`- **Borders:** ${Array.from(tokens.borderColors).join(", ")}`);
  }
  if (tokens.typography.size > 0) {
    tokenLines.push("- **Typography:**");
    for (const t of tokens.typography) {
      tokenLines.push(`  - \`${t}\``);
    }
  }
  if (tokens.gaps.size > 0) {
    tokenLines.push(`- **Gaps:** ${Array.from(tokens.gaps).join(", ")}`);
  }
  if (tokens.paddings.size > 0) {
    tokenLines.push(`- **Paddings:** ${Array.from(tokens.paddings).join(" | ")}`);
  }
  if (tokens.radii.size > 0) {
    tokenLines.push(`- **Radii:** ${Array.from(tokens.radii).join(", ")}`);
  }
  if (tokens.shadows.size > 0) {
    tokenLines.push(`- **Shadows:** ${Array.from(tokens.shadows).join(" | ")}`);
  }
  if (tokenLines.length === 1) {
    tokenLines.push("- _No specific design tokens detected_");
  }

  return [
    heading,
    `- **File Key:** \`${entry.parsed.fileKey}\` | **Node ID:** \`${doc.id}\` | **Source:** ${formatCacheSourceBadge(result)}`,
    "",
    ...tokenLines,
    "",
    "### Layout & Styles Tree",
    "```text",
    ...treeLines,
    "```",
  ].join("\n");
}

/**
 * Formats a concise cache confirmation summary for a cached design (whole page or block/part).
 */
export function formatCacheSection(
  entry: ViewportEntry,
  result: ResolvedNodeResult
): string {
  const doc = result.document;
  const heading =
    entry.label === "default"
      ? `## Cached Design: "${doc.name}" [${doc.id}]`
      : `## Cached ${formatViewportHeading(entry.label)}: "${doc.name}" [${doc.id}]`;

  const bbox = doc.absoluteBoundingBox;
  const rootSize = bbox
    ? ` (${roundNum(bbox.width)}×${roundNum(bbox.height)})`
    : "";

  const nodeUrl = buildNodeUrl(entry.parsed, doc.id);
  const visibleChildren = (doc.children ?? []).filter(
    (c) => c.visible !== false
  );

  const lines: string[] = [
    heading,
    `- **Node:** \`${doc.id}\` "${doc.name}" [\`${doc.type}\`]${rootSize}`,
    `- **File Key:** \`${entry.parsed.fileKey}\`${result.fileName ? ` ("${result.fileName}")` : ""}`,
    `- **Status:** ${formatCacheSourceBadge(result)}`,
    `- **Direct Visible Children:** ${visibleChildren.length}`,
    `- **URL:** ${nodeUrl}`,
  ];

  if (visibleChildren.length > 0) {
    lines.push("", "### Available Sub-Nodes in Cache:");
    for (const child of visibleChildren) {
      const cBox = child.absoluteBoundingBox;
      const cSize = cBox
        ? `${roundNum(cBox.width)}×${roundNum(cBox.height)}`
        : "n/a";
      const childUrl = buildNodeUrl(entry.parsed, child.id);
      lines.push(
        `- **[${child.id}]** \`${child.type}\` **"${child.name}"** — \`${cSize}\`  \n  URL: ${childUrl}`
      );
    }
  }

  return lines.join("\n");
}

/**
 * Formats a summary list of all designs currently stored in the local MCP disk cache.
 */
export function formatCachedList(envelopes: CachedNodeEnvelope[]): string {
  if (envelopes.length === 0) {
    return "## Cached Figma Designs (0)\n\n_Cache is currently empty. Use `cache_design`, `get_outline`, or `get_block` to cache designs._";
  }

  const lines: string[] = [`## Cached Figma Designs (${envelopes.length})`, ""];

  for (const env of envelopes) {
    const doc = env.document;
    const bbox = doc.absoluteBoundingBox;
    const size = bbox
      ? `${roundNum(bbox.width)}×${roundNum(bbox.height)}`
      : "n/a";
    const visibleChildren = (doc.children ?? []).filter(
      (c) => c.visible !== false
    );
    const labelBadge =
      env.label && env.label !== "default" ? ` [${env.label}]` : "";
    const fileLabel = env.fileName ? ` ("${env.fileName}")` : "";
    const baseUrl =
      env.originalUrl ||
      `https://www.figma.com/design/${env.fileKey}?node-id=${env.nodeId.replace(/:/g, "-")}`;
    const url = buildNodeUrl(
      {
        originalUrl: baseUrl,
        fileKey: env.fileKey,
        nodeId: env.nodeId,
      },
      doc.id
    );

    lines.push(
      `- **[${doc.id}]** \`${doc.type}\` **"${doc.name}"** (\`${size}\`)${labelBadge} — File: \`${env.fileKey}\`${fileLabel} | Children: ${visibleChildren.length} | Fetched: ${env.fetchedAt}  \n  URL: ${url}`
    );
  }

  return lines.join("\n");
}

/**
 * Formats the result of a cache cleanup operation.
 */
export function formatCleanCacheSummary(
  result: CleanCacheResult,
  options?: { force?: boolean }
): string {
  const heading = options?.force
    ? "## Cache Cleanup (Forced)"
    : "## Cache Cleanup (Expired Files)";

  const lines: string[] = [
    heading,
    `- **Deleted Files Count:** ${result.deletedCount}`,
  ];

  if (result.deletedFiles.length > 0) {
    lines.push("", "### Removed Files:");
    for (const f of result.deletedFiles) {
      lines.push(`- \`${f}\``);
    }
  } else {
    lines.push("", "_No expired cache files found._");
  }

  return lines.join("\n");
}
