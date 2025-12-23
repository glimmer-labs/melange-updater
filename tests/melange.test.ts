import { describe, it, expect, vi } from 'vitest';
vi.mock('child_process', () => ({ execSync: vi.fn() }));
import { execSync } from 'child_process';
import { bumpWithMelangeTool } from '../src/lib/melange';

describe('melange bump helper', () => {
  it('builds docker bump command with expected-commit', () => {
    bumpWithMelangeTool({
      repoPath: '/repo',
      packageFile: '/repo/pkg.yaml',
      version: '2.0.1',
      expectedCommit: 'deadbeef',
    });

    expect(execSync).toHaveBeenCalledWith(
      'docker run --rm -v "/repo":/work -w /work cgr.dev/chainguard/melange:latest bump pkg.yaml 2.0.1 --expected-commit deadbeef',
      { stdio: 'inherit' }
    );
  });

});
