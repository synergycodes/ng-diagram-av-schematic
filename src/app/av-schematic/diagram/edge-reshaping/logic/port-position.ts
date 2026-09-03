import { type Node, type Point, type Port } from 'ng-diagram';

/** CSS box position that makes a center-left port anchor land on `center`. */
export const centerLeftPortBoxPosition = (center: Point, size: number): Point => ({
  x: center.x,
  y: center.y - size / 2,
});

const portCenter = (port: Port, node: Node): Point => {
  const x = (port.position?.x ?? 0) + node.position.x;
  const y = (port.position?.y ?? 0) + node.position.y;
  const width = port.size?.width ?? 0;
  const height = port.size?.height ?? 0;

  switch (port.side) {
    case 'left':
      return { x, y: y + height / 2 };
    case 'right':
      return { x: x + width, y: y + height / 2 };
    case 'top':
      return { x: x + width / 2, y };
    case 'bottom':
      return { x: x + width / 2, y: y + height };
  }
};

// Flow-space centre of a port, or null when node/port/measurement isn't
// available. The single source of truth for "where does an edge attach".
export const portFlowPosition = (
  node: Node | null | undefined,
  portId: string | undefined,
): Point | null => {
  if (!node || !portId) return null;
  const port = node.measuredPorts?.find((p) => p.id === portId);
  if (!port) return null;
  return portCenter(port, node);
};
