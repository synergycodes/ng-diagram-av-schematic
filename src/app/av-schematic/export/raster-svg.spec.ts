import { describe, expect, it } from 'vitest';
import {
  MAX_SVG_EXPORT_BYTES,
  MAX_SVG_EXPORT_DIMENSION,
  MAX_SVG_EXPORT_PIXELS,
  SVG_EXPORT_MIME_TYPE,
  assertRasterExportSize,
  buildRasterSvgSnapshot,
} from './raster-svg';

describe('raster-backed SVG export', () => {
  it('wraps one composited PNG without foreignObject markup', () => {
    const pngDataUrl = 'data:image/png;base64,cG5n';
    const svg = buildRasterSvgSnapshot({ width: 320.25, height: 180.5, pngDataUrl });
    const blob = new Blob([svg], { type: SVG_EXPORT_MIME_TYPE });

    expect(blob.type).toBe(SVG_EXPORT_MIME_TYPE);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 320.25 180.5"');
    expect(svg).toContain(`<image width="320.25" height="180.5" href="${pngDataUrl}" />`);
    expect(svg).not.toContain('foreignObject');
    expect(blob.size).toBeLessThan(MAX_SVG_EXPORT_BYTES);
  });

  it('rejects output beyond the explicit byte limit', () => {
    const pngDataUrl = `data:image/png;base64,${'A'.repeat(128)}`;

    expect(() => buildRasterSvgSnapshot({ width: 10, height: 10, pngDataUrl }, 100)).toThrow(
      /safety limit/,
    );
  });

  it('rejects non-PNG payloads', () => {
    expect(() =>
      buildRasterSvgSnapshot({
        width: 10,
        height: 10,
        pngDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      }),
    ).toThrow(/requires a PNG data URL/);
  });

  it('accepts a raster exactly at the dimension and pixel limits', () => {
    expect(() => {
      assertRasterExportSize(
        {
          width: MAX_SVG_EXPORT_DIMENSION,
          height: MAX_SVG_EXPORT_PIXELS / MAX_SVG_EXPORT_DIMENSION,
        },
        1,
      );
    }).not.toThrow();
  });

  it('rejects a raster dimension before canvas allocation', () => {
    expect(() => {
      assertRasterExportSize({ width: MAX_SVG_EXPORT_DIMENSION + 1, height: 1 }, 1);
    }).toThrow(/dimension limit/);
  });

  it('rejects an excessive raster pixel count before canvas allocation', () => {
    expect(() => {
      assertRasterExportSize(
        {
          width: MAX_SVG_EXPORT_DIMENSION,
          height: MAX_SVG_EXPORT_PIXELS / MAX_SVG_EXPORT_DIMENSION + 1,
        },
        1,
      );
    }).toThrow(/pixel limit/);
  });
});
