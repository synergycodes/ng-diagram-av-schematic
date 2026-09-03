import { ElementRef, Injectable, computed, inject, signal } from '@angular/core';
import { toCanvas } from 'html-to-image';
import { NgDiagramModelService } from 'ng-diagram';
import { buildAvDxfConfig } from './dxf-av-schematic/av-dxf-config';
import { DxfExporter } from './dxf/dxf-exporter';
import { DxfWriter } from './dxf/dxf-writer';
import { SVG_EXPORT_MIME_TYPE, assertRasterExportSize, buildRasterSvgSnapshot } from './raster-svg';

const EXPORT_PADDING = 50;
const PNG_PIXEL_RATIO = 2;
const SVG_PIXEL_RATIO = 1;
const DIAGRAM_CANVAS_SELECTOR = 'ng-diagram-canvas';

/**
 * Coordinates exporting the diagram to PNG and DXF.
 *
 * Scoped to the av-schematic page (see AvSchematicPageComponent providers),
 * so it shares a DI scope with NgDiagramModelService and is visible to any
 * descendant — including the export trigger living in the top navbar.
 *
 * The diagram component sets its host ElementRef on construction, which is
 * the only piece of state the service can't reach through DI.
 *
 * `canExport` reactively tracks whether the model has any nodes (and the
 * diagram element is registered), so menu items can disable themselves
 * automatically.
 */
@Injectable()
export class DiagramExportService {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly diagramElement = signal<ElementRef<HTMLElement> | null>(null);

  readonly canExport = computed(
    () => this.diagramElement() !== null && this.modelService.nodes().length > 0,
  );

  setDiagramElement(element: ElementRef<HTMLElement>): void {
    this.diagramElement.set(element);
  }

  clearDiagramElement(): void {
    this.diagramElement.set(null);
  }

  async exportPng(): Promise<void> {
    const canvasEl = this.getDiagramCanvasEl();
    if (!canvasEl) return;

    const region = this.computeExportRegion();
    if (!region) return;

    const backgroundColor = this.resolveBackgroundColor(canvasEl);

    const canvas = await toCanvas(canvasEl, {
      backgroundColor,
      width: region.width,
      height: region.height,
      pixelRatio: PNG_PIXEL_RATIO,
      style: {
        transform: `translate(${-region.x}px, ${-region.y}px) scale(1)`,
        transformOrigin: 'top left',
      },
    });

    this.downloadDataUrl(canvas.toDataURL('image/png'), 'av-schematic.png');
  }

  async exportSvg(): Promise<void> {
    const canvasEl = this.getDiagramCanvasEl();
    if (!canvasEl) return;
    const region = this.computeExportRegion();
    if (!region) return;
    assertRasterExportSize(region, SVG_PIXEL_RATIO);

    const canvas = await toCanvas(canvasEl, {
      backgroundColor: this.resolveBackgroundColor(canvasEl),
      width: region.width,
      height: region.height,
      pixelRatio: SVG_PIXEL_RATIO,
      style: {
        transform: `translate(${-region.x}px, ${-region.y}px) scale(1)`,
        transformOrigin: 'top left',
      },
    });
    const svg = buildRasterSvgSnapshot({
      width: region.width,
      height: region.height,
      pngDataUrl: canvas.toDataURL('image/png'),
    });
    this.downloadText(svg, 'av-schematic.svg', SVG_EXPORT_MIME_TYPE);
  }

  exportDxf(): void {
    const nodes = this.modelService.nodes();
    if (nodes.length === 0) return;
    const edges = this.modelService.edges();
    const bounds = this.modelService.computePartsBounds(nodes, edges);

    const doc = new DxfExporter(buildAvDxfConfig()).export(nodes, edges, bounds);
    const content = new DxfWriter().serialize(doc);

    this.downloadText(content, 'av-schematic.dxf', 'application/dxf');
  }

  private getDiagramCanvasEl(): HTMLElement | null {
    const element = this.diagramElement();
    return element?.nativeElement.querySelector(DIAGRAM_CANVAS_SELECTOR) ?? null;
  }

  /**
   * The ng-diagram canvas itself is transparent — the visible diagram
   * background is the page background painted on `<html>` per active theme
   * (see styles.css). Walk up the DOM to find the first element with a
   * non-transparent computed background, falling back to white.
   */
  private resolveBackgroundColor(start: HTMLElement): string {
    let el: HTMLElement | null = start;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && !bg.startsWith('rgba(0, 0, 0, 0')) {
        return bg;
      }
      el = el.parentElement;
    }
    return '#ffffff';
  }

  private computeExportRegion() {
    const nodes = this.modelService.nodes();
    if (nodes.length === 0) return null;

    const edges = this.modelService.edges();
    const bounds = this.modelService.computePartsBounds(nodes, edges);

    return {
      x: bounds.x - EXPORT_PADDING,
      y: bounds.y - EXPORT_PADDING,
      width: bounds.width + EXPORT_PADDING * 2,
      height: bounds.height + EXPORT_PADDING * 2,
    };
  }

  private downloadDataUrl(dataUrl: string, filename: string): void {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
  }

  private downloadText(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }
}
