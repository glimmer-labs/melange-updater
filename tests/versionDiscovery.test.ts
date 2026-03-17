import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLatestReleaseVersion = vi.fn();
const getLatestGithubRelease = vi.fn();
const getLatestGitTag = vi.fn();
const resolveExpectedCommit = vi.fn();

vi.mock('../src/providers/releaseMonitor', () => ({ getLatestReleaseVersion }));
vi.mock('../src/providers/githubReleases', () => ({ getLatestGithubRelease }));
vi.mock('../src/providers/gitTags', () => ({ getLatestGitTag }));
vi.mock('../src/providers/commitResolver', () => ({ resolveExpectedCommit }));

describe('versionDiscovery', () => {
  beforeEach(() => {
    getLatestReleaseVersion.mockReset();
    getLatestGithubRelease.mockReset();
    getLatestGitTag.mockReset();
    resolveExpectedCommit.mockReset();
  });

  it('returns null when package update is disabled', async () => {
    const { discoverPackageUpdate } = await import('../src/discovery/versionDiscovery');

    const update = await discoverPackageUpdate({
      name: 'pkg',
      pkg: {
        file: '/tmp/pkg.yaml',
        doc: {
          package: { version: '1.0.0' },
          update: { enabled: false },
        },
      },
      octo: {} as any,
      releaseMonitorToken: '',
    });

    expect(update).toBeNull();
  });

  it('discovers manual update without resolving commit', async () => {
    const { discoverPackageUpdate } = await import('../src/discovery/versionDiscovery');
    getLatestGitTag.mockReturnValue('1.2.0');

    const update = await discoverPackageUpdate({
      name: 'pkg',
      pkg: {
        file: '/tmp/pkg.yaml',
        doc: {
          package: { version: '1.0.0' },
          update: {
            manual: true,
            git: { repository: 'https://example.com/repo.git' },
          },
        },
      },
      octo: {} as any,
      releaseMonitorToken: '',
    });

    expect(update).toMatchObject({
      from: '1.0.0',
      to: '1.2.0',
      manual: true,
      commit: '',
    });
    expect(resolveExpectedCommit).not.toHaveBeenCalled();
  });

  it('resolves expected commit for non-manual update', async () => {
    const { discoverPackageUpdate } = await import('../src/discovery/versionDiscovery');
    getLatestGitTag.mockReturnValue('2.0.0');
    resolveExpectedCommit.mockResolvedValue('abc123');

    const update = await discoverPackageUpdate({
      name: 'pkg',
      pkg: {
        file: '/tmp/pkg.yaml',
        doc: {
          package: { version: '1.0.0' },
          update: {
            git: { repository: 'https://example.com/repo.git' },
          },
        },
      },
      octo: {} as any,
      releaseMonitorToken: '',
    });

    expect(update?.commit).toBe('abc123');
    expect(resolveExpectedCommit).toHaveBeenCalledOnce();
  });
});
