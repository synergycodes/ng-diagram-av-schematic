import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgDiagramPortComponent, type NgDiagramNodeTemplate, type Node } from 'ng-diagram';
import { junctionTapPortId } from '../model/canonical-project';
import { type JunctionNodeData } from '../model/interfaces';
import { OPERATIONAL_LIMITS } from '../model/operational-limits.mjs';

interface TapView {
  id: string;
  index: number;
}

/** Distance between adjacent tap positions on a rail, in diagram px. */
export const JUNCTION_TAP_SPACING = 20;

/** Padding above the first tap and below the last one. */
export const JUNCTION_PADDING = 10;

export function materializeJunctionTaps(rawCount: number) {
  const count = Number.isFinite(rawCount)
    ? Math.min(OPERATIONAL_LIMITS.maxJunctionTaps, Math.max(1, Math.trunc(rawCount)))
    : 1;
  return Array.from({ length: count }, (_, index) => ({
    id: junctionTapPortId(index),
    index,
  }));
}

/**
 * Renders a junction or rail: the explicit fan-out point of a net, sharing
 * the one ng-diagram canvas with boards, devices and wires.
 *
 * Every tap is a port, so a conductor lands on a visible position rather
 * than on an invisible shared anchor, and the node is selectable and carries
 * its own identification on the canvas (label, kind, the net it belongs to,
 * how many taps) — which is what "inspecionar no canvas unico" asks for
 * without a second view.
 *
 * The taps are *visual*: all of them are the same electrical point (see
 * `JunctionNodeData.taps`). That is why the node shows the net name once, at
 * the top, instead of once per tap.
 */
@Component({
  selector: 'app-junction-node',
  imports: [NgDiagramPortComponent],
  templateUrl: './junction-node.component.html',
  styleUrl: './junction-node.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.selected]': 'node().selected',
    '[class.junction-node-host--rail]': "data().kind === 'rail'",
  },
})
export class JunctionNodeComponent implements NgDiagramNodeTemplate<JunctionNodeData> {
  node = input.required<Node<JunctionNodeData>>();

  protected readonly data = computed(() => this.node().data);

  protected readonly taps = computed<TapView[]>(() => materializeJunctionTaps(this.data().taps));

  protected readonly height = computed(
    () => JUNCTION_PADDING * 2 + (this.taps().length - 1) * JUNCTION_TAP_SPACING,
  );

  protected readonly kindLabel = computed(() =>
    this.data().kind === 'rail' ? 'trilho' : 'junção',
  );
}
