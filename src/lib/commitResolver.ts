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
  repoUrl?: string;
  branch?: string;
  owner?: string;
  repo?: string;
  octo: { rest: { git: { getRef: (params: { owner: string; repo: string; ref: string }) => Promise<{ data: { object?: { sha?: string } } }> } } };
  packageName: string;
}

export async function resolveExpectedCommit({ source, tag, repoUrl, branch, owner, repo, octo, packageName }: ResolveExpectedCommitArgs): Promise<string> {
  let commitSha = '';

  if (source === 'github' && tag && owner && repo) {
    try {
      const ref = await octo.rest.git.getRef({ owner, repo, ref: `tags/${tag}` });
      commitSha = ref?.data?.object?.sha || '';
    } catch (err) {
      const fallbackRepo = `https://github.com/${owner}/${repo}.git`;
      commitSha = resolveTagCommit(fallbackRepo, tag);
      if (!commitSha) {
        const message = err instanceof Error ? err.message : String(err);
        core.warning(`${packageName}: failed to resolve commit for GitHub tag ${tag}: ${message}`);
      }
    }
  } else if (source === 'git' && repoUrl && tag) {
    commitSha = resolveTagCommit(repoUrl, tag);
  } else if (source === 'release-monitor' && repoUrl && branch) {
    commitSha = resolveBranchHead(repoUrl, branch);
  }

  return commitSha;
}
