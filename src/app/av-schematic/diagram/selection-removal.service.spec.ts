import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgDiagramModelService, NgDiagramSelectionService, type Edge, type Node } from 'ng-diagram';
import { describe, expect, it, vi } from 'vitest';
import { ElementMutationService } from '../properties-sidebar/element-mutation.service';
import { ConfirmDialogService } from '../shared/ui/confirm-dialog/confirm-dialog.service';
import { type DeviceNodeData, type WireEdgeData } from './model/interfaces';
import { removalRequest, SelectionRemovalService } from './selection-removal.service';

const device = (id: string, deviceId: string): Node<DeviceNodeData> => ({
  id,
  position: { x: 0, y: 0 },
  data: { type: 'device', deviceId, manufacturer: 'Shure', model: 'SM58', ports: [] },
});

const wire = (id: string, wireId: string, source: string, target: string): Edge<WireEdgeData> => ({
  id,
  source,
  target,
  data: { type: 'wire', wireId },
});

const mic = device('n1', 'MIC-1');
const mixer = device('n2', 'MIX-1');
const w1 = wire('e1', 'W-001', 'n1', 'n2');
const w2 = wire('e2', 'W-002', 'n1', 'n2');
const w3 = wire('e3', '', 'n2', 'n1');

const connectedWires = (id: string): number =>
  [w1, w2, w3].filter((e) => e.source === id || e.target === id).length;

describe('removalRequest', () => {
  it('is null for an empty selection', () => {
    expect(removalRequest([], [], connectedWires)).toBeNull();
  });

  it('names a single device and the wires that go with it', () => {
    expect(removalRequest([mic], [], connectedWires)).toEqual({
      title: 'Remove device?',
      message: '“MIC-1” and the 3 wires connected to it will be removed from the schematic.',
      confirmLabel: 'Remove device',
    });
  });

  it('keeps the message to the device when nothing is wired to it', () => {
    expect(removalRequest([mic], [], () => 0)).toEqual({
      title: 'Remove device?',
      message: '“MIC-1” will be removed from the schematic.',
      confirmLabel: 'Remove device',
    });
  });

  it('names a single wire by its wire id, falling back to the edge id', () => {
    expect(removalRequest([], [w1], connectedWires)).toEqual({
      title: 'Remove wire?',
      message: '“W-001” will be removed from the schematic.',
      confirmLabel: 'Remove wire',
    });
    expect(removalRequest([], [w3], connectedWires)?.message).toBe(
      '“e3” will be removed from the schematic.',
    );
  });

  it('summarises a mixed selection by kind and repeats the consequence', () => {
    expect(removalRequest([mic, mixer], [w1], connectedWires)).toEqual({
      title: 'Remove 3 items?',
      message:
        '2 devices and 1 wire will be removed from the schematic. Wires connected to a removed device are removed with it.',
      confirmLabel: 'Remove 3 items',
    });
    expect(removalRequest([], [w1, w2], connectedWires)).toEqual({
      title: 'Remove 2 items?',
      message: '2 wires will be removed from the schematic.',
      confirmLabel: 'Remove 2 items',
    });
  });
});

describe('SelectionRemovalService', () => {
  const setup = (nodes: Node[], edges: Edge[]) => {
    const mutation = { removeElements: vi.fn(() => Promise.resolve()) };
    const model = { getConnectedEdges: vi.fn(() => [w1, w2, w3]) };
    TestBed.configureTestingModule({
      providers: [
        SelectionRemovalService,
        ConfirmDialogService,
        { provide: NgDiagramModelService, useValue: model },
        { provide: NgDiagramSelectionService, useValue: { selection: signal({ nodes, edges }) } },
        { provide: ElementMutationService, useValue: mutation },
      ],
    });
    return {
      service: TestBed.inject(SelectionRemovalService),
      dialog: TestBed.inject(ConfirmDialogService),
      mutation,
    };
  };

  it('does nothing when the selection is empty', async () => {
    const { service, dialog, mutation } = setup([], []);
    await expect(service.removeSelection()).resolves.toBe(false);
    expect(dialog.request()).toBeNull();
    expect(mutation.removeElements).not.toHaveBeenCalled();
  });

  it('asks first and removes nothing when the user cancels', async () => {
    const { service, dialog, mutation } = setup([mic], []);
    const pending = service.removeSelection();
    expect(dialog.request()?.title).toBe('Remove device?');
    dialog.resolve(false);
    await expect(pending).resolves.toBe(false);
    expect(mutation.removeElements).not.toHaveBeenCalled();
  });

  it('removes the confirmed devices and wires through ElementMutationService', async () => {
    const { service, dialog, mutation } = setup([mic, mixer], [w1]);
    const pending = service.removeSelection();
    expect(dialog.request()?.title).toBe('Remove 3 items?');
    dialog.resolve(true);
    await expect(pending).resolves.toBe(true);
    expect(mutation.removeElements).toHaveBeenCalledWith(['n1', 'n2'], ['e1']);
  });

  describe('handleKeydown', () => {
    const press = (key: string, target: HTMLElement, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };
    const mountRoot = () => {
      const root = document.createElement('div');
      root.tabIndex = 0;
      document.body.appendChild(root);
      root.focus();
      return root;
    };

    it('opens the confirmation on Delete or Backspace when the canvas has focus', () => {
      const { service, dialog } = setup([mic], []);
      const root = mountRoot();
      const event = press('Delete', root);
      expect(service.handleKeydown(event, root)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(dialog.request()?.title).toBe('Remove device?');
      dialog.resolve(false);
      expect(service.handleKeydown(press('Backspace', root), root)).toBe(true);
      root.remove();
    });

    it('ignores the key while typing in a field, with modifiers, or when focus is elsewhere', () => {
      const { service, dialog } = setup([mic], []);
      const root = mountRoot();
      const input = document.createElement('input');
      root.appendChild(input);
      input.focus();
      expect(service.handleKeydown(press('Delete', input), root)).toBe(false);
      root.focus();
      expect(service.handleKeydown(press('Delete', root, { metaKey: true }), root)).toBe(false);
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      expect(service.handleKeydown(press('Delete', outside), root)).toBe(false);
      expect(dialog.request()).toBeNull();
      root.remove();
      outside.remove();
    });

    it('ignores other keys', () => {
      const { service, dialog } = setup([mic], []);
      const root = mountRoot();
      expect(service.handleKeydown(press('Enter', root), root)).toBe(false);
      expect(dialog.request()).toBeNull();
      root.remove();
    });
  });
});
