import { Component, input, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { NgDiagramModelService, NgDiagramPortComponent, type Node, type Point } from 'ng-diagram';
import { afterEach, describe, expect, it } from 'vitest';
import { holeLocalPoint } from '../model/board-geometry';
import { breadboardRowIndex, createBreadboard830 } from '../model/breadboard';
import {
  footprintNodeSize,
  footprintPinHoles,
  placementNodePosition,
} from '../model/footprint-geometry';
import { RESISTOR_1K_FOOTPRINT, type Footprint } from '../model/footprint';
import {
  NodeTemplateType,
  type BoardNodeData,
  type DeviceNodeData,
  type DevicePlacement,
} from '../model/interfaces';
import { BoardPlacementService } from '../placement/board-placement.service';
import { FootprintNodeComponent, footprintPinViews } from './footprint-node.component';

const footprint: Footprint = {
  id: 'link',
  label: 'Link',
  rows: 1,
  cols: 2,
  pins: [
    { id: 'a', label: 'A', cell: { row: 0, col: 0 }, primary: true },
    { id: 'b', label: 'B', cell: { row: 0, col: 1 } },
  ],
  shapes: [],
};

describe('footprintPinViews', () => {
  it('keeps unseated footprint pins visible and connectable at the retained geometry', () => {
    const pins = footprintPinViews(footprint, 90, 17, [
      { id: 'a', label: 'A', direction: 'input' },
      { id: 'b', label: 'B', direction: 'output' },
    ]);

    expect(pins).toEqual([
      { id: 'a', label: 'A', x: 12.75, y: 12.75, port: true, primary: true },
      { id: 'b', label: 'B', x: 12.75, y: 29.75, port: true, primary: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Seated on a breadboard, across the central channel
// ---------------------------------------------------------------------------

const PITCH = 20;

const breadboard: Node<BoardNodeData> = {
  id: 'bb',
  type: NodeTemplateType.BoardNode,
  position: { x: 128, y: -64 },
  data: createBreadboard830({ boardId: 'bb', label: 'Breadboard 830', pitch: PITCH }),
};

/** A vertical link with one pin above the trench and one below it. */
const straddler: Footprint = {
  id: 'straddler',
  label: 'Straddler',
  rows: 2,
  cols: 1,
  pins: [
    { id: 'top', label: 'TOP', cell: { row: 0, col: 0 }, primary: true },
    { id: 'bottom', label: 'BOTTOM', cell: { row: 1, col: 0 } },
  ],
  shapes: [
    { kind: 'rect', x: -0.2, y: 0, width: 0.4, height: 1, fill: 'body' },
    { kind: 'text', x: 0, y: 0.5, text: 'U1', fill: 'silk' },
  ],
  bodyCells: [],
};

const placement: DevicePlacement = {
  boardId: 'bb',
  anchor: { row: breadboardRowIndex('F'), col: 6 },
  rotation: 0,
};

const device: Node<DeviceNodeData> = {
  id: 'straddle-1',
  type: NodeTemplateType.FootprintNode,
  position: placementNodePosition(
    { board: breadboard.data, position: breadboard.position },
    placement,
  ),
  data: {
    type: 'device',
    deviceId: 'STRADDLE-1',
    manufacturer: 'project',
    model: 'straddler',
    boardId: 'bb',
    footprintId: straddler.id,
    footprint: straddler,
    placement,
    ports: [
      { id: 'top', label: 'TOP', direction: 'input' },
      { id: 'bottom', label: 'BOTTOM', direction: 'output' },
    ],
  },
};

class PlacementStub {
  conflict() {
    return null;
  }
  conflictMessage() {
    return null;
  }
}

class ModelStub {
  readonly nodes = signal<Node[]>([breadboard]);
}

/**
 * `ng-diagram-port` needs the live canvas's input router, which does not exist
 * outside a mounted diagram. Only the port's *position* matters here, and that
 * comes from the styles this component sets on the element.
 */
@Component({
  // Standing in for a third-party element, so the repo's `app-` prefix rule
  // does not apply: the selector has to be the one the template binds.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ng-diagram-port',
  template: '<ng-content />',
})
class PortStubComponent {
  readonly id = input<string>();
  readonly type = input<string>();
  readonly side = input<string>();
  readonly originPoint = input<string>();
}

function render(node: Node<DeviceNodeData>): {
  fixture: ComponentFixture<FootprintNodeComponent>;
  host: HTMLElement;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [FootprintNodeComponent],
    providers: [
      { provide: BoardPlacementService, useClass: PlacementStub },
      { provide: NgDiagramModelService, useClass: ModelStub },
    ],
  });
  TestBed.overrideComponent(FootprintNodeComponent, {
    remove: { imports: [NgDiagramPortComponent] },
    add: { imports: [PortStubComponent] },
  });
  const fixture = TestBed.createComponent(FootprintNodeComponent);
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

/** Where a hole actually is, in diagram coordinates. */
function holePoint(pinId: string): Point {
  const pin = footprintPinHoles(straddler, placement).find(
    (candidate) => candidate.pinId === pinId,
  );
  if (!pin) throw new Error(`${pinId}: no hole`);
  const local = holeLocalPoint(breadboard.data, pin.hole);
  return { x: breadboard.position.x + local.x, y: breadboard.position.y + local.y };
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('FootprintNodeComponent seated across a breadboard channel', () => {
  it('puts every port on the hole its pin is actually in', () => {
    const { host } = render(device);
    const ports = [...host.querySelectorAll<HTMLElement>('.footprint-node__port')];
    expect(ports).toHaveLength(2);

    // The port box's left edge is the point it represents, and its top is half
    // a box above it (see centerLeftPortBoxPosition).
    ports.forEach((port, index) => {
      const expected = holePoint(index === 0 ? 'top' : 'bottom');
      const half = Number.parseFloat(port.style.height) / 2;
      expect(device.position.x + Number.parseFloat(port.style.left)).toBeCloseTo(expected.x);
      expect(device.position.y + Number.parseFloat(port.style.top) + half).toBeCloseTo(expected.y);
    });
  });

  it('separates the two pins by the channel, not by one pitch', () => {
    const { host } = render(device);
    const tops = [...host.querySelectorAll<HTMLElement>('.footprint-node__port')].map((port) =>
      Number.parseFloat(port.style.top),
    );
    expect(tops[1] - tops[0]).toBeCloseTo(PITCH + (breadboard.data.centerGap ?? 0));
  });

  it('stretches the drawn body across the trench instead of leaving it behind', () => {
    const { host } = render(device);
    const body = host.querySelector('rect');
    // Rows 0 and 1 are three cells apart once the channel opens between them.
    expect(Number(body?.getAttribute('height'))).toBeCloseTo(3);
  });

  it('grows the node box by the whole centerGap', () => {
    const { host } = render(device);
    const box = host.querySelector<HTMLElement>('.footprint-node');
    const ungapped = 1 * PITCH + 2 * 0.75 * PITCH;
    expect(Number.parseFloat(box?.style.height ?? '0')).toBeCloseTo(
      ungapped + (breadboard.data.centerGap ?? 0),
    );
  });

  it('turns a label with the part without shearing it', () => {
    const turned = render({
      ...device,
      data: { ...device.data, placement: { ...placement, rotation: 90 } },
    });
    const text = turned.host.querySelector('text');
    expect(text?.getAttribute('transform')).toMatch(/^rotate\(90 /);
  });

  it('leaves a footprint on a channel-free board exactly as it was', () => {
    const perfboard: Node<BoardNodeData> = {
      id: 'perf',
      type: NodeTemplateType.BoardNode,
      position: { x: 0, y: 0 },
      data: {
        type: 'board',
        boardId: 'perf',
        label: 'Perfboard',
        rows: 6,
        cols: 12,
        pitch: PITCH,
      },
    };
    const seated: Node<DeviceNodeData> = {
      ...device,
      position: { x: 0, y: 0 },
      data: {
        ...device.data,
        boardId: 'perf',
        placement: { boardId: 'perf', anchor: { row: 1, col: 2 }, rotation: 0 },
      },
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FootprintNodeComponent],
      providers: [
        { provide: BoardPlacementService, useClass: PlacementStub },
        {
          provide: NgDiagramModelService,
          useValue: { nodes: signal<Node[]>([perfboard]) },
        },
      ],
    });
    TestBed.overrideComponent(FootprintNodeComponent, {
      remove: { imports: [NgDiagramPortComponent] },
      add: { imports: [PortStubComponent] },
    });
    const fixture = TestBed.createComponent(FootprintNodeComponent);
    fixture.componentRef.setInput('node', seated);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const tops = [...host.querySelectorAll<HTMLElement>('.footprint-node__port')].map((port) =>
      Number.parseFloat(port.style.top),
    );
    expect(tops[1] - tops[0]).toBeCloseTo(PITCH);
    expect(Number(host.querySelector('rect')?.getAttribute('height'))).toBeCloseTo(1);
  });
});

describe('FootprintNodeComponent wholly below a breadboard channel', () => {
  it('keeps negative artwork inside the rigid viewBox in every rotation', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const resistorPlacement: DevicePlacement = {
        boardId: 'bb',
        anchor: { row: breadboardRowIndex('E'), col: 10 },
        rotation,
      };
      const resistor: Node<DeviceNodeData> = {
        id: `resistor-${rotation}`,
        type: NodeTemplateType.FootprintNode,
        position: placementNodePosition(
          { board: breadboard.data, position: breadboard.position },
          resistorPlacement,
        ),
        data: {
          type: 'device',
          deviceId: 'R1',
          manufacturer: 'generic',
          model: '1 kOhm',
          boardId: 'bb',
          footprintId: RESISTOR_1K_FOOTPRINT.id,
          footprint: RESISTOR_1K_FOOTPRINT,
          placement: resistorPlacement,
          ports: [
            { id: 'a', label: '1', direction: 'input' },
            { id: 'b', label: '2', direction: 'output' },
          ],
        },
      };

      const { host } = render(resistor);
      const svg = host.querySelector('svg');
      const label = svg?.querySelector('text');
      const viewBox = (svg?.getAttribute('viewBox') ?? '').split(' ').map(Number);
      const [left, top, width, height] = viewBox;
      const labelX = Number(label?.getAttribute('x'));
      const labelY = Number(label?.getAttribute('y'));
      const box = host.querySelector<HTMLElement>('.footprint-node');
      const rigidSize = footprintNodeSize(RESISTOR_1K_FOOTPRINT, rotation, PITCH);

      expect(viewBox).toHaveLength(4);
      expect(labelX, `${rotation} degrees x`).toBeGreaterThanOrEqual(left);
      expect(labelX, `${rotation} degrees x`).toBeLessThanOrEqual(left + width);
      expect(labelY, `${rotation} degrees y`).toBeGreaterThanOrEqual(top);
      expect(labelY, `${rotation} degrees y`).toBeLessThanOrEqual(top + height);
      expect(Number.parseFloat(box?.style.width ?? '0')).toBeCloseTo(rigidSize.width);
      expect(Number.parseFloat(box?.style.height ?? '0')).toBeCloseTo(rigidSize.height);
    }
  });
});
