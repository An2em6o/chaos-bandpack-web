import { describe, expect, it } from 'vitest';
import { requiredCharset } from '../src/lib/font/charset';

describe('Charset', () => {
  it('matches the 6763 GB2312 Han characters plus printable ASCII', () => {
    const set = requiredCharset();
    expect([...set].filter(c => c >= 0x4e00 && c <= 0x9fff)).toHaveLength(6763);
    expect([...set].filter(c => c >= 0x20 && c <= 0x7e)).toHaveLength(95);
  });
});
