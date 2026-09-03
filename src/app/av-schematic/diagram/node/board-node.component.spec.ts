import { Component, input } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { NgDiagramPortComponent, type Node } from 'ng-diagram';
import { afterEach, describe, expect, it } from 'vitest';
import { BOARD_MARGIN, holeLocalPoint } from '../model/board-geometry';
import { boardHoleRadius, boardRailBands } from '../model/board-surface';
import { NodeTemplateType, type BoardNodeData } from '../model/interfaces';
import { BoardPlacementService } from '../placement/board-placement.service';
import { BoardNodeComponent } from './board-node.component';
import { BoardJumperCreationService } from '../board-jumper-creation.service';

const PITCH = 20;

/**
 * A miniature solderless breadboard: two rails, two terminal rows, a channel
 * and one column group sealed inside the body. Small enough to assert over
 * every rendered element, and shaped exactly like the 830-point board -
 * `model/board-surface.spec.ts` covers that board's own proportions.
 */
const breadboard: BoardNodeData = {
  type: 'board',
  boardId: 'bb',
  label: 'Mini breadboard',
  surface: 'breadboard',
  rows: 5,
  cols: 4,
  pitch: PITCH,
  centerGap: PITCH * 2,
  rowLabels: ['top-', 'top+', 'B', 'A', ''],
  holes: [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
    { row: 2, col: 0 },
    { row: 3, col: 0 },
  ],
  traces: [
    {
      id: 'clip',
      label: 'B1-A1',
      internal: true,
      segments: [{ from: { row: 2, col: 0 }, to: { row: 3, col: 0 } }],
    },
    {
      id: 'rail',
      label: 'top+',
      internal: true,
      segments: [{ from: { row: 1, col: 0 }, to: { row: 1, col: 1 } }],
    },
  ],
};

/** The same grid as bare drilled substrate: no surface, exposed copper. */
const perfboard: BoardNodeData = {
  type: 'board',
  boardId: 'perf',
  label: 'Perfboard',
  rows: 3,
  cols: 4,
  pitch: PITCH,
  traces: [
    {
      id: 'vcc',
      label: 'L1',
      net: 'VCC',
      segments: [{ from: { row: 0, col: 0 }, to: { row: 0, col: 3 } }],
    },
  ],
};

class PlacementStub {
  conflictHoleKeys(): ReadonlySet<string> {
    return new Set<string>();
  }
}

/**
 * `ng-diagram-port` reaches for the live diagram's input router, which only
 * exists inside a mounted canvas. The board's own rendering is what is under
 * test here, so the port is stood in for by a tag that keeps the same
 * selector, inputs and projected content - port *placement* is covered by
 * model/board-ports.ts and the round-trip specs.
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

function render(data: BoardNodeData): {
  fixture: ComponentFixture<BoardNodeComponent>;
  host: HTMLElement;
} {
  // Each render is its own test module, so a test may draw the same board at
  // two pitches and compare them.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [BoardNodeComponent],
    providers: [
      { provide: BoardPlacementService, useClass: PlacementStub },
      {
        provide: BoardJumperCreationService,
        useValue: { handles: () => false, isStart: () => false, selectHole: () => false },
      },
    ],
  });
  TestBed.overrideComponent(BoardNodeComponent, {
    remove: { imports: [NgDiagramPortComponent] },
    add: { imports: [PortStubComponent] },
  });
  const fixture = TestBed.createComponent(BoardNodeComponent);
  const node: Node<BoardNodeData> = {
    id: data.boardId,
    type: NodeTemplateType.BoardNode,
    position: { x: 0, y: 0 },
    data,
  };
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

function numbers(host: HTMLElement, selector: string, attribute: string): number[] {
  return [...host.querySelectorAll(selector)].map((element) =>
    Number(element.getAttribute(attribute)),
  );
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('BoardNodeComponent - solderless breadboard', () => {
  it('marks the body as a breadboard so the plastic replaces the substrate', () => {
    const { host } = render(breadboard);
    expect(host.querySelector('.board-node--breadboard')).not.toBeNull();
  });

  it('hides copper sealed inside the body, drawing no run and no label for it', () => {
    const { host } = render(breadboard);
    expect(host.querySelectorAll('.board-node__trace')).toHaveLength(0);
    expect(host.querySelectorAll('.board-node__trace-run')).toHaveLength(0);
    expect(host.querySelectorAll('.board-node__trace-label')).toHaveLength(0);
  });

  it('mints a port for every hole and none for an internal group', () => {
    const { host } = render(breadboard);
    // 6 holes, 6 ports: no `trace:<id>` pad covers a hole the way the exposed
    // copper of a perfboard does.
    expect(host.querySelectorAll('.board-node__port--hole')).toHaveLength(6);
    expect(host.querySelectorAll('.board-node__port--trace')).toHaveLength(0);
  });

  it('prints one rail band per +/- row, centred on that row', () => {
    const { host } = render(breadboard);
    const bands = [...host.querySelectorAll('.board-node__rail-band')];
    expect(bands).toHaveLength(2);
    expect(bands[0].classList).toContain('board-node__rail-band--negative');
    expect(bands[1].classList).toContain('board-node__rail-band--positive');

    const expected = boardRailBands(breadboard);
    expect(numbers(host, '.board-node__rail-band', 'y')).toEqual(expected.map((band) => band.y));
    expect(numbers(host, '.board-node__rail-band', 'height')).toEqual(
      expected.map((band) => band.height),
    );
  });

  it('brackets the rail pair with a polarity stripe on each outer side', () => {
    const { host } = render(breadboard);
    const stripes = [...host.querySelectorAll('.board-node__bus-guide')];
    expect(stripes).toHaveLength(2);
    expect(stripes[0].classList).toContain('board-node__bus-guide--negative');
    expect(stripes[1].classList).toContain('board-node__bus-guide--positive');

    const topRowY = holeLocalPoint(breadboard, { row: 0, col: 0 }).y;
    const plusRowY = holeLocalPoint(breadboard, { row: 1, col: 0 }).y;
    // Blue above the `-` rail, red below the `+` rail: the pair is enclosed.
    expect(Number(stripes[0].getAttribute('y1'))).toBeLessThan(topRowY);
    expect(Number(stripes[1].getAttribute('y1'))).toBeGreaterThan(plusRowY);
  });

  it('sinks the channel between the two halves without swallowing the clearance', () => {
    const { host } = render(breadboard);
    const channel = host.querySelector('.board-node__center-gap');
    expect(channel).not.toBeNull();
    expect(breadboard.centerGap).toBe(PITCH * 2);
    expect(Number(channel?.getAttribute('height'))).toBeLessThan(PITCH * 2);
  });

  it('silks the rails as +/- and the terminal rows by name, in both margins', () => {
    const { host } = render(breadboard);
    const marks = [...host.querySelectorAll('.board-node__row-mark')];
    // Four named rows, twice each; the unnamed spacer row silks nothing.
    expect(marks).toHaveLength(8);
    expect(marks.map((mark) => mark.textContent?.trim())).toEqual([
      '−',
      '−',
      '+',
      '+',
      'B',
      'B',
      'A',
      'A',
    ]);
  });

  it('scales every printed marking with the pitch', () => {
    const fontOf = (host: HTMLElement) =>
      Number(host.querySelector('.board-node__row-mark')?.getAttribute('font-size'));
    const radiusOf = (host: HTMLElement) =>
      Number(host.querySelector('.board-node__hole')?.getAttribute('r'));

    const narrow = render(breadboard).host;
    const narrowFont = fontOf(narrow);
    const narrowRadius = radiusOf(narrow);
    expect(narrowRadius).toBeCloseTo(boardHoleRadius(breadboard));

    const wide = render({ ...breadboard, pitch: PITCH * 2 }).host;
    // Doubling the pitch doubles the silk-screen and the holes with it: no
    // marking is pinned to a pixel constant.
    expect(fontOf(wide)).toBeCloseTo(narrowFont * 2);
    expect(radiusOf(wide)).toBeCloseTo(narrowRadius * 2);
  });

  it('outlines a rail hole more heavily than a hole in the terminal strip', () => {
    const { host } = render(breadboard);
    const holes = [...host.querySelectorAll('.board-node__hole')];
    const rail = holes.find((hole) => hole.classList.contains('board-node__hole--positive'));
    const terminal = holes.find((hole) => hole.classList.length === 1);
    expect(rail).toBeDefined();
    expect(terminal).toBeDefined();
    expect(Number(rail?.getAttribute('stroke-width'))).toBeGreaterThan(
      Number(terminal?.getAttribute('stroke-width')),
    );
  });

  it('keeps the row names inside the board body', () => {
    const { host } = render(breadboard);
    const left = numbers(host, '.board-node__row-mark[text-anchor="end"]', 'x');
    expect(left.every((x) => x > 0 && x < BOARD_MARGIN)).toBe(true);
  });

  it('prints the reference column ruler at 5, 10 and onward, without an extra 1', () => {
    const { host } = render({ ...breadboard, cols: 12 });
    const ticks = [...host.querySelectorAll('.board-node__column-tick')].map((tick) =>
      tick.textContent?.trim(),
    );
    expect(ticks).toEqual(['5', '10']);
  });
});

describe('BoardNodeComponent - perfboard', () => {
  it('keeps the bare substrate, with no breadboard modifier or plastic printing', () => {
    const { host } = render(perfboard);
    expect(host.querySelector('.board-node')).not.toBeNull();
    expect(host.querySelector('.board-node--breadboard')).toBeNull();
    expect(host.querySelectorAll('.board-node__rail-band')).toHaveLength(0);
    expect(host.querySelectorAll('.board-node__row-mark')).toHaveLength(0);
    expect(host.querySelectorAll('.board-node__center-gap')).toHaveLength(0);
  });

  it('still draws its exposed copper, with a label and a landing pad', () => {
    const { host } = render(perfboard);
    expect(host.querySelectorAll('.board-node__trace-run')).toHaveLength(1);
    expect(host.querySelector('.board-node__trace-label')?.textContent?.trim()).toBe('VCC');
    expect(host.querySelectorAll('.board-node__port--trace')).toHaveLength(1);
  });

  it('draws its holes at the shared default diameter, unchanged by the variant', () => {
    const { host } = render(perfboard);
    expect(Number(host.querySelector('.board-node__hole')?.getAttribute('r'))).toBe(
      boardHoleRadius(perfboard),
    );
    expect(host.querySelectorAll('.board-node__hole')).toHaveLength(12);
  });
});
