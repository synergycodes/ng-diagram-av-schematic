import { formatCoord } from './dxf-format';

/**
 * DXF entity primitives. This module knows nothing about ng-diagram or
 * av-schematic - only how to serialize a DXF entity record. Add a new
 * subclass here to support a new DXF entity type (e.g. ARC).
 */
export abstract class DxfEntity {
  constructor(public readonly layerName: string) {}

  abstract serialize(handle: number): string[];

  protected pair(code: number, value: string | number): string {
    return `  ${code}\n${value}`;
  }
}

export class DxfLwPolyline extends DxfEntity {
  constructor(
    layerName: string,
    public readonly points: { x: number; y: number }[],
    public readonly closed = false,
    public readonly color?: number,
    public readonly lineweight?: number,
  ) {
    super(layerName);
  }

  serialize(handle: number): string[] {
    const lines = [
      this.pair(0, 'LWPOLYLINE'),
      this.pair(5, handle.toString(16).toUpperCase()),
      this.pair(100, 'AcDbEntity'),
      this.pair(8, this.layerName),
    ];
    if (this.color !== undefined) {
      lines.push(this.pair(62, this.color));
    }
    if (this.lineweight !== undefined) {
      lines.push(this.pair(370, this.lineweight));
    }
    lines.push(
      this.pair(100, 'AcDbPolyline'),
      this.pair(90, this.points.length),
      this.pair(70, this.closed ? 1 : 0),
    );
    for (const p of this.points) {
      lines.push(this.pair(10, formatCoord(p.x)), this.pair(20, formatCoord(p.y)));
    }
    return lines;
  }
}

export class DxfCircle extends DxfEntity {
  constructor(
    layerName: string,
    public readonly x: number,
    public readonly y: number,
    public readonly radius: number,
    public readonly color?: number,
    public readonly lineweight?: number,
  ) {
    super(layerName);
  }

  serialize(handle: number): string[] {
    const lines = [
      this.pair(0, 'CIRCLE'),
      this.pair(5, handle.toString(16).toUpperCase()),
      this.pair(100, 'AcDbEntity'),
      this.pair(8, this.layerName),
    ];
    if (this.color !== undefined) lines.push(this.pair(62, this.color));
    if (this.lineweight !== undefined) lines.push(this.pair(370, this.lineweight));
    lines.push(
      this.pair(100, 'AcDbCircle'),
      this.pair(10, formatCoord(this.x)),
      this.pair(20, formatCoord(this.y)),
      this.pair(30, formatCoord(0)),
      this.pair(40, formatCoord(this.radius)),
    );
    return lines;
  }
}

/**
 * Single-line text entity. halign: 0=left, 1=center, 2=right.
 * valign: 0=baseline, 1=bottom, 2=middle, 3=top.
 *
 * The constructor sanitizes `text` (see `sanitizeDxfText` below) so user
 * strings can't trip AutoCAD's `%%c` / `%%d` / `%%p` format codes or break
 * the DXF group-code framing with embedded newlines.
 */
export class DxfText extends DxfEntity {
  public readonly text: string;

  constructor(
    layerName: string,
    text: string,
    public readonly x: number,
    public readonly y: number,
    public readonly height: number,
    public readonly styleName = 'STANDARD',
    public readonly halign: 0 | 1 | 2 = 0,
    public readonly valign: 0 | 1 | 2 | 3 = 0,
    public readonly color?: number,
    public readonly rotation?: number,
  ) {
    super(layerName);
    this.text = sanitizeDxfText(text);
  }

  serialize(handle: number): string[] {
    const aligned = this.halign !== 0 || this.valign !== 0;
    const lines = [
      this.pair(0, 'TEXT'),
      this.pair(5, handle.toString(16).toUpperCase()),
      this.pair(100, 'AcDbEntity'),
      this.pair(8, this.layerName),
    ];
    if (this.color !== undefined) {
      lines.push(this.pair(62, this.color));
    }
    lines.push(
      this.pair(100, 'AcDbText'),
      this.pair(10, formatCoord(this.x)),
      this.pair(20, formatCoord(this.y)),
      this.pair(30, formatCoord(0)),
      this.pair(40, formatCoord(this.height)),
      this.pair(1, this.text),
      this.pair(7, this.styleName),
      this.pair(72, this.halign),
    );
    if (this.rotation !== undefined) {
      lines.push(this.pair(50, formatCoord(this.rotation)));
    }
    if (aligned) {
      lines.push(
        this.pair(11, formatCoord(this.x)),
        this.pair(21, formatCoord(this.y)),
        this.pair(31, formatCoord(0)),
      );
    }
    // Second AcDbText subclass marker - per the DXF spec only the 73 (valign)
    // group may follow it; the second alignment point (11/21/31) belongs to
    // the first AcDbText subclass.
    lines.push(this.pair(100, 'AcDbText'));
    lines.push(this.pair(73, this.valign));
    return lines;
  }
}

/**
 * Sanitize a string for safe inclusion in a DXF TEXT entity (group code 1).
 *
 * - `%` -> `%%%`: AutoCAD treats `%%c` / `%%d` / `%%p` / `%%o` / `%%u` /
 *   `%%nnn` as format codes (diameter, degree, plus/minus, toggles, ASCII char).
 *   `%%%` renders as a single literal `%`, and pre-escaping every `%`
 *   neutralizes any user-typed `%%X` sequence in the same pass.
 * - C0 control characters (incl. `\n`, `\r`, `\t`) -> space: TEXT is
 *   single-line, and a raw newline would corrupt the DXF group-code/value
 *   framing (each pair is delimited by a newline).
 *
 * Backslash escape sequences (`\C1;` colour, `\P` paragraph, etc.) are
 * MTEXT-only and are passed through as literal characters by AutoCAD's
 * TEXT renderer.
 */
const sanitizeDxfText = (text: string): string =>
  // Strip ASCII control characters that would break DXF group-code line parsing.
  // eslint-disable-next-line no-control-regex
  text.replace(/%/g, '%%%').replace(/[\x00-\x1f]/g, ' ');
