export interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/** Vertical extent of the scroll container the trigger sits in, in viewport coordinates. */
export interface VerticalBounds {
  top: number;
  bottom: number;
}

export interface ListboxPlacement {
  side: 'below' | 'above';
  top: number;
  left: number;
  width: number;
  /** The list's natural height, or less when the chosen side cannot hold all of it. */
  maxHeight: number;
}

export const LISTBOX_GAP_PX = 8;
export const VIEWPORT_MARGIN_PX = 8;

/**
 * Viewport-relative placement for a select's listbox, confined to the trigger's scroll container
 * so the list never covers the panel's footer or header.
 */
export function computeListboxPlacement(
  trigger: TriggerRect,
  listboxHeight: number,
  viewport: ViewportSize,
  container?: VerticalBounds,
): ListboxPlacement {
  const limitTop = Math.max(VIEWPORT_MARGIN_PX, container?.top ?? VIEWPORT_MARGIN_PX);
  const limitBottom = Math.min(
    viewport.height - VIEWPORT_MARGIN_PX,
    container?.bottom ?? viewport.height - VIEWPORT_MARGIN_PX,
  );
  const spaceBelow = limitBottom - trigger.bottom - LISTBOX_GAP_PX;
  const spaceAbove = trigger.top - limitTop - LISTBOX_GAP_PX;
  const side = spaceBelow >= listboxHeight || spaceBelow >= spaceAbove ? 'below' : 'above';
  const maxHeight = Math.max(
    0,
    Math.min(listboxHeight, side === 'below' ? spaceBelow : spaceAbove),
  );
  const top =
    side === 'below' ? trigger.bottom + LISTBOX_GAP_PX : trigger.top - LISTBOX_GAP_PX - maxHeight;
  return { side, top, left: trigger.left, width: trigger.width, maxHeight };
}
