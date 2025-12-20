import { PackageDoc } from '../types';

export function getGitRepoFromPipeline(pkgDoc: PackageDoc): string {
  const pipeline = pkgDoc && pkgDoc.pipeline;
  if (!Array.isArray(pipeline)) return '';
  for (const step of pipeline) {
    if (step && step.uses === 'git-checkout' && step.with && step.with.repository) {
      return step.with.repository;
    }
  }
  return '';
}

export function getGitBranchFromPipeline(pkgDoc: PackageDoc): string {
  const pipeline = pkgDoc && pkgDoc.pipeline;
  if (!Array.isArray(pipeline)) return '';
  for (const step of pipeline) {
    if (step && step.uses === 'git-checkout' && step.with && step.with.branch) {
      return step.with.branch;
    }
  }
  return '';
}
