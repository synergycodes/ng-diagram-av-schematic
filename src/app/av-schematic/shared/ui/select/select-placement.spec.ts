import { describe, expect, it } from 'vitest';
import { computeListboxPlacement, LISTBOX_GAP_PX, VIEWPORT_MARGIN_PX } from './select-placement';

const trigger = (top: number, height = 36, left = 100, width = 300) => ({
  top,
  bottom: top + height,
  left,
  width,
  height,
});
const viewport = { width: 1400, height: 640 };

describe('computeListboxPlacement', () => {
  it('opens below the trigger, matching its left edge and width, when there is room', () => {
    const placement = computeListboxPlacement(trigger(100), 220, viewport);
    expect(placement).toEqual({
      side: 'below',
      top: 136 + LISTBOX_GAP_PX,
      left: 100,
      width: 300,
      maxHeight: 220,
    });
  });

  it('flips above the trigger when the listbox would not fit below', () => {
    // 640 - 8 margin - 536 bottom = 96px below, 500px above: flip.
    const placement = computeListboxPlacement(trigger(500), 220, viewport);
    expect(placement.side).toBe('above');
    expect(placement.top).toBe(500 - LISTBOX_GAP_PX - 220);
    expect(placement.left).toBe(100);
  });

  it('stays below when neither side fits but there is more room below', () => {
    const placement = computeListboxPlacement(trigger(100), 600, viewport);
    expect(placement.side).toBe('below');
  });

  it('flips above when the scroll container ends before the list would, even with viewport room', () => {
    // The panel's content area ends at 300 (its footer starts there); the viewport goes on to 640.
    const container = { top: 60, bottom: 300 };
    const placement = computeListboxPlacement(trigger(240), 220, viewport, container);
    expect(placement.side).toBe('above');
    // Only 172px fit between the container top and the gap, so the list shrinks to that.
    expect(placement.maxHeight).toBe(240 - LISTBOX_GAP_PX - 60);
    expect(placement.top).toBe(60);
  });

  it('opens below inside the scroll container when the list fits before its bottom edge', () => {
    const container = { top: 60, bottom: 600 };
    const placement = computeListboxPlacement(trigger(240), 220, viewport, container);
    expect(placement.side).toBe('below');
  });

  it('does not rise above the scroll container top when flipped', () => {
    // 100px between the container top and the trigger, 220px list: shrink and start at the top.
    const container = { top: 140, bottom: 300 };
    const placement = computeListboxPlacement(trigger(240), 220, viewport, container);
    expect(placement.side).toBe('above');
    expect(placement.top).toBe(140);
    expect(placement.maxHeight).toBe(240 - LISTBOX_GAP_PX - 140);
  });

  it('keeps a flipped listbox inside the viewport margin', () => {
    // 200px above, 220px listbox: flipped it would overflow the top, so clamp.
    const placement = computeListboxPlacement(trigger(200), 220, { width: 1400, height: 300 });
    expect(placement.side).toBe('above');
    expect(placement.top).toBe(VIEWPORT_MARGIN_PX);
    expect(placement.maxHeight).toBe(200 - LISTBOX_GAP_PX - VIEWPORT_MARGIN_PX);
  });
});
