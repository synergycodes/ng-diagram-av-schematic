import { inject, Injectable } from '@angular/core';
import {
  NgDiagramModelService,
  NgDiagramSelectionService,
  type Edge,
  type Node,
} from 'ng-diagram';
import { ElementMutationService } from '../properties-sidebar/element-mutation.service';
import {
  ConfirmDialogService,
  type ConfirmDialogOptions,
} from '../shared/ui/confirm-dialog/confirm-dialog.service';
import { isDeviceNode, isWireEdge } from './model/guards';
import { type DeviceNodeData, type WireEdgeData } from './model/interfaces';

/** Number of wires attached to the device with this node id. */
type ConnectedWiresOf = (nodeId: string) => number;

const count = (n: number, noun: string): string => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;

const single = (
  nodes: Node<DeviceNodeData>[],
  edges: Edge<WireEdgeData>[],
  connectedWiresOf: ConnectedWiresOf,
): ConfirmDialogOptions => {
  const node = nodes[0];
  if (node) {
    const wires = connectedWiresOf(node.id);
    const name = `“${node.data.deviceId}”`;
    return {
      title: 'Remove device?',
      message:
        wires > 0
          ? `${name} and the ${count(wires, 'wire')} connected to it will be removed from the schematic.`
          : `${name} will be removed from the schematic.`,
      confirmLabel: 'Remove device',
    };
  }
  const edge = edges[0];
  return {
    title: 'Remove wire?',
    message: `“${edge.data.wireId || edge.id}” will be removed from the schematic.`,
    confirmLabel: 'Remove wire',
  };
};

const multiple = (nodes: Node[], edges: Edge[]): ConfirmDialogOptions => {
  const summary = [
    nodes.length > 0 ? count(nodes.length, 'device') : '',
    edges.length > 0 ? count(edges.length, 'wire') : '',
  ]
    .filter(Boolean)
    .join(' and ');
  const note = nodes.length > 0 ? ' Wires connected to a removed device are removed with it.' : '';
  const label = `Remove ${count(nodes.length + edges.length, 'item')}`;
  return {
    title: `${label}?`,
    message: `${summary} will be removed from the schematic.${note}`,
    confirmLabel: label,
  };
};

/**
 * The confirmation for removing `nodes` and `edges`, worded the same for the sidebar's Remove
 * buttons and the Delete key so both paths promise the same outcome. Null when nothing is
 * removable.
 */
export const removalRequest = (
  nodes: Node[],
  edges: Edge[],
  connectedWiresOf: ConnectedWiresOf,
): ConfirmDialogOptions | null => {
  const devices = nodes.filter(isDeviceNode);
  const wires = edges.filter(isWireEdge);
  const total = devices.length + wires.length;
  if (total === 0) return null;
  return total === 1 ? single(devices, wires, connectedWiresOf) : multiple(devices, wires);
};

const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Keyboard removal of the current selection. ngDiagram's own `deleteSelection` and `cut`
 * shortcuts are unbound in the diagram config so that Delete and Backspace come here instead:
 * the user confirms first (design-OS Modal guideline), then the removal runs through
 * `ElementMutationService` like the sidebar buttons.
 */
@Injectable()
export class SelectionRemovalService {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly selectionService = inject(NgDiagramSelectionService);
  private readonly mutation = inject(ElementMutationService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  /** Returns true when a removal-key press inside `diagramRoot` was consumed. */
  handleKeydown(event: KeyboardEvent, diagramRoot: HTMLElement): boolean {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return false;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
    if (!diagramRoot.contains(document.activeElement) || isTextEntry(event.target)) return false;
    event.preventDefault();
    void this.removeSelection();
    return true;
  }

  /** Confirms and removes the selected devices and wires; resolves true only when something was removed. */
  async removeSelection(): Promise<boolean> {
    const { nodes, edges } = this.selectionService.selection();
    const devices = nodes.filter(isDeviceNode);
    const wires = edges.filter(isWireEdge);
    const request = removalRequest(devices, wires, (id) => this.connectedWires(id));
    if (!request) return false;
    const confirmed = await this.confirmDialog.confirm(request);
    if (!confirmed) return false;
    await this.mutation.removeElements(
      devices.map((node) => node.id),
      wires.map((edge) => edge.id),
    );
    return true;
  }

  private connectedWires(nodeId: string): number {
    return this.modelService.getConnectedEdges(nodeId).length;
  }
}
