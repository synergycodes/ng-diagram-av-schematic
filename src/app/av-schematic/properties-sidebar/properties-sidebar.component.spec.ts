import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgDiagramModelService, type Edge, type Node } from 'ng-diagram';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DeviceNodeData, type WireEdgeData } from '../diagram/model/interfaces';
import { ConfirmDialogService } from '../shared/ui/confirm-dialog/confirm-dialog.service';
import { ElementMutationService } from './element-mutation.service';
import { PropertiesSidebarComponent } from './properties-sidebar.component';
import {
  PropertiesSidebarService,
  type SelectedWireDetails,
  type SidebarState,
} from './properties-sidebar.service';

const device: Node<DeviceNodeData> = {
  id: 'n1',
  position: { x: 0, y: 0 },
  data: {
    type: 'device',
    deviceId: 'MIC-1',
    manufacturer: 'Shure',
    model: 'SM58',
    ports: [{ id: 'p1', label: 'OUT', direction: 'output' }],
  },
};

const wire: Edge<WireEdgeData> = {
  id: 'e1',
  source: 'n1',
  sourcePort: 'p1',
  target: 'n2',
  targetPort: 'p2',
  data: { type: 'wire', wireId: 'W-001', wireType: 'audio' },
  routingMode: 'manual',
  selected: true,
};

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('PropertiesSidebarComponent removal actions', () => {
  const state = signal<SidebarState>('empty');
  const selectedNode = signal<Node<DeviceNodeData> | undefined>(undefined);
  const selectedEdge = signal<Edge<WireEdgeData> | undefined>(undefined);
  const selectedWireDetails = signal<SelectedWireDetails | null>(null);
  const mutation = {
    removeNode: vi.fn(() => Promise.resolve()),
    removeEdge: vi.fn(() => Promise.resolve()),
    resetEdgeRouting: vi.fn(),
    handleDeviceFieldChange: vi.fn(),
    handleWireFieldChange: vi.fn(),
  };
  const connectedEdges = vi.fn((): Edge[] => []);

  beforeEach(() => {
    vi.clearAllMocks();
    connectedEdges.mockReturnValue([]);
    state.set('empty');
    selectedNode.set(undefined);
    selectedEdge.set(undefined);
    selectedWireDetails.set(null);
    TestBed.configureTestingModule({
      providers: [
        ConfirmDialogService,
        {
          provide: PropertiesSidebarService,
          useValue: {
            isExpanded: signal(true),
            sidebarState: state,
            selectedNode,
            selectedEdge,
            selectedWireDetails,
            toggleSidebarVisibility: vi.fn(),
          },
        },
        { provide: ElementMutationService, useValue: mutation },
        { provide: NgDiagramModelService, useValue: { getConnectedEdges: connectedEdges } },
      ],
    });
  });

  const render = () => {
    const fixture = TestBed.createComponent(PropertiesSidebarComponent);
    fixture.detectChanges();
    return fixture;
  };

  const clickButton = (root: HTMLElement, text: string): void => {
    const button = Array.from(root.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === text,
    );
    if (!button) throw new Error(`button "${text}" not rendered`);
    button.click();
  };

  describe('Remove device', () => {
    beforeEach(() => {
      state.set('single-node');
      selectedNode.set(device);
    });

    it('asks for confirmation before deleting and names the device and its wires', async () => {
      connectedEdges.mockReturnValue([wire, { ...wire, id: 'e2' }]);
      const fixture = render();
      const dialog = TestBed.inject(ConfirmDialogService);

      clickButton(fixture.nativeElement as HTMLElement, 'Remove device');
      await flush();

      expect(mutation.removeNode).not.toHaveBeenCalled();
      expect(dialog.request()).toMatchObject({
        title: 'Remove device?',
        confirmLabel: 'Remove device',
      });
      expect(dialog.request()?.message).toContain('MIC-1');
      expect(dialog.request()?.message).toContain('2 wires');

      dialog.resolve(true);
      await flush();
      expect(mutation.removeNode).toHaveBeenCalledWith('n1');
    });

    it('keeps the device when the dialog is cancelled', async () => {
      const fixture = render();
      const dialog = TestBed.inject(ConfirmDialogService);

      clickButton(fixture.nativeElement as HTMLElement, 'Remove device');
      await flush();
      dialog.resolve(false);
      await flush();

      expect(mutation.removeNode).not.toHaveBeenCalled();
    });
  });

  describe('Remove wire', () => {
    beforeEach(() => {
      state.set('single-edge');
      selectedEdge.set(wire);
      selectedWireDetails.set({
        edge: wire,
        source: { deviceId: 'MIC-1', portLabel: 'OUT' },
        target: { deviceId: 'MIXER-1', portLabel: 'MIC 1' },
      });
    });

    it('asks for confirmation before deleting and names the wire', async () => {
      const fixture = render();
      const dialog = TestBed.inject(ConfirmDialogService);

      clickButton(fixture.nativeElement as HTMLElement, 'Remove wire');
      await flush();

      expect(mutation.removeEdge).not.toHaveBeenCalled();
      expect(dialog.request()).toMatchObject({
        title: 'Remove wire?',
        confirmLabel: 'Remove wire',
      });
      expect(dialog.request()?.message).toContain('W-001');

      dialog.resolve(true);
      await flush();
      expect(mutation.removeEdge).toHaveBeenCalledWith('e1');
    });

    it('keeps the wire when the dialog is cancelled', async () => {
      const fixture = render();
      const dialog = TestBed.inject(ConfirmDialogService);

      clickButton(fixture.nativeElement as HTMLElement, 'Remove wire');
      await flush();
      dialog.resolve(false);
      await flush();

      expect(mutation.removeEdge).not.toHaveBeenCalled();
    });

    it('resets routing without asking, since nothing is lost', () => {
      const fixture = render();
      const dialog = TestBed.inject(ConfirmDialogService);

      clickButton(fixture.nativeElement as HTMLElement, 'Reset routing');

      expect(dialog.request()).toBeNull();
      expect(mutation.resetEdgeRouting).toHaveBeenCalledWith('e1');
    });
  });
});
