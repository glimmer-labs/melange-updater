import { describe, it, expect } from 'vitest';
import { normalizeKeys } from '../src/lib/updateConfig';

describe('updateConfig.normalizeKeys', () => {
  it('normalizes hyphenated keys recursively', () => {
    const input = {
      'a-b': {
        'c-d': 1,
      },
      list: [
        { 'e-f': 2 },
        'unchanged',
      ],
    } as const;

    const normalized = normalizeKeys(input) as any;

    expect(normalized).toEqual({
      a_b: {
        c_d: 1,
      },
      list: [{ e_f: 2 }, 'unchanged'],
    });
  });
});
