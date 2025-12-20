const core = require('@actions/core');

async function createIssueForPackage({ octo, targetRepo, token, pkgName, message, phase }) {
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
    const msg = e && e.message ? e.message : String(e);
    console.warn(`Failed to create issue for ${pkgName}: ${msg}`);
    try {
      core.warning(msg);
    } catch (_) {}
    return null;
  }
}

async function createPullRequestWithLabels({ octo, owner, repo, title, head, base, body, labels = [] }) {
  const { data: pr } = await octo.rest.pulls.create({ owner, repo, title, head, base, body });
  console.log('Created PR:', pr.html_url);
  if (labels.length > 0) {
    try {
      await octo.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels });
      console.log(`Added labels to PR ${pr.number}: ${labels.join(', ')}`);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.warn(`Failed adding labels for PR ${pr.number}: ${msg}`);
      try {
        core.warning(msg);
      } catch (_) {}
    }
  }
  return pr;
}

module.exports = { createIssueForPackage, createPullRequestWithLabels };
