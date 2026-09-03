export const SVG_EXPORT_MIME_TYPE = 'image/svg+xml;charset=utf-8';
export const MAX_SVG_EXPORT_BYTES = 5 * 1024 * 1024;
export const MAX_SVG_EXPORT_DIMENSION = 8192;
export const MAX_SVG_EXPORT_PIXELS = 16 * 1024 * 1024;

export interface RasterExportSize {
  width: number;
  height: number;
}

export interface RasterSvgSnapshot {
  width: number;
  height: number;
  pngDataUrl: string;
}

/** Rejects unsafe raster allocations before html-to-image creates a canvas. */
export function assertRasterExportSize(size: RasterExportSize, pixelRatio: number): void {
  if (
    !Number.isFinite(size.width) ||
    size.width <= 0 ||
    !Number.isFinite(size.height) ||
    size.height <= 0 ||
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0
  ) {
    throw new Error('SVG export dimensions and pixel ratio must be positive finite numbers');
  }

  const rasterWidth = Math.ceil(size.width * pixelRatio);
  const rasterHeight = Math.ceil(size.height * pixelRatio);
  if (rasterWidth > MAX_SVG_EXPORT_DIMENSION || rasterHeight > MAX_SVG_EXPORT_DIMENSION) {
    throw new Error(`SVG export exceeds the ${MAX_SVG_EXPORT_DIMENSION}px dimension limit`);
  }
  if (rasterWidth * rasterHeight > MAX_SVG_EXPORT_PIXELS) {
    throw new Error(`SVG export exceeds the ${MAX_SVG_EXPORT_PIXELS} pixel limit`);
  }
}

/** Builds a compact SVG wrapper around the already-composited diagram raster. */
export function buildRasterSvgSnapshot(
  snapshot: RasterSvgSnapshot,
  maxBytes = MAX_SVG_EXPORT_BYTES,
): string {
  if (!Number.isFinite(snapshot.width) || snapshot.width <= 0) {
    throw new Error('SVG export width must be a positive finite number');
  }
  if (!Number.isFinite(snapshot.height) || snapshot.height <= 0) {
    throw new Error('SVG export height must be a positive finite number');
  }
  if (!snapshot.pngDataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('SVG export requires a PNG data URL');
  }

  const width = formatDimension(snapshot.width);
  const height = formatDimension(snapshot.height);
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <image width="${width}" height="${height}" href="${snapshot.pngDataUrl}" />`,
    '</svg>',
  ].join('\n');

  const size = new TextEncoder().encode(svg).byteLength;
  if (size > maxBytes) {
    throw new Error(
      `SVG export is ${formatBytes(size)}; the safety limit is ${formatBytes(maxBytes)}`,
    );
  }
  return svg;
}

function formatDimension(value: number): string {
  return String(Math.ceil(value * 1000) / 1000);
}

function formatBytes(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
