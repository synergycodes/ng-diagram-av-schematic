import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  NgDiagramModelService,
  NgDiagramViewportService,
  type Edge,
  type NgDiagramConfig,
  type Node,
  type ClipboardPastedEvent,
} from 'ng-diagram';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramExportService } from '../export/diagram-export.service';
import { ElementMutationService } from '../properties-sidebar/element-mutation.service';
import { PropertiesSidebarService } from '../properties-sidebar/properties-sidebar.service';
import { DiagramComponent } from './diagram.component';
import { DanglingEdgeService } from './dangling-edge-creation/dangling-edge.service';
import { NodeVisibilityConfigService } from './node-visibility/node-visibility-config.service';
import { BoardPlacementService } from './placement/board-placement.service';
import { NodeTemplateType, type BoardNodeData, type WireEdgeData } from './model/interfaces';
import { BoardJumperCreationService } from './board-jumper-creation.service';

interface DiagramInteractionHarness {
  config: NgDiagramConfig;
  wirePickActive(): boolean;
  toggleWirePickMode(): void;
  cancelManualWirePick(event: KeyboardEvent): void;
  activateAltWirePick(event: KeyboardEvent): void;
  deactivateAltWirePick(event: KeyboardEvent): void;
  clearAltWirePick(): void;
  onClipboardPasted(event: ClipboardPastedEvent): Promise<void>;
}

describe('DiagramComponent interaction lifecycle', () => {
  let fixture: ComponentFixture<DiagramComponent>;
  let component: DiagramInteractionHarness;
  let normalizeVisualOrder: ReturnType<typeof vi.fn>;
  let modelNodes: Node[];

  beforeEach(() => {
    normalizeVisualOrder = vi.fn().mockResolvedValue(undefined);
    modelNodes = [];
    TestBed.configureTestingModule({
      imports: [DiagramComponent],
      providers: [
        { provide: NgDiagramViewportService, useValue: { zoomToFit: vi.fn() } },
        { provide: PropertiesSidebarService, useValue: { expandSidebar: vi.fn() } },
        { provide: ElementMutationService, useValue: { normalizeVisualOrder } },
        { provide: NodeVisibilityConfigService, useValue: { getViewportInsets: () => ({}) } },
        {
          provide: NgDiagramModelService,
          useValue: {
            getModel: () => ({ getNodes: () => modelNodes, getEdges: () => [] }),
          },
        },
        {
          provide: DiagramExportService,
          useValue: { setDiagramElement: vi.fn(), clearDiagramElement: vi.fn() },
        },
        { provide: DanglingEdgeService, useValue: { handleEdgeDrawEnded: vi.fn() } },
        { provide: BoardPlacementService, useValue: { settleDrag: vi.fn() } },
        {
          provide: BoardJumperCreationService,
          useValue: { activeBoardId: signal(null), cancel: vi.fn() },
        },
      ],
    });
    TestBed.overrideComponent(DiagramComponent, {
      set: {
        template: `
          <div
            class="diagram"
            (pointerup)="onCanvasPointerEnd($event)"
            (pointercancel)="onCanvasPointerEnd($event)"
          >
            <div class="canvas"></div>
            <button
              type="button"
              class="wire-pick-control"
              (click)="toggleWirePickMode()"
            >
              Alternar
            </button>
          </div>
        `,
      },
    });
    fixture = TestBed.createComponent(DiagramComponent);
    component = fixture.componentInstance as unknown as DiagramInteractionHarness;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('ends manual wire picking on a completed or cancelled canvas gesture', () => {
    const host = fixture.nativeElement as HTMLElement;
    const canvas = host.querySelector<HTMLElement>('.canvas');
    if (!canvas) throw new Error('Canvas test target not rendered');

    component.toggleWirePickMode();
    expect(component.wirePickActive()).toBe(true);

    canvas.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(component.wirePickActive()).toBe(false);

    component.toggleWirePickMode();
    canvas.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    expect(component.wirePickActive()).toBe(false);
  });

  it('does not consume the pointerup that toggles the wire-pick button', () => {
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector<HTMLButtonElement>('.wire-pick-control');
    if (!button) throw new Error('Wire-pick test button not rendered');

    button.click();
    expect(component.wirePickActive()).toBe(true);

    button.dispatchEvent(new Event('pointerup', { bubbles: true }));
    button.click();

    expect(component.wirePickActive()).toBe(false);
  });

  it('ends manual mode on Escape while preserving held-Alt mode', () => {
    component.toggleWirePickMode();
    component.activateAltWirePick(new KeyboardEvent('keydown', { key: 'Alt' }));
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    component.cancelManualWirePick(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(component.wirePickActive()).toBe(true);
    component.deactivateAltWirePick(new KeyboardEvent('keyup', { key: 'Alt' }));
    expect(component.wirePickActive()).toBe(false);
  });

  it('clears held-Alt mode when the window loses focus', () => {
    component.activateAltWirePick(new KeyboardEvent('keydown', { key: 'Alt' }));
    expect(component.wirePickActive()).toBe(true);

    component.clearAltWirePick();

    expect(component.wirePickActive()).toBe(false);
  });

  it('normalizes visual order after clipboard paste', async () => {
    await component.onClipboardPasted({} as ClipboardPastedEvent);

    expect(normalizeVisualOrder).toHaveBeenCalledOnce();
  });

  it('creates a manual board-local jumper between two holes on one breadboard', () => {
    const board: Node<BoardNodeData> = {
      id: 'board-node-instance',
      type: NodeTemplateType.BoardNode,
      position: { x: 100, y: 200 },
      data: {
        type: 'board',
        boardId: 'breadboard-domain',
        label: 'Protoboard',
        surface: 'breadboard',
        rows: 10,
        cols: 12,
        pitch: 10,
        centerGap: 20,
      },
    };
    modelNodes = [board];
    const builder = component.config.linking?.finalEdgeDataBuilder as
      | ((edge: Edge) => Edge)
      | undefined;
    if (!builder) throw new Error('final edge builder not configured');

    const built = builder({
      id: 'jumper-1',
      source: board.id,
      sourcePort: 'hole:1:2',
      target: board.id,
      targetPort: 'hole:7:6',
      data: {},
    }) as Edge<WireEdgeData>;

    expect(built).toMatchObject({
      routing: 'polyline',
      routingMode: 'manual',
      points: [
        { x: 136, y: 226 },
        { x: 176, y: 306 },
      ],
      data: {
        type: 'wire',
        jumperBoardId: board.data.boardId,
        wireType: 'jumper',
        visualPlane: 20,
      },
    });
    expect(built.data.wireId).not.toBe('');
  });
});
