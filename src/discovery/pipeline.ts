import { PackageDoc } from '../types';

function findGitCheckoutStep(pkgDoc: PackageDoc): { with?: { repository?: string; branch?: string } } | null {
  const pipeline = pkgDoc && pkgDoc.pipeline;
  if (!Array.isArray(pipeline)) return null;
  for (const step of pipeline) {
    if (step && step.uses === 'git-checkout') {
      return step;
    }
  }
  return null;
}

export function getGitRepoFromPipeline(pkgDoc: PackageDoc): string {
  return findGitCheckoutStep(pkgDoc)?.with?.repository || '';
}

export function getGitBranchFromPipeline(pkgDoc: PackageDoc): string {
  return findGitCheckoutStep(pkgDoc)?.with?.branch || '';
}
