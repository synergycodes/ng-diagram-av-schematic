import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { provideNgDiagram } from 'ng-diagram';
import { DiagramComponent } from '../diagram/diagram.component';
import { LinkDanglingService } from '../diagram/edge-linking/link-dangling.service';
import { TempEdgePointsService } from '../diagram/edge-linking/temp-edge-points.service';
import { RelinkEndpointHandler } from '../diagram/edge-relinking/relink-endpoint.handler';
import { EdgeReshapeCommandDispatcher } from '../diagram/edge-reshaping/commands/dispatcher';
import { EdgeReshapeEventHandler } from '../diagram/edge-reshaping/handlers/edge-reshape.handler';
import {
  EdgeEndpointSyncService,
  bootstrapEdgeEndpointSync,
} from '../diagram/edge-reshaping/middleware/edge-endpoint-sync.service';
import { EdgeReshapeLifecycleEmitter } from '../diagram/edge-reshaping/middleware/edge-reshape-lifecycle.emitter';
import { NodeVisibilityConfigService } from '../diagram/node-visibility/node-visibility-config.service';
import { PortFocusService } from '../diagram/port-focus.service';
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
import { TopNavbarComponent } from '../top-navbar/top-navbar.component';

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
    LibraryService,
    DiagramExportService,
    EdgeReshapeLifecycleEmitter,
    EdgeReshapeCommandDispatcher,
    EdgeReshapeEventHandler,
    EdgeEndpointSyncService,
    RelinkEndpointHandler,
    LinkDanglingService,
    TempEdgePointsService,
  ],
})
export class AvSchematicPageComponent {
  constructor() {
    bootstrapEdgeEndpointSync();

    // Demo subscriber: hook your toolbar / telemetry / undo stack here.
    const reshapeEvents = inject(EdgeReshapeLifecycleEmitter);
    reshapeEvents.edgeReshapeStarted.pipe(takeUntilDestroyed()).subscribe(({ edgeId }) => {
      console.log('[edge-reshape] started', edgeId);
    });
    reshapeEvents.edgeReshapeEnded.pipe(takeUntilDestroyed()).subscribe(({ edgeId }) => {
      console.log('[edge-reshape] ended', edgeId);
    });
  }
}
