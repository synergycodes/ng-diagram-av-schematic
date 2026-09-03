import { type NgDiagramModelService } from 'ng-diagram';

interface GroupedHistoryModel {
  beginHistoryGroup(): void;
  endHistoryGroup(): void;
}

/** Opens an optional history group on adapters that support compound gestures. */
export function beginModelHistoryGroup(modelService: NgDiagramModelService): () => void {
  const model = modelService.getModel() as Partial<GroupedHistoryModel>;
  if (
    typeof model.beginHistoryGroup !== 'function' ||
    typeof model.endHistoryGroup !== 'function'
  ) {
    return () => undefined;
  }
  const grouped = model as GroupedHistoryModel;
  grouped.beginHistoryGroup();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    grouped.endHistoryGroup();
  };
}
