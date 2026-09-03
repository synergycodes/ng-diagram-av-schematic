import { ChangeDetectionStrategy, Component } from '@angular/core';
import { provideNgDiagram } from 'ng-diagram';
import { DiagramComponent } from '../diagram/diagram.component';
import { EdgeCommandDispatcher } from '../diagram/edge-reshaping/commands';
import { EdgeBendHandler } from '../diagram/edge-reshaping/handlers/edge-bend.handler';
import { EdgeReshapeHandler } from '../diagram/edge-reshaping/handlers/edge-reshape.handler';
import { RelinkEndpointHandler } from '../diagram/edge-relinking/relink-endpoint.handler';
import { RelinkTargetHighlightService } from '../diagram/edge-relinking/relink-target-highlight.service';
import { DanglingEdgeService } from '../diagram/dangling-edge-creation/dangling-edge.service';
import { TempEdgePointsService } from '../diagram/dangling-edge-creation/temp-edge-points.service';
import { NetHighlightService } from '../diagram/net-highlight/net-highlight.service';
import { NodeVisibilityConfigService } from '../diagram/node-visibility/node-visibility-config.service';
import { PortFocusService } from '../diagram/port-focus.service';
import { BoardPlacementService } from '../diagram/placement/board-placement.service';
import { ViewportAnimationService } from '../diagram/viewport-animation.service';
import { ViewportBoundsDirective } from '../diagram/node-visibility/viewport-bounds.directive';
import { ViewportOverlayDirective } from '../diagram/node-visibility/viewport-overlay.directive';
import { LibrarySidebarComponent } from '../library-sidebar/library-sidebar.component';
import { LibraryService } from '../library-sidebar/library.service';
import { MinimapPanelComponent } from '../minimap-panel/minimap-panel.component';
import { DiagramExportService } from '../export/diagram-export.service';
import { ProjectStorageService } from '../project-storage/project-storage.service';
import { ElementMutationService } from '../properties-sidebar/element-mutation.service';
import { PropertiesSidebarComponent } from '../properties-sidebar/properties-sidebar.component';
import { PropertiesSidebarService } from '../properties-sidebar/properties-sidebar.service';
import { TopNavbarComponent } from '../top-navbar/top-navbar.component';
import { WireVizExchangeService } from '../wireviz-import/wireviz-exchange.service';
import { BoardJumperCreationService } from '../diagram/board-jumper-creation.service';

@Component({
  selector: 'app-av-schematic-page',
  imports: [
    DiagramComponent,
    LibrarySidebarComponent,
    PropertiesSidebarComponent,
    TopNavbarComponent,
    MinimapPanelComponent,
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
    NodeVisibilityConfigService,
    ViewportAnimationService,
    PortFocusService,
    BoardPlacementService,
    LibraryService,
    DiagramExportService,
    ProjectStorageService,
    WireVizExchangeService,
    EdgeCommandDispatcher,
    EdgeReshapeHandler,
    EdgeBendHandler,
    NetHighlightService,
    TempEdgePointsService,
    DanglingEdgeService,
    RelinkTargetHighlightService,
    RelinkEndpointHandler,
    BoardJumperCreationService,
  ],
})
export class AvSchematicPageComponent {}
