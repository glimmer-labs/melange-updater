import * as core from '@actions/core';
import { execSync } from 'child_process';

function resolveRemoteRef(repoUrl: string, ref: string): string {
  if (!repoUrl || !ref) return '';
  try {
    const output = execSync(`git ls-remote ${repoUrl} ${ref}`, { encoding: 'utf8' });
    const lines = output.trim().split(/\r?\n/);
    if (!lines.length || !lines[0]) return '';
    const [sha] = lines[0].split(/\s+/);
    return sha || '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.warning(`Failed to resolve ref ${ref} from ${repoUrl}: ${message}`);
    return '';
  }
}

export function resolveBranchHead(repoUrl: string, branch: string): string {
  return resolveRemoteRef(repoUrl, `refs/heads/${branch}`);
}

export function resolveTagCommit(repoUrl: string, tag: string): string {
  return resolveRemoteRef(repoUrl, `refs/tags/${tag}^{}`);
}

interface ResolveExpectedCommitArgs {
  source: string;
  tag?: string;
  tagCandidates?: string[];
  repoUrl?: string;
  branch?: string;
  owner?: string;
  repo?: string;
  octo: {
    rest: {
      git: { getRef: (params: { owner: string; repo: string; ref: string }) => Promise<{ data: { object?: { sha?: string } } }> };
      repos?: {
        getReleaseByTag: (params: { owner: string; repo: string; tag: string }) => Promise<{ data: { target_commitish?: string } }>;
      };
    };
  };
  packageName: string;
}

export async function resolveExpectedCommit({ source, tag, tagCandidates = [], repoUrl, branch, owner, repo, octo, packageName }: ResolveExpectedCommitArgs): Promise<string> {
  const tagsToTry: string[] = Array.from(
    new Set([...(tagCandidates || []), tag].filter((t): t is string => Boolean(t)))
  );
  const primaryTag = tag || tagsToTry[0] || '';
  let commitSha = '';

  if (source === 'github' && tagsToTry.length && owner && repo) {
    let lastError: unknown;

    for (const tagName of tagsToTry) {
      try {
        const ref = await octo.rest.git.getRef({ owner, repo, ref: `tags/${tagName}` });
        commitSha = ref?.data?.object?.sha || '';
        if (commitSha) return commitSha;
      } catch (err) {
        lastError = err;
      }
    }

    // Fallback: try release by the primary tag to grab target_commitish, then resolve.
    if (primaryTag && octo.rest.repos?.getReleaseByTag) {
      try {
        const rel = await octo.rest.repos.getReleaseByTag({ owner, repo, tag: primaryTag });
        const target = rel?.data?.target_commitish || '';
        if (target) {
          const ref = await octo.rest.git.getRef({ owner, repo, ref: `heads/${target}` });
          commitSha = ref?.data?.object?.sha || target;
          if (commitSha) return commitSha;
        }
      } catch (_) {
        // ignore and fallback below
      }
    }

    const fallbackRepo = `https://github.com/${owner}/${repo}.git`;
    for (const tagName of tagsToTry) {
      commitSha = resolveTagCommit(fallbackRepo, tagName);
      if (commitSha) return commitSha;
    }

    if (!commitSha && lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      const attempted = tagsToTry.join(', ');
      core.warning(`${packageName}: failed to resolve commit for GitHub tags [${attempted}]: ${message}`);
    }
  } else if (source === 'git' && repoUrl && tagsToTry.length) {
    for (const tagName of tagsToTry) {
      commitSha = resolveTagCommit(repoUrl, tagName);
      if (commitSha) return commitSha;
    }
  } else if (source === 'release-monitor' && repoUrl && branch) {
    commitSha = resolveBranchHead(repoUrl, branch);
  }

  return commitSha;
}
