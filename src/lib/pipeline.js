function getGitRepoFromPipeline(pkgDoc) {
  const pipeline = pkgDoc && pkgDoc.pipeline;
  if (!Array.isArray(pipeline)) return '';
  for (const step of pipeline) {
    if (step && step.uses === 'git-checkout' && step.with && step.with.repository) {
      return step.with.repository;
    }
  }
  return '';
}

function getGitBranchFromPipeline(pkgDoc) {
  const pipeline = pkgDoc && pkgDoc.pipeline;
  if (!Array.isArray(pipeline)) return '';
  for (const step of pipeline) {
    if (step && step.uses === 'git-checkout' && step.with && step.with.branch) {
      return step.with.branch;
    }
  }
  return '';
}

module.exports = { getGitRepoFromPipeline, getGitBranchFromPipeline };
