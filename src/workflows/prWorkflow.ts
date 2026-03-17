import { RuntimeInputs } from '../core/inputs';
import {
  run,
  execGetOutput,
  escapeShell,
  sanitizeName,
  ensureCleanWorkingTree,
  failAndExit,
  redactSecrets,
} from '../core/actionUtils';
import { createPullRequestWithLabels, findOpenPullRequestByHead } from '../integrations/githubActions';
import { bumpWithMelangeTool, loadPackageDoc } from '../integrations/melange';
import { UpdateEntry } from '../types';
import { reportPackageFailure } from './failureWorkflow';
import { PackageError, PackageMap, PrWorkflowResult, WorkflowContext } from './types';

interface RepoInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
  startingBranch: string;
  remoteUrl: string;
}

interface BranchPreparationResult {
  branch: string;
  skip: boolean;
}

async function resolveRepoInfo(ctx: WorkflowContext, inputs: RuntimeInputs): Promise<RepoInfo> {
  const [owner, repo] = inputs.targetRepo.split('/');
  const { data: repoData } = await ctx.octo.rest.repos.get({ owner, repo });
  const defaultBranch = repoData.default_branch || 'main';
  const startingBranch = execGetOutput('git rev-parse --abbrev-ref HEAD', ctx.absRepoPath).trim() || defaultBranch;
  const remoteUrl = `https://x-access-token:${inputs.token}@github.com/${inputs.targetRepo}.git`;
  return { owner, repo, defaultBranch, startingBranch, remoteUrl };
}

function configureGitIdentity(ctx: WorkflowContext, inputs: RuntimeInputs): void {
  run(`git config user.name "${escapeShell(inputs.gitAuthorName)}"`, { cwd: ctx.absRepoPath });
  run(`git config user.email "${escapeShell(inputs.gitAuthorEmail)}"`, { cwd: ctx.absRepoPath });
}

async function prepareUpdateBranch(
  ctx: WorkflowContext,
  repoInfo: RepoInfo,
  pkgName: string,
  pkgFile: string,
  targetVersion: string,
  createdPRs: { name: string; url: string }[]
): Promise<BranchPreparationResult> {
  run(`git checkout ${repoInfo.defaultBranch}`, { cwd: ctx.absRepoPath });

  const safeName = sanitizeName(pkgName);
  const branch = `melange-update-${safeName}`;
  const remoteHead = execGetOutput(`git ls-remote ${repoInfo.remoteUrl} refs/heads/${branch}`, ctx.absRepoPath).trim();
  const branchExistsRemote = !!remoteHead;

  if (!branchExistsRemote) {
    run(`git checkout -B ${branch} ${repoInfo.defaultBranch}`, { cwd: ctx.absRepoPath });
    return { branch, skip: false };
  }

  run(`git fetch ${repoInfo.remoteUrl} ${branch}:${branch}`, { cwd: ctx.absRepoPath });
  run(`git checkout ${branch}`, { cwd: ctx.absRepoPath });

  try {
    const pkgDoc = (loadPackageDoc(pkgFile) as any) || {};
    const branchVersion = pkgDoc.package?.version || pkgDoc.Package?.version;
    if (branchVersion === targetVersion) {
      ctx.logger.info(`${pkgName}: branch already at target version; skipping bump.`);
      const existingPr = await findOpenPullRequestByHead({
        octo: ctx.octo,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        head: branch,
      });
      if (existingPr) {
        createdPRs.push({ name: pkgName, url: existingPr.html_url });
      }
      run(`git checkout ${repoInfo.defaultBranch}`, { cwd: ctx.absRepoPath });
      return { branch, skip: true };
    }
  } catch (readErr) {
    ctx.logger.warn(
      `${pkgName}: failed to read branch package for idempotence check: ${
        readErr instanceof Error ? readErr.message : String(readErr)
      }`
    );
  }

  return { branch, skip: false };
}

async function bumpCommitAndPush(
  ctx: WorkflowContext,
  repoInfo: RepoInfo,
  inputs: RuntimeInputs,
  pkgName: string,
  pkgFile: string,
  update: UpdateEntry,
  branch: string,
  failedPackages: string[],
  packageErrors: PackageError[]
): Promise<boolean> {
  try {
    bumpWithMelangeTool({ repoPath: ctx.absRepoPath, packageFile: pkgFile, version: update.to, expectedCommit: update.commit });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const safeMsg = redactSecrets(msg);
    ctx.logger.warn(`${pkgName}: melange bump failed: ${safeMsg}`);
    failedPackages.push(pkgName);
    packageErrors.push({ name: pkgName, phase: 'melange bump', message: safeMsg });
    await reportPackageFailure(ctx, inputs, pkgName, 'melange bump', safeMsg);
    run(`git checkout ${repoInfo.defaultBranch}`, { cwd: ctx.absRepoPath });
    return false;
  }

  run('git add -A', { cwd: ctx.absRepoPath });

  const status = execGetOutput('git status --porcelain', ctx.absRepoPath).trim();
  if (!status) {
    ctx.logger.info(`${pkgName}: no changes to commit after applying update; skipping push/PR.`);
    run(`git checkout ${repoInfo.defaultBranch}`, { cwd: ctx.absRepoPath });
    return false;
  }

  run(`git commit -m "chore(update): automatic update for ${escapeShell(pkgName)}"`, { cwd: ctx.absRepoPath });

  try {
    run(`git push ${repoInfo.remoteUrl} ${branch}`, { cwd: ctx.absRepoPath });
    return true;
  } catch (pushErr) {
    const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
    const safeMsg = redactSecrets(msg);
    ctx.logger.warn(`Failed to push branch for ${pkgName}: ${safeMsg}`);
    failedPackages.push(pkgName);
    packageErrors.push({ name: pkgName, phase: 'git push', message: safeMsg });
    await reportPackageFailure(ctx, inputs, pkgName, 'git push', safeMsg);
    run(`git checkout ${repoInfo.defaultBranch}`, { cwd: ctx.absRepoPath });
    return false;
  }
}

async function upsertPackagePullRequest(
  ctx: WorkflowContext,
  inputs: RuntimeInputs,
  repoInfo: RepoInfo,
  pkgName: string,
  update: UpdateEntry,
  branch: string
): Promise<string> {
  const existingPr = await findOpenPullRequestByHead({
    octo: ctx.octo,
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    head: branch,
  });

  if (existingPr) {
    ctx.logger.info(`${pkgName}: updated existing PR ${existingPr.html_url}`);
    return existingPr.html_url;
  }

  const prTitle = `Automated update for ${pkgName}`;
  const prBody = `This PR updates ${pkgName}: ${update.from} -> ${update.to}${
    inputs.githubLabels.length ? `\n\nLabels: ${inputs.githubLabels.join(', ')}` : ''
  }`;

  const pr = await createPullRequestWithLabels({
    octo: ctx.octo,
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    title: prTitle,
    head: branch,
    base: repoInfo.defaultBranch,
    body: prBody,
    labels: inputs.githubLabels,
  });
  return pr.html_url;
}

export async function runPrWorkflow(
  ctx: WorkflowContext,
  inputs: RuntimeInputs,
  packages: PackageMap,
  nonManualUpdates: Array<[string, UpdateEntry]>
): Promise<PrWorkflowResult> {
  const createdPRs: { name: string; url: string }[] = [];
  const failedPackages: string[] = [];
  const packageErrors: PackageError[] = [];

  const repoInfo = await resolveRepoInfo(ctx, inputs);
  const dirtyReason = ensureCleanWorkingTree(ctx.absRepoPath, execGetOutput);
  if (dirtyReason) {
    failAndExit(dirtyReason);
  }

  configureGitIdentity(ctx, inputs);

  for (const [name, update] of nonManualUpdates) {
    try {
      const pkg = packages[name];
      if (!pkg) {
        ctx.logger.warn(`Package metadata for ${name} not found; skipping.`);
        continue;
      }

      const branchPrep = await prepareUpdateBranch(ctx, repoInfo, name, pkg.file, update.to, createdPRs);
      if (branchPrep.skip) {
        continue;
      }

      const pushed = await bumpCommitAndPush(
        ctx,
        repoInfo,
        inputs,
        name,
        pkg.file,
        update,
        branchPrep.branch,
        failedPackages,
        packageErrors
      );
      if (!pushed) {
        continue;
      }

      const prUrl = await upsertPackagePullRequest(ctx, inputs, repoInfo, name, update, branchPrep.branch);
      createdPRs.push({ name, url: prUrl });
      run(`git checkout ${repoInfo.defaultBranch}`, { cwd: ctx.absRepoPath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const safeMsg = redactSecrets(msg);
      ctx.logger.warn(`Failed to create PR for ${name}: ${safeMsg}`);
      packageErrors.push({ name, phase: 'PR creation', message: safeMsg });
      await reportPackageFailure(ctx, inputs, name, 'PR creation', safeMsg);
      try {
        run(`git checkout ${repoInfo.defaultBranch}`, { cwd: ctx.absRepoPath });
      } catch (_) {
        // Best effort cleanup.
      }
      failedPackages.push(name);
    }
  }

  run(`git checkout ${repoInfo.startingBranch}`, { cwd: ctx.absRepoPath });
  return { createdPRs, failedPackages, packageErrors };
}
