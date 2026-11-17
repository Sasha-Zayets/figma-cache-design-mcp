export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaColorStop {
  position: number;
  color: FigmaColor;
}

export interface FigmaVector {
  x: number;
  y: number;
}

export interface FigmaPaint {
  type:
    | "SOLID"
    | "GRADIENT_LINEAR"
    | "GRADIENT_RADIAL"
    | "GRADIENT_ANGULAR"
    | "GRADIENT_DIAMOND"
    | "IMAGE"
    | "EMOJI"
    | "VIDEO";
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  gradientHandlePositions?: FigmaVector[];
  gradientStops?: FigmaColorStop[];
  scaleMode?: string;
  imageRef?: string;
}

export interface FigmaEffect {
  type: "INNER_SHADOW" | "DROP_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
  visible?: boolean;
  radius: number;
  color?: FigmaColor;
  offset?: FigmaVector;
  spread?: number;
}

export interface FigmaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string;
  fontWeight?: number;
  fontSize?: number;
  textAlignHorizontal?: "LEFT" | "RIGHT" | "CENTER" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  letterSpacing?: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  lineHeightPercentFontSize?: number;
  lineHeightUnit?: "PIXELS" | "FONT_SIZE_%" | "INTRINSIC_%";
  textCase?: "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  textDecoration?: "NONE" | "STRIKETHROUGH" | "UNDERLINE";
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  children?: FigmaNode[];
  absoluteBoundingBox?: FigmaRect | null;
  absoluteRenderBounds?: FigmaRect | null;

  // Auto-layout & positioning
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  layoutWrap?: "NO_WRAP" | "WRAP";
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  layoutAlign?: "INHERIT" | "STRETCH" | "MIN" | "CENTER" | "MAX";
  layoutGrow?: number;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  counterAxisSpacing?: number;

  // Constraints & dimensions
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  clipsContent?: boolean;

  // Visuals
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  individualStrokeWeights?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  strokeDashes?: number[];
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  effects?: FigmaEffect[];

  // Text
  characters?: string;
  style?: FigmaTypeStyle;

  // Component metadata
  componentId?: string;
  componentProperties?: Record<string, { type: string; value: string | boolean }>;
}

export interface FigmaNodesApiResponse {
  name?: string;
  lastModified?: string;
  Version?: string;
  nodes: Record<
    string,
    | {
        document: FigmaNode;
        components?: Record<string, unknown>;
        styles?: Record<string, unknown>;
      }
    | null
  >;
}

export interface ParsedFigmaUrl {
  originalUrl: string;
  fileKey: string;
  nodeId: string; // normalized with colon, e.g., "123:456"
}

export interface CachedNodeEnvelope {
  fileKey: string;
  nodeId: string;
  fetchedAt: string;
  fileName?: string;
  originalUrl?: string;
  label?: "desktop" | "mobile" | "default";
  document: FigmaNode;
}

export interface CacheMetadata {
  originalUrl?: string;
  label?: "desktop" | "mobile" | "default";
}

export interface ResolvedNodeResult {
  document: FigmaNode;
  source: "cache-direct" | "cache-subtree" | "figma-api";
  parentNodeId?: string;
  fetchedAt: string;
  fileName?: string;
}

export interface ViewportLinksInput {
  desktop?: string;
  mobile?: string;
  url?: string;
  urls?: string[];
  refresh?: boolean;
}

export interface ListCacheInput {
  fileKey?: string;
}

export type TtlUnit = "s" | "m" | "h" | "d";

export interface CacheTtlConfig {
  value: number;
  unit: TtlUnit;
}

export interface CacheManagerConfig {
  cacheDir?: string;
  autoCleanup?: boolean;
  ttl?: CacheTtlConfig;
}

export interface CleanCacheResult {
  deletedCount: number;
  deletedFiles: string[];
}

export interface ViewportEntry {
  label: "desktop" | "mobile" | "default";
  rawUrl: string;
  parsed: ParsedFigmaUrl;
}
