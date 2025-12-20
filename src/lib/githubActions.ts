import * as core from '@actions/core';
import { Octokit } from '@octokit/rest';

interface CreateIssueParams {
  octo: Octokit;
  targetRepo: string;
  token?: string;
  pkgName: string;
  message: string;
  phase?: string;
}

export async function createIssueForPackage({ octo, targetRepo, token, pkgName, message, phase }: CreateIssueParams): Promise<unknown> {
  if (!token) {
    console.warn(`Cannot create issue for ${pkgName} (${phase}): no token available.`);
    return null;
  }
  try {
    const [owner, repo] = targetRepo.split('/');
    const title = `melange updater failure for ${pkgName}`;
    const body = `melange updater encountered an error ${phase ? `during ${phase} ` : ''}for package **${pkgName}**.\n\nError: ${message}`;
    const { data: issue } = await octo.rest.issues.create({ owner, repo, title, body });
    console.log(`Created issue for ${pkgName}: ${title}`);
    return issue;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`Failed to create issue for ${pkgName}: ${msg}`);
    try {
      core.warning(msg);
    } catch (_) {}
    return null;
  }
}

interface CreatePullRequestParams {
  octo: Octokit;
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body: string;
  labels?: string[];
}

interface FindPullRequestParams {
  octo: Octokit;
  owner: string;
  repo: string;
  head: string; // branch name without owner prefix
}

export async function createPullRequestWithLabels({ octo, owner, repo, title, head, base, body, labels = [] }: CreatePullRequestParams) {
  const { data: pr } = await octo.rest.pulls.create({ owner, repo, title, head, base, body });
  console.log('Created PR:', pr.html_url);
  if (labels.length > 0) {
    try {
      await octo.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels });
      console.log(`Added labels to PR ${pr.number}: ${labels.join(', ')}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Failed adding labels for PR ${pr.number}: ${msg}`);
      try {
        core.warning(msg);
      } catch (_) {}
    }
  }
  return pr;
}

export async function findOpenPullRequestByHead({ octo, owner, repo, head }: FindPullRequestParams) {
  const { data: pulls } = await octo.rest.pulls.list({ owner, repo, state: 'open', head: `${owner}:${head}`, per_page: 1 });
  return pulls[0] ?? null;
}
