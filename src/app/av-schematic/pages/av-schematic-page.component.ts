import { ChangeDetectionStrategy, Component } from '@angular/core';
import { provideNgDiagram } from 'ng-diagram';
import { DiagramComponent } from '../diagram/diagram.component';
import { EdgeCommandDispatcher } from '../diagram/edge-reshaping/commands';
import { EdgeReshapeHandler } from '../diagram/edge-reshaping/handlers/edge-reshape.handler';
import { RelinkEndpointHandler } from '../diagram/edge-relinking/relink-endpoint.handler';
import { RelinkTargetHighlightService } from '../diagram/edge-relinking/relink-target-highlight.service';
import { DanglingEdgeService } from '../diagram/dangling-edge-creation/dangling-edge.service';
import { TempEdgePointsService } from '../diagram/dangling-edge-creation/temp-edge-points.service';
import { NodeVisibilityConfigService } from '../diagram/node-visibility/node-visibility-config.service';
import { PortFocusService } from '../diagram/port-focus.service';
import { SelectionRemovalService } from '../diagram/selection-removal.service';
import { ViewportAnimationService } from '../diagram/viewport-animation.service';
import { ViewportBoundsDirective } from '../diagram/node-visibility/viewport-bounds.directive';
import { ViewportOverlayDirective } from '../diagram/node-visibility/viewport-overlay.directive';
import { LibrarySidebarComponent } from '../library-sidebar/library-sidebar.component';
import { LibraryService } from '../library-sidebar/library.service';
import { MinimapPanelComponent } from '../minimap-panel/minimap-panel.component';
import { DiagramExportService } from '../export/diagram-export.service';
import { ElementMutationService } from '../properties-sidebar/element-mutation.service';
import { PropertiesSidebarComponent } from '../properties-sidebar/properties-sidebar.component';
import { PropertiesSidebarService } from '../properties-sidebar/properties-sidebar.service';
import { ConfirmDialogComponent } from '../shared/ui/confirm-dialog/confirm-dialog.component';
import { ConfirmDialogService } from '../shared/ui/confirm-dialog/confirm-dialog.service';
import { TopNavbarComponent } from '../top-navbar/top-navbar.component';

@Component({
  selector: 'app-av-schematic-page',
  imports: [
    DiagramComponent,
    LibrarySidebarComponent,
    PropertiesSidebarComponent,
    TopNavbarComponent,
    MinimapPanelComponent,
    ConfirmDialogComponent,
    ViewportBoundsDirective,
    ViewportOverlayDirective,
  ],
  templateUrl: './av-schematic-page.component.html',
  styleUrl: './av-schematic-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    provideNgDiagram(),
    PropertiesSidebarService,
    ElementMutationService,
    SelectionRemovalService,
    ConfirmDialogService,
    NodeVisibilityConfigService,
    ViewportAnimationService,
    PortFocusService,
    LibraryService,
    DiagramExportService,
    EdgeCommandDispatcher,
    EdgeReshapeHandler,
    TempEdgePointsService,
    DanglingEdgeService,
    RelinkTargetHighlightService,
    RelinkEndpointHandler,
  ],
})
export class AvSchematicPageComponent {}
