import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ProjectStorageMenuComponent } from '../project-storage/project-storage-menu.component';
import { ExportMenuComponent } from './export-menu/export-menu.component';
import { ThemeToggleComponent } from './theme-toggle/theme-toggle.component';
import { WireVizToolsComponent } from '../wireviz-import/wireviz-tools.component';

@Component({
  selector: 'app-top-navbar',
  imports: [
    ExportMenuComponent,
    ProjectStorageMenuComponent,
    ThemeToggleComponent,
    WireVizToolsComponent,
  ],
  templateUrl: './top-navbar.component.html',
  styleUrl: './top-navbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopNavbarComponent {}
