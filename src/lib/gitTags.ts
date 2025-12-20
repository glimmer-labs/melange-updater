import { execSync } from 'child_process';
import semver from 'semver';

interface TagOptions {
  tag_filter_prefix?: string;
  tagFilterPrefix?: string;
  tag_filter_contains?: string;
  tagFilterContains?: string;
}

function listRemoteTags(repoUrl: string): string[] {
  const out = execSync(`git ls-remote --tags ${repoUrl}`, { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const ref = parts[1] || '';
      const tag = ref.replace('refs/tags/', '').replace(/\^\{\}$/, '');
      return tag;
    })
    .filter(Boolean);
}

function pickLatestTag(tags: string[], opts: TagOptions = {}): string {
  const prefix = opts.tag_filter_prefix || opts.tagFilterPrefix;
  const contains = opts.tag_filter_contains || opts.tagFilterContains;
  let filtered = tags;
  if (prefix) filtered = filtered.filter((t) => t.startsWith(prefix));
  if (contains) filtered = filtered.filter((t) => t.includes(contains));
  if (filtered.length === 0) return '';
  const semverCandidates = filtered
    .map((t) => ({ tag: t, v: semver.coerce(t) }))
    .filter((x): x is { tag: string; v: semver.SemVer } => Boolean(x.v));
  if (semverCandidates.length > 0) {
    semverCandidates.sort((a, b) => semver.rcompare(a.v, b.v));
    return semverCandidates[0].tag;
  }
  return filtered[0];
}

export function getLatestGitTag(repoUrl: string, opts: TagOptions = {}): string {
  const tags = listRemoteTags(repoUrl);
  return pickLatestTag(tags, opts);
}
