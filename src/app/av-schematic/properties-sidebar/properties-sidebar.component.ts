import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SelectionRemovalService } from '../diagram/selection-removal.service';
import { DeviceFormComponent } from '../device-form/device-form.component';
import { ON_DEVICE_FIELD_CHANGE, type DeviceFieldChange } from '../device-form/device-form.mappers';
import { DeviceFormService } from '../device-form/device-form.service';
import { SidebarHeaderComponent } from './components/sidebar-header/sidebar-header.component';
import { SidebarPlaceholderComponent } from './components/sidebar-placeholder/sidebar-placeholder.component';
import { WireFormComponent } from './components/wire-form/wire-form.component';
import {
  ON_WIRE_FIELD_CHANGE,
  type WireFieldChange,
} from './components/wire-form/wire-form.mappers';
import { WireFormService } from './components/wire-form/wire-form.service';
import { ElementMutationService } from './element-mutation.service';
import { PropertiesSidebarService } from './properties-sidebar.service';

@Component({
  selector: 'app-properties-sidebar',
  imports: [
    SidebarHeaderComponent,
    SidebarPlaceholderComponent,
    DeviceFormComponent,
    WireFormComponent,
  ],
  providers: [
    DeviceFormService,
    WireFormService,
    {
      provide: ON_DEVICE_FIELD_CHANGE,
      useFactory: () => {
        const mutation = inject(ElementMutationService);
        return (change: DeviceFieldChange) => {
          mutation.handleDeviceFieldChange(change);
        };
      },
    },
    {
      provide: ON_WIRE_FIELD_CHANGE,
      useFactory: () => {
        const mutation = inject(ElementMutationService);
        return (change: WireFieldChange) => {
          mutation.handleWireFieldChange(change);
        };
      },
    },
  ],
  templateUrl: './properties-sidebar.component.html',
  styleUrl: './properties-sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.expanded]': 'isExpanded()' },
})
export class PropertiesSidebarComponent {
  private readonly sidebarService = inject(PropertiesSidebarService);
  private readonly elementMutationService = inject(ElementMutationService);
  private readonly selectionRemoval = inject(SelectionRemovalService);

  protected readonly isExpanded = this.sidebarService.isExpanded;
  protected readonly state = this.sidebarService.sidebarState;
  protected readonly selectedNode = this.sidebarService.selectedNode;
  protected readonly selectedWireDetails = this.sidebarService.selectedWireDetails;

  protected readonly headerSubtitle = computed(() =>
    this.state() === 'single-node' ? (this.selectedNode()?.data.deviceId ?? '') : '',
  );

  protected onHeaderToggle(): void {
    this.sidebarService.toggleSidebarVisibility();
  }

  /** Removing a device also drops its wires, so it asks first (design-OS Modal guideline). */
  protected async onRemoveNode(): Promise<void> {
    const node = this.sidebarService.selectedNode();
    if (node && (await this.selectionRemoval.confirmRemoval([node], []))) {
      await this.elementMutationService.removeNode(node.id);
    }
  }

  protected async onRemoveWire(): Promise<void> {
    const edge = this.sidebarService.selectedEdge();
    if (edge && (await this.selectionRemoval.confirmRemoval([], [edge]))) {
      await this.elementMutationService.removeEdge(edge.id);
    }
  }

  protected onResetWireRouting(): void {
    const edgeId = this.sidebarService.selectedEdge()?.id;
    if (edgeId) {
      this.elementMutationService.resetEdgeRouting(edgeId);
    }
  }
}
