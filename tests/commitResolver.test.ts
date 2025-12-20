import { describe, it, expect, vi, beforeEach } from 'vitest';

const execSyncMock = vi.fn((cmd: string) => {
  if (cmd.includes('refs/tags')) return 'deadbeef\trefs/tags/v1\n';
  if (cmd.includes('refs/heads')) return 'cafebabe\trefs/heads/main\n';
  return '';
});

vi.mock('child_process', () => ({ execSync: execSyncMock }));
vi.mock('@actions/core', () => ({ warning: vi.fn() }));

describe('commitResolver', () => {
  beforeEach(() => {
    execSyncMock.mockClear();
  });

  it('resolves commit for github source via octokit', async () => {
    const { resolveExpectedCommit } = await import('../src/lib/commitResolver');
    const octo = {
      rest: {
        git: {
          getRef: vi.fn().mockResolvedValue({ data: { object: { sha: 'tagsha' } } }),
        },
      },
    } as any;

    const sha = await resolveExpectedCommit({
      source: 'github',
      tag: 'v1',
      owner: 'owner',
      repo: 'repo',
      packageName: 'pkg',
      octo,
    });

    expect(sha).toBe('tagsha');
  });

  it('resolves commit for git source using ls-remote tag', async () => {
    const { resolveExpectedCommit } = await import('../src/lib/commitResolver');
    const octo = { rest: { git: { getRef: vi.fn() } } } as any;

    const sha = await resolveExpectedCommit({
      source: 'git',
      tag: 'v1',
      repoUrl: 'git@github.com:owner/repo.git',
      packageName: 'pkg',
      octo,
    });

    expect(execSyncMock).toHaveBeenCalled();
    expect(sha).toBe('deadbeef');
  });

  it('resolves branch head for release-monitor source', async () => {
    const { resolveExpectedCommit } = await import('../src/lib/commitResolver');
    const octo = { rest: { git: { getRef: vi.fn() } } } as any;

    const sha = await resolveExpectedCommit({
      source: 'release-monitor',
      branch: 'main',
      repoUrl: 'https://example.com/repo.git',
      packageName: 'pkg',
      octo,
    });

    expect(execSyncMock).toHaveBeenCalled();
    expect(sha).toBe('cafebabe');
  });
});
