const { Octokit } = require('@octokit/rest');

async function getLatestGithubRelease(owner, repo, octo, options = {}) {
  const client = octo || new Octokit();
  const useTag = !!options.useTag;
  const filterPrefix = options.tagFilterPrefix || options.tag_filter_prefix;
  const filterContains = options.tagFilterContains || options.tag_filter_contains;

  if (useTag) {
    // Tags path
    const tags = await client.repos.listTags({ owner, repo, per_page: 100 });
    const filtered = (tags.data || []).filter((t) => {
      const name = t.name || '';
      if (filterPrefix && !name.startsWith(filterPrefix)) return false;
      if (filterContains && !name.includes(filterContains)) return false;
      return true;
    });
    if (filtered.length > 0) return filtered[0].name;
    if (tags.data && tags.data.length > 0) return tags.data[0].name;
    return '';
  }

  // Releases path (default)
  const releases = await client.repos.listReleases({ owner, repo, per_page: 100 });
  for (const r of releases.data) {
    if (!r.draft && !r.prerelease) {
      const candidate = r.tag_name || r.name || '';
      if (filterPrefix && !candidate.startsWith(filterPrefix)) continue;
      if (filterContains && !candidate.includes(filterContains)) continue;
      return candidate;
    }
  }
  // fallback: take first release regardless of draft/prerelease
  if (releases.data.length > 0) return releases.data[0].tag_name || releases.data[0].name || '';
  return '';
}

module.exports = { getLatestGithubRelease };
