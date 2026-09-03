import { Injectable, inject } from '@angular/core';
import { NgDiagramModelService } from 'ng-diagram';
import { applyInsertBend, applyMoveBend, applyRemoveBend } from './bend-edge';
import { applyReshapeMove, finishReshape, setEdgeRoute } from './reshape-edge';
import type { EdgeCommand } from './types';

/**
 * The reshaping feature's model-write surface. The handler builds a typed
 * {@link EdgeCommand} and dispatches it here; this is the only place reshaping
 * mutates the model. Maps onto ng-diagram's command pipeline -- when reshaping
 * moves into core, these become first-class commands.
 */
@Injectable()
export class EdgeCommandDispatcher {
  private readonly model = inject(NgDiagramModelService);

  dispatch(command: EdgeCommand): Promise<void> {
    switch (command.kind) {
      case 'set-edge-route':
        return setEdgeRoute(this.model, command);
      case 'reshape-move':
        return applyReshapeMove(this.model, command);
      case 'reshape-finish':
        return finishReshape(this.model, command);
      case 'insert-bend':
        return applyInsertBend(this.model, command);
      case 'remove-bend':
        return applyRemoveBend(this.model, command);
      case 'move-bend':
        return applyMoveBend(this.model, command);
    }
  }
}
