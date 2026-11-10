import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { subsetFont } from '../src/lib/font/fontSubset';

describe('FontSubset', () => {
  it('rebuilds a TrueType subset and can read it back', () => {
    const src = new Uint8Array(readFileSync(new URL('../public/fonts/MiSans-Regular-subset.ttf', import.meta.url)));
    const [out, report] = subsetFont(src, { codePoints: [] });
    expect(out.byteLength).toBeGreaterThan(0);
    expect(report.outGlyphs).toBeLessThanOrEqual(report.srcGlyphs);
    expect(report.cmapChars).toBeGreaterThan(90);
  });
});
