const core = require('@actions/core');
const { execSync } = require('child_process');

function resolveRemoteRef(repoUrl, ref) {
  if (!repoUrl || !ref) return '';
  try {
    const output = execSync(`git ls-remote ${repoUrl} ${ref}`, { encoding: 'utf8' });
    const lines = output.trim().split(/\r?\n/);
    if (!lines.length || !lines[0]) return '';
    const [sha] = lines[0].split(/\s+/);
    return sha || '';
  } catch (err) {
    core.warning(`Failed to resolve ref ${ref} from ${repoUrl}: ${err.message}`);
    return '';
  }
}

function resolveBranchHead(repoUrl, branch) {
  return resolveRemoteRef(repoUrl, `refs/heads/${branch}`);
}

function resolveTagCommit(repoUrl, tag) {
  return resolveRemoteRef(repoUrl, `refs/tags/${tag}^{}`);
}

async function resolveExpectedCommit({ source, tag, repoUrl, branch, owner, repo, octo, packageName }) {
  let commitSha = '';

  if (source === 'github' && tag && owner && repo) {
    try {
      const ref = await octo.rest.git.getRef({ owner, repo, ref: `tags/${tag}` });
      commitSha = ref?.data?.object?.sha || '';
    } catch (err) {
      const fallbackRepo = `https://github.com/${owner}/${repo}.git`;
      commitSha = resolveTagCommit(fallbackRepo, tag);
      if (!commitSha) {
        core.warning(`${packageName}: failed to resolve commit for GitHub tag ${tag}: ${err.message}`);
      }
    }
  } else if (source === 'git' && repoUrl && tag) {
    commitSha = resolveTagCommit(repoUrl, tag);
  } else if (source === 'release-monitor' && repoUrl && branch) {
    commitSha = resolveBranchHead(repoUrl, branch);
  }

  return commitSha;
}

module.exports = { resolveBranchHead, resolveTagCommit, resolveExpectedCommit };
