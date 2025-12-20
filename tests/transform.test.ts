import { describe, it, expect } from 'vitest';
import { applyTransforms, shouldIgnoreVersion } from '../src/lib/transform';
import { UpdateConfig } from '../src/types';

describe('transform', () => {
  it('applies prefix/suffix stripping and version separators', () => {
    const cfg: UpdateConfig = {
      version_separator: '-',
      github: { strip_prefix: 'v', strip_suffix: '.final' },
    };
    const out = applyTransforms(cfg, 'v1-2-3.final');
    expect(out).toBe('1.2.3');
  });

  it('applies regex transforms and semver coercion', () => {
    const cfg: UpdateConfig = {
      version_transform: [{ match: '^release-(.*)$', replace: '$1' }],
    };
    const out = applyTransforms(cfg, 'release-2024.01');
    expect(out).toBe('2024.01');
  });

  it('honors ignore patterns', () => {
    const cfg: UpdateConfig = { ignore_regex_patterns: ['^0\\.0\\.'] };
    const ignored = shouldIgnoreVersion(cfg, '0.0.9');
    const accepted = shouldIgnoreVersion(cfg, '1.0.0');
    expect(ignored).toBe(true);
    expect(accepted).toBe(false);
  });
});
