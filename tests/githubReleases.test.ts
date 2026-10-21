import { describe, expect, it } from 'vitest';
import { getLatestGithubRelease } from '../src/providers/githubReleases';

describe('getLatestGithubRelease', () => {
  it('paginates and selects the newest stable matching tag', async () => {
    const listTags = () => Promise.resolve({ data: [] });
    const octo = {
      repos: { listTags },
      paginate: async () => [
        { name: 'yaf-2.1.0' },
        { name: 'php-8.3.30RC1' },
        { name: 'php-8.3.35' },
        { name: 'php-8.3.36' },
      ],
    } as any;

    await expect(getLatestGithubRelease('php', 'php-src', octo, {
      useTag: true,
      tag_filter_prefix: 'php-8.3',
    })).resolves.toBe('php-8.3.36');
  });

  it('does not fall back to an unrelated release when filters match nothing', async () => {
    const octo = {
      repos: {
        listReleases: async () => ({
          data: [{ draft: false, prerelease: false, tag_name: 'yaf-2.1.0' }],
        }),
      },
    } as any;

    await expect(getLatestGithubRelease('php', 'php-src', octo, {
      tag_filter_prefix: 'php-8.3',
    })).resolves.toBe('');
  });
});