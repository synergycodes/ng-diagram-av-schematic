import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgDiagramModelService } from 'ng-diagram';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramExportService } from './diagram-export.service';
import { MAX_SVG_EXPORT_DIMENSION } from './raster-svg';

const { toCanvas } = vi.hoisted(() => ({ toCanvas: vi.fn() }));

vi.mock('html-to-image', () => ({ toCanvas }));

describe('DiagramExportService SVG preflight', () => {
  let service: DiagramExportService;

  beforeEach(() => {
    toCanvas.mockReset();
    TestBed.configureTestingModule({
      providers: [
        DiagramExportService,
        {
          provide: NgDiagramModelService,
          useValue: {
            nodes: signal([{ id: 'node-1' }]),
            edges: signal([]),
            computePartsBounds: () => ({
              x: 0,
              y: 0,
              width: MAX_SVG_EXPORT_DIMENSION + 1,
              height: 20,
            }),
          },
        },
      ],
    });
    service = TestBed.inject(DiagramExportService);

    const host = document.createElement('div');
    host.append(document.createElement('ng-diagram-canvas'));
    service.setDiagramElement(new ElementRef(host));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('rejects an oversized region before calling html-to-image', async () => {
    await expect(service.exportSvg()).rejects.toThrow(/dimension limit/);
    expect(toCanvas).not.toHaveBeenCalled();
  });
});
