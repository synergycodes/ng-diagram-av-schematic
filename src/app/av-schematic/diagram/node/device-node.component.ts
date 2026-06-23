import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  NgDiagramPortComponent,
  NgDiagramSelectionService,
  type NgDiagramNodeTemplate,
  type Node,
} from 'ng-diagram';
import { PortFocusService } from '../port-focus.service';
import { RelinkTargetHighlightService } from '../edge-relinking/relink-target-highlight.service';
import { type DeviceNodeData, type DevicePort } from '../model/interfaces';

@Component({
  selector: 'app-device-node',
  imports: [NgDiagramPortComponent],
  templateUrl: './device-node.component.html',
  styleUrl: './device-node.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.selected]': 'node().selected',
    '[class.edge-highlighted]': 'edgeHighlighted()',
    '[class.is-link-target]': 'linkTargetPortId() !== null',
  },
})
export class DeviceNodeComponent implements NgDiagramNodeTemplate<DeviceNodeData> {
  private readonly selectionService = inject(NgDiagramSelectionService);
  private readonly portFocusService = inject(PortFocusService);
  private readonly relinkHighlight = inject(RelinkTargetHighlightService);

  node = input.required<Node<DeviceNodeData>>();

  protected readonly data = computed(() => this.node().data);

  protected readonly inputPorts = computed(() => this.portsByDirection('input'));
  protected readonly outputPorts = computed(() => this.portsByDirection('output'));

  protected readonly edgeHighlighted = computed(() => {
    const nodeId = this.node().id;
    return this.selectionService
      .selection()
      .edges.some((e) => e.source === nodeId || e.target === nodeId);
  });

  protected readonly linkTargetPortId = computed(() => {
    const target = this.relinkHighlight.target();
    return target?.nodeId === this.node().id ? target.portId : null;
  });

  protected onPortDblClick(portId: string): void {
    this.portFocusService.navigateToConnectedPort(portId, this.node().id);
  }

  private portsByDirection(direction: DevicePort['direction']): DevicePort[] {
    return this.data().ports.filter((p) => p.direction === direction);
  }
}
