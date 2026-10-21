import { Octokit } from '@octokit/rest';
import semver from 'semver';

interface GithubReleaseOptions {
  useTag?: boolean;
  tagFilterPrefix?: string;
  tag_filter_prefix?: string;
  tagFilterContains?: string;
  tag_filter_contains?: string;
}

export async function getLatestGithubRelease(owner: string, repo: string, octo?: Octokit, options: GithubReleaseOptions = {}): Promise<string> {
  const client = octo || new Octokit();
  const useTag = !!options.useTag;
  const filterPrefix = options.tagFilterPrefix || options.tag_filter_prefix;
  const filterContains = options.tagFilterContains || options.tag_filter_contains;

  if (useTag) {
    const tags = await client.paginate(client.repos.listTags, { owner, repo, per_page: 100 });
    const filtered = (tags || []).filter((t) => {
      const name = t.name || '';
      if (filterPrefix && !name.startsWith(filterPrefix)) return false;
      if (filterContains && !name.includes(filterContains)) return false;
      return true;
    });
    return pickLatestTag(filtered.map((tag) => tag.name || ''));
  }

  const releases = await client.repos.listReleases({ owner, repo, per_page: 100 });
  for (const r of releases.data) {
    if (!r.draft && !r.prerelease) {
      const candidate = r.tag_name || r.name || '';
      if (filterPrefix && !candidate.startsWith(filterPrefix)) continue;
      if (filterContains && !candidate.includes(filterContains)) continue;
      return candidate;
    }
  }
  return '';
}

function pickLatestTag(tags: string[]): string {
  const stable = tags.filter((tag) => !/(alpha|beta|rc|dev|preview|snapshot)/i.test(tag));
  const candidates = (stable.length > 0 ? stable : tags)
    .map((tag) => ({ tag, version: semver.coerce(tag) }))
    .filter((candidate): candidate is { tag: string; version: semver.SemVer } => Boolean(candidate.version));

  if (candidates.length === 0) return tags[0] || '';
  candidates.sort((a, b) => semver.rcompare(a.version, b.version));
  return candidates[0].tag;
}
