import { describe, it, expect } from 'vitest';
import { getGitRepoFromPipeline, getGitBranchFromPipeline } from '../src/lib/pipeline';

const samplePipeline = [
  { uses: 'setup' },
  { uses: 'git-checkout', with: { repository: 'owner/repo', branch: 'main' } },
  { uses: 'other' },
];

describe('pipeline helpers', () => {
  it('extracts repository from git-checkout step', () => {
    const repo = getGitRepoFromPipeline({ pipeline: samplePipeline } as any);
    expect(repo).toBe('owner/repo');
  });

  it('extracts branch from git-checkout step', () => {
    const branch = getGitBranchFromPipeline({ pipeline: samplePipeline } as any);
    expect(branch).toBe('main');
  });

  it('returns empty string when pipeline is missing', () => {
    expect(getGitRepoFromPipeline({} as any)).toBe('');
    expect(getGitBranchFromPipeline({} as any)).toBe('');
  });
});
