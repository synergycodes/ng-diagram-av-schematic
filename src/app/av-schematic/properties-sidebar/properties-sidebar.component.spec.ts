import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ElementMutationService } from './element-mutation.service';
import { PropertiesSidebarComponent } from './properties-sidebar.component';
import { PropertiesSidebarService } from './properties-sidebar.service';
import { BoardJumperCreationService } from '../diagram/board-jumper-creation.service';

describe('PropertiesSidebarComponent selected-wire actions', () => {
  it('resets the currently selected wire id and no other wire', () => {
    const resetEdgeRouting = vi.fn();
    const selectedEdge = signal({ id: 'wire-selected' });
    TestBed.configureTestingModule({
      imports: [PropertiesSidebarComponent],
      providers: [
        {
          provide: PropertiesSidebarService,
          useValue: {
            isExpanded: signal(true),
            sidebarState: signal('single-edge'),
            selectedNode: signal(undefined),
            selectedBoard: signal(undefined),
            selectedJunction: signal(undefined),
            selectedEdge,
            selectedWireDetails: signal(null),
            selectedVisualElement: signal(null),
            toggleSidebarVisibility: vi.fn(),
          },
        },
        { provide: ElementMutationService, useValue: { resetEdgeRouting } },
        {
          provide: BoardJumperCreationService,
          useValue: { activeBoardId: signal(null), toggle: vi.fn() },
        },
      ],
    });
    TestBed.overrideComponent(PropertiesSidebarComponent, { set: { template: '' } });
    const component = TestBed.createComponent(PropertiesSidebarComponent).componentInstance;

    (
      component as unknown as {
        onResetWireRouting(): void;
      }
    ).onResetWireRouting();

    expect(resetEdgeRouting).toHaveBeenCalledOnce();
    expect(resetEdgeRouting).toHaveBeenCalledWith('wire-selected');
  });

  it('updates the persisted plane of the selected element', () => {
    const setVisualPlane = vi.fn();
    const selectedVisualElement = signal({
      id: 'wire-selected',
      modelKind: 'edge' as const,
      elementKind: 'conductor' as const,
      visualPlane: 20,
    });
    TestBed.configureTestingModule({
      imports: [PropertiesSidebarComponent],
      providers: [
        {
          provide: PropertiesSidebarService,
          useValue: {
            isExpanded: signal(true),
            sidebarState: signal('single-edge'),
            selectedNode: signal(undefined),
            selectedBoard: signal(undefined),
            selectedJunction: signal(undefined),
            selectedEdge: signal({ id: 'wire-selected' }),
            selectedWireDetails: signal(null),
            selectedVisualElement,
            toggleSidebarVisibility: vi.fn(),
          },
        },
        { provide: ElementMutationService, useValue: { setVisualPlane } },
        {
          provide: BoardJumperCreationService,
          useValue: { activeBoardId: signal(null), toggle: vi.fn() },
        },
      ],
    });
    TestBed.overrideComponent(PropertiesSidebarComponent, { set: { template: '' } });
    const component = TestBed.createComponent(PropertiesSidebarComponent).componentInstance;
    const input = document.createElement('input');
    input.value = '25';

    (
      component as unknown as {
        onVisualPlaneChange(event: Event): void;
      }
    ).onVisualPlaneChange({ target: input } as unknown as Event);

    expect(setVisualPlane).toHaveBeenCalledWith('edge', 'conductor', 'wire-selected', 25);
  });
});
