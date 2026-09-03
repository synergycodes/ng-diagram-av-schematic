import { type Node, type Port } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { holeLocalPoint } from '../../model/board-geometry';
import { FOOTPRINT_PADDING_CELLS, footprintPinHoles } from '../../model/footprint-geometry';
import { type Footprint } from '../../model/footprint';
import { centerLeftPortBoxPosition, portFlowPosition } from './port-position';

function measuredNode(port: Port): Node {
  return {
    id: 'node-1',
    position: { x: 100, y: 200 },
    data: {},
    measuredPorts: [port],
  };
}

describe('portFlowPosition', () => {
  it('uses the measured left edge and vertical center for a centerLeft physical port', () => {
    const node = measuredNode({
      id: 'hole:0:0',
      nodeId: 'node-1',
      type: 'both',
      side: 'left',
      position: centerLeftPortBoxPosition({ x: 16, y: 18 }, 14),
      size: { width: 14, height: 14 },
    });

    expect(portFlowPosition(node, 'hole:0:0')).toEqual({ x: 116, y: 218 });
  });

  it('aligns a board port anchor with the hole geometry', () => {
    const board = { boardId: 'b', label: 'B', type: 'board' as const, rows: 3, cols: 4, pitch: 17 };
    const hole = { row: 1, col: 2 };
    const center = holeLocalPoint(board, hole);
    const node = measuredNode({
      id: 'hole:1:2',
      nodeId: 'node-1',
      type: 'both',
      side: 'left',
      position: centerLeftPortBoxPosition(center, 14),
      size: { width: 14, height: 14 },
    });

    expect(portFlowPosition(node, 'hole:1:2')).toEqual({
      x: 100 + center.x,
      y: 200 + center.y,
    });
  });

  it('aligns a footprint pin port with the rotated pin geometry', () => {
    const footprint: Footprint = {
      id: 'two-pin',
      label: 'Two pin',
      rows: 2,
      cols: 3,
      pins: [{ id: 'p1', label: 'P1', cell: { row: 0, col: 2 } }],
      shapes: [],
      bodyCells: [{ row: 0, col: 2 }],
    };
    const placement = { boardId: 'b', anchor: { row: 0, col: 0 }, rotation: 90 as const };
    const pin = footprintPinHoles(footprint, placement)[0];
    if (!pin) throw new Error('fixture pin missing');
    const pitch = 17;
    const padding = FOOTPRINT_PADDING_CELLS * pitch;
    const center = { x: padding + pin.cell.col * pitch, y: padding + pin.cell.row * pitch };
    const node = measuredNode({
      id: 'p1',
      nodeId: 'node-1',
      type: 'both',
      side: 'left',
      position: centerLeftPortBoxPosition(center, 14),
      size: { width: 14, height: 14 },
    });

    expect(portFlowPosition(node, 'p1')).toEqual({ x: 100 + center.x, y: 200 + center.y });
  });

  it.each([
    ['right', { x: 130, y: 227 }],
    ['top', { x: 123, y: 220 }],
    ['bottom', { x: 123, y: 234 }],
  ] as const)('anchors the %s side of a measured port box', (side, expected) => {
    const node = measuredNode({
      id: `port-${side}`,
      nodeId: 'node-1',
      type: 'both',
      side,
      position: { x: 16, y: 20 },
      size: { width: 14, height: 14 },
    });

    expect(portFlowPosition(node, `port-${side}`)).toEqual(expected);
  });
});
