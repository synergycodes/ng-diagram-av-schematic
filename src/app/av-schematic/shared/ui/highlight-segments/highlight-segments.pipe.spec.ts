import { describe, expect, it } from 'vitest';
import { HighlightSegmentsPipe } from './highlight-segments.pipe';

describe('HighlightSegmentsPipe', () => {
  it('highlights a match when the query omits diacritics', () => {
    const pipe = new HighlightSegmentsPipe();

    expect(pipe.transform('A3144 / LM393 (4 vias — provisório)', 'provisorio')).toEqual([
      { text: 'A3144 / LM393 (4 vias — ', match: false },
      { text: 'provisório', match: true },
      { text: ')', match: false },
    ]);
  });

  it('treats a query containing only combining marks as empty', () => {
    const pipe = new HighlightSegmentsPipe();

    expect(pipe.transform('provisório', '\u0301')).toEqual([{ text: 'provisório', match: false }]);
  });
});
