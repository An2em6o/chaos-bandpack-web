import { describe, expect, it } from 'vitest';
import { decodePreview, encodePreview, rleEncode } from '../src/lib/pack/previewFactory';

describe('PreviewFactory', () => {
  it('round trips a palette and index plane', () => {
    const indices = new Uint8Array(336 * 480); indices.fill(3, 100, 1000);
    const palette = new Uint8Array(1024); palette.set([1, 2, 3, 255], 12);
    const blob = encodePreview(indices, palette);
    const decoded = decodePreview(blob);
    expect(decoded.w).toBe(336); expect(decoded.h).toBe(480);
    expect(decoded.indices).toEqual(indices); expect(decoded.palette).toEqual(palette);
  });
  it('splits long runs at the firmware limit', () => {
    const out = rleEncode(new Uint8Array(300).fill(7));
    expect(out).toEqual(new Uint8Array([127, 7, 127, 7, 46, 7]));
  });
});
