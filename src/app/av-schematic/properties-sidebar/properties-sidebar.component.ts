import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
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
import { JunctionFormComponent } from './components/junction-form/junction-form.component';
import { JunctionFormService } from './components/junction-form/junction-form.service';
import {
  ON_JUNCTION_FIELD_CHANGE,
  type JunctionFieldChange,
} from './components/junction-form/junction-form.mappers';
import { MAX_VISUAL_PLANE, MIN_VISUAL_PLANE } from '../diagram/model/visual-planes';
import { BoardJumperCreationService } from '../diagram/board-jumper-creation.service';

@Component({
  selector: 'app-properties-sidebar',
  imports: [
    SidebarHeaderComponent,
    SidebarPlaceholderComponent,
    DeviceFormComponent,
    WireFormComponent,
    JunctionFormComponent,
  ],
  providers: [
    DeviceFormService,
    WireFormService,
    JunctionFormService,
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
          void mutation.handleWireFieldChange(change);
        };
      },
    },
    {
      provide: ON_JUNCTION_FIELD_CHANGE,
      useFactory: () => {
        const mutation = inject(ElementMutationService);
        return (change: JunctionFieldChange) => {
          mutation.handleJunctionFieldChange(change);
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
  protected readonly jumperCreation = inject(BoardJumperCreationService);

  protected readonly isExpanded = this.sidebarService.isExpanded;
  protected readonly state = this.sidebarService.sidebarState;
  protected readonly selectedNode = this.sidebarService.selectedNode;
  protected readonly selectedBoard = this.sidebarService.selectedBoard;
  protected readonly selectedJunction = this.sidebarService.selectedJunction;
  protected readonly selectedWireDetails = this.sidebarService.selectedWireDetails;
  protected readonly selectedVisualElement = this.sidebarService.selectedVisualElement;
  protected readonly minVisualPlane = MIN_VISUAL_PLANE;
  protected readonly maxVisualPlane = MAX_VISUAL_PLANE;

  protected readonly headerSubtitle = computed(() => {
    if (this.state() === 'single-node') return this.selectedNode()?.data.deviceId ?? '';
    if (this.state() === 'single-board') return this.selectedBoard()?.data.label ?? '';
    if (this.state() === 'single-junction') return this.selectedJunction()?.data.label ?? '';
    return '';
  });

  protected onHeaderToggle(): void {
    this.sidebarService.toggleSidebarVisibility();
  }

  protected onRemoveNode(): void {
    const nodeId = this.sidebarService.selectedNode()?.id;
    if (nodeId) {
      void this.elementMutationService.removeNode(nodeId);
    }
  }

  protected onRemoveBoard(): void {
    const nodeId = this.sidebarService.selectedBoard()?.id;
    if (nodeId) void this.elementMutationService.removeNode(nodeId);
  }

  protected onToggleJumperCreation(): void {
    const board = this.sidebarService.selectedBoard();
    if (board) this.jumperCreation.toggle(board);
  }

  protected onVisualPlaneChange(event: Event): void {
    const selected = this.selectedVisualElement();
    const input = event.target as HTMLInputElement | null;
    if (!selected || !input) return;
    const value = Number(input.value);
    if (!Number.isSafeInteger(value)) return;
    void this.elementMutationService.setVisualPlane(
      selected.modelKind,
      selected.elementKind,
      selected.id,
      value,
    );
  }

  protected onRemoveJunction(): void {
    const nodeId = this.sidebarService.selectedJunction()?.id;
    if (nodeId) {
      void this.elementMutationService.removeNode(nodeId);
    }
  }

  protected onRemoveWire(): void {
    const edgeId = this.sidebarService.selectedEdge()?.id;
    if (edgeId) {
      void this.elementMutationService.removeEdge(edgeId);
    }
  }

  protected onResetWireRouting(): void {
    const edgeId = this.sidebarService.selectedEdge()?.id;
    if (edgeId) {
      this.elementMutationService.resetEdgeRouting(edgeId);
    }
  }
}
