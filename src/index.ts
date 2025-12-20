#!/usr/bin/env node

import path from 'path';
import minimist from 'minimist';
import * as core from '@actions/core';
import { Octokit } from '@octokit/rest';
import semver from 'semver';
import { getLatestReleaseVersion } from './lib/releaseMonitor';
import { getLatestGithubRelease } from './lib/githubReleases';
import { getLatestGitTag } from './lib/gitTags';
import { findMelangePackages, applyVersionToPackage, updateExpectedCommitInFile } from './lib/melange';
import { getGitRepoFromPipeline, getGitBranchFromPipeline } from './lib/pipeline';
import { resolveExpectedCommit } from './lib/commitResolver';
import { applyTransforms, shouldIgnoreVersion } from './lib/transform';
import { run, execGetOutput, escapeShell, sanitizeName, failAndExit, writeSummary, ensureCleanWorkingTree, redactSecrets } from './lib/actionUtils';
import { createIssueForPackage, createPullRequestWithLabels, findOpenPullRequestByHead } from './lib/githubActions';
import { PackageInfo, UpdateConfig, UpdateEntry, UpdateMap } from './types';
import { normalizeKeys } from './lib/updateConfig';

function parseBooleanFlag(value: unknown): boolean {
  return value === true || value === 'true';
}

function getInputValue(name: string, fallback = ''): string {
  try {
    const val = core.getInput(name, { trimWhitespace: true });
    if (val) return val;
  } catch (_) {
    // ignore if core not available or input missing
  }
  const envKey = `INPUT_${name.replace(/-/g, '_').toUpperCase()}`;
  return process.env[envKey] || fallback;
}

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2));

  const targetRepo = (argv['target-repo'] as string) || (argv['repository'] as string) || getInputValue('repository');
  const token = (argv['token'] as string) || process.env.GITHUB_TOKEN || getInputValue('token');
  const dryRun = parseBooleanFlag(argv['dry-run']);
  const preview = parseBooleanFlag(argv['preview']) || parseBooleanFlag(argv['no-commit']);
  const releaseMonitorToken = (argv['release-monitor-token'] as string) || process.env.RELEASE_MONITOR_TOKEN || getInputValue('release_monitor_token') || '';
  const gitAuthorName = (argv['git-author-name'] as string) || getInputValue('git_author_name') || 'melange-updater';
  const gitAuthorEmail = (argv['git-author-email'] as string) || getInputValue('git_author_email') || 'noreply@example.com';
  const repoPath = (argv['repo-path'] as string) || getInputValue('repo-path') || process.env.GITHUB_WORKSPACE || '.';
  const githubLabels = ((argv['github-labels'] as string) || getInputValue('github-labels') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!targetRepo) {
    failAndExit('No target repo specified. Use --target-repo owner/repo');
  }
  if (!/^[^\s/]+\/[^\s/]+$/.test(targetRepo)) {
    failAndExit('Invalid target repo format. Expected owner/repo');
  }
  if (!token && !dryRun && !preview) {
    failAndExit('No token provided. Use --token or set GITHUB_TOKEN (or run with --dry-run/--preview/--no-commit)');
  }

  const absRepoPath = path.resolve(process.cwd(), repoPath);
  console.log('Repository path:', absRepoPath);

  const packages = findMelangePackages(absRepoPath);
  console.log('Found', Object.keys(packages).length, 'candidate melange packages');

  const updates: UpdateMap = {};
  const octo = new Octokit({ auth: token });
  const createdPRs: { name: string; url: string }[] = [];
  const failedPackages: string[] = [];
  const packageErrors: { name: string; phase: string; message: string }[] = [];

  for (const [name, pkg] of Object.entries(packages)) {
    try {
      const updateCfgRaw = pkg.doc.update || {};
      const updateCfg = normalizeKeys(updateCfgRaw) as UpdateConfig;

      if (updateCfg.enabled === false) {
        console.log(`${name}: update.enabled is false — skipping`);
        continue;
      }
      const isManual = updateCfg.manual === true;

      let latest = '';
      let latestSource = '';
      let tagForCommit = '';
      let repoUrlForCommit = '';
      let branchForCommit = '';
      let githubOwner = '';
      let githubRepoName = '';

      if (updateCfg.release_monitor?.identifier) {
        const id = updateCfg.release_monitor.identifier;
        console.log(`${name}: querying release-monitor id ${id}`);
        latest = await getLatestReleaseVersion(id, {
          token: releaseMonitorToken,
          version_filter_prefix: updateCfg.release_monitor.version_filter_prefix,
          version_filter_contains: updateCfg.release_monitor.version_filter_contains,
        });
        latestSource = 'release-monitor';
        repoUrlForCommit = updateCfg.git?.repository || getGitRepoFromPipeline(pkg.doc);
        branchForCommit = updateCfg.git?.branch || getGitBranchFromPipeline(pkg.doc);
      }

      if (!latest && updateCfg.github?.identifier) {
        const [owner, repo] = (updateCfg.github.identifier || '').split('/');
        if (owner && repo) {
          console.log(`${name}: querying GitHub releases ${owner}/${repo}`);
          latest = await getLatestGithubRelease(owner, repo, octo, {
            useTag: !!updateCfg.github.use_tag,
            tag_filter_prefix: updateCfg.github.tag_filter_prefix,
            tag_filter_contains: updateCfg.github.tag_filter_contains || updateCfg.github.tag_filter,
          });
          if (latest) {
            latestSource = 'github';
            tagForCommit = latest;
            githubOwner = owner;
            githubRepoName = repo;
          }
        }
      }

      if (!latest && updateCfg.git) {
        const repoUrl = updateCfg.git.repository || getGitRepoFromPipeline(pkg.doc);
        if (repoUrl) {
          console.log(`${name}: querying git tags from ${repoUrl}`);
          try {
            latest = getLatestGitTag(repoUrl, {
              tag_filter_prefix: updateCfg.git.tag_filter_prefix,
              tag_filter_contains: updateCfg.git.tag_filter_contains,
            });
            if (latest) {
              latestSource = 'git';
              repoUrlForCommit = repoUrl;
              tagForCommit = latest;
              branchForCommit = updateCfg.git.branch || getGitBranchFromPipeline(pkg.doc) || '';
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`${name}: failed to query git tags: ${msg}`);
          }
        }
      }

      if (!latest) {
        console.log(`${name}: no candidate latest version found`);
        continue;
      }

      const transformed = applyTransforms(updateCfg, latest);
      console.log(`${name}: latest raw=${latest} transformed=${transformed}`);

      if (shouldIgnoreVersion(updateCfg, transformed)) {
        console.log(`${name}: version ${transformed} ignored by ignore-regex-patterns`);
        continue;
      }

      const currentVersion = pkg.doc.package?.version || pkg.doc.Package?.version || '';

      if (!currentVersion) {
        console.log(`${name}: no current version in package metadata`);
      }

      let shouldUpdate = false;
      if (semver.valid(transformed) && semver.valid(currentVersion)) {
        shouldUpdate = semver.gt(transformed, currentVersion);
      } else if (transformed !== currentVersion) {
        shouldUpdate = true;
      }

      if (shouldUpdate) {
        console.log(`${name}: will update ${currentVersion} -> ${transformed}${isManual ? ' (manual)' : ''}`);
        let commitSha = '';
        if (!isManual) {
          commitSha = await resolveExpectedCommit({
            source: latestSource,
            tag: tagForCommit,
            repoUrl: repoUrlForCommit,
            branch: branchForCommit,
            owner: githubOwner,
            repo: githubRepoName,
            octo,
            packageName: name,
          });
        }
        updates[name] = { from: currentVersion, to: transformed, file: pkg.file, manual: isManual, commit: commitSha };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const safeMsg = redactSecrets(msg);
      console.warn(`failed to process package ${name}: ${safeMsg}`);
      packageErrors.push({ name, phase: 'version discovery', message: safeMsg });
      if (!dryRun && !preview) {
        await createIssueForPackage({ octo, targetRepo, token, pkgName: name, message: safeMsg, phase: 'version discovery' });
      }
    }
  }

  const updatesCount = Object.keys(updates).length;
  const updateEntries = Object.entries(updates);
  const manualUpdates = updateEntries.filter(([, u]) => u.manual) as Array<[string, UpdateEntry]>;
  const nonManualUpdates = updateEntries.filter(([, u]) => !u.manual) as Array<[string, UpdateEntry]>;

  if (updatesCount === 0) {
    console.log('No updates detected. Exiting without creating a branch.');
    if (dryRun) console.log('Dry run mode: nothing was changed.');
    await writeSummary({ mode: 'no-updates', updates, packageErrors });
    return;
  }

  if (dryRun) {
    console.log('Dry run enabled — the following updates would be applied:');
    console.log(JSON.stringify(updates, null, 2));
    await writeSummary({ mode: 'dry-run', updates, manualUpdates, packageErrors });
    return;
  }

  if (preview) {
    for (const [name, u] of Object.entries(updates)) {
      if (u.manual) continue;
      const pkg = packages[name];
      if (!pkg) continue;
      applyVersionToPackage(pkg, u.to);
      if (u.commit) {
        updateExpectedCommitInFile(pkg.file, u.commit);
      }
    }
    console.log('Preview mode: updates applied locally; no branch/commit/push/PR.');
    await writeSummary({ mode: 'preview', updates, manualUpdates, packageErrors });
    return;
  }

  if (nonManualUpdates.length === 0) {
    console.log('Only manual updates detected; nothing to auto-apply.');
    await writeSummary({ mode: 'manual-only', updates, manualUpdates, packageErrors });
    return;
  }

  const [owner, repo] = targetRepo.split('/');
  const { data: repoData } = await octo.rest.repos.get({ owner, repo });
  const defaultBranch = repoData.default_branch || 'main';
  const startingBranch = execGetOutput('git rev-parse --abbrev-ref HEAD', absRepoPath).trim() || defaultBranch;
  const remoteUrl = `https://x-access-token:${token}@github.com/${targetRepo}.git`;

  const dirtyReason = ensureCleanWorkingTree(absRepoPath, execGetOutput);
  if (dirtyReason) {
    failAndExit(dirtyReason);
  }

  run(`git config user.name "${escapeShell(gitAuthorName)}"`, { cwd: absRepoPath });
  run(`git config user.email "${escapeShell(gitAuthorEmail)}"`, { cwd: absRepoPath });

  for (const [name, u] of nonManualUpdates) {
    try {
      run(`git checkout ${defaultBranch}`, { cwd: absRepoPath });

      const pkg = packages[name];
      if (!pkg) {
        console.warn(`Package metadata for ${name} not found; skipping.`);
        continue;
      }

      const safeName = sanitizeName(name);
      const branch = `melange-update-${safeName}`;

      const remoteHead = execGetOutput(`git ls-remote ${remoteUrl} refs/heads/${branch}`, absRepoPath).trim();
      const branchExistsRemote = !!remoteHead;

      if (branchExistsRemote) {
        // Reuse existing branch to avoid duplicate PRs; fetch latest state then checkout.
        run(`git fetch ${remoteUrl} ${branch}:${branch}`, { cwd: absRepoPath });
        run(`git checkout ${branch}`, { cwd: absRepoPath });
      } else {
        // Fresh branch from default branch.
        run(`git checkout -B ${branch} ${defaultBranch}`, { cwd: absRepoPath });
      }

      applyVersionToPackage(pkg, u.to);
      if (u.commit) {
        updateExpectedCommitInFile(pkg.file, u.commit);
      }

      run('git add -A', { cwd: absRepoPath });

      const status = execGetOutput('git status --porcelain', absRepoPath).trim();
      if (!status) {
        console.log(`${name}: no changes to commit after applying update; skipping push/PR.`);
        run(`git checkout ${defaultBranch}`, { cwd: absRepoPath });
        continue;
      }

      run(`git commit -m "chore(update): automatic update for ${escapeShell(name)}"`, { cwd: absRepoPath });

      try {
        run(`git push ${remoteUrl} ${branch}`, { cwd: absRepoPath });
      } catch (pushErr) {
        const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        const safeMsg = redactSecrets(msg);
        console.warn(`Failed to push branch for ${name}: ${safeMsg}`);
        failedPackages.push(name);
        packageErrors.push({ name, phase: 'git push', message: safeMsg });
        await createIssueForPackage({ octo, targetRepo, token, pkgName: name, message: safeMsg, phase: 'git push' });
        run(`git checkout ${defaultBranch}`, { cwd: absRepoPath });
        continue;
      }

      const existingPr = await findOpenPullRequestByHead({ octo, owner, repo, head: branch });

      if (existingPr) {
        console.log(`${name}: updated existing PR ${existingPr.html_url}`);
        createdPRs.push({ name, url: existingPr.html_url });
      } else {
        const prTitle = `Automated update for ${name}`;
        const prBody = `This PR updates ${name}: ${u.from} -> ${u.to}${githubLabels.length ? `\n\nLabels: ${githubLabels.join(', ')}` : ''}`;

        const pr = await createPullRequestWithLabels({ octo, owner, repo, title: prTitle, head: branch, base: defaultBranch, body: prBody, labels: githubLabels });
        createdPRs.push({ name, url: pr.html_url });
      }

      run(`git checkout ${defaultBranch}`, { cwd: absRepoPath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const safeMsg = redactSecrets(msg);
      console.warn(`Failed to create PR for ${name}: ${safeMsg}`);
      packageErrors.push({ name, phase: 'PR creation', message: safeMsg });
      await createIssueForPackage({ octo, targetRepo, token, pkgName: name, message: safeMsg, phase: 'PR creation' });
      try {
        run(`git checkout ${defaultBranch}`, { cwd: absRepoPath });
      } catch (_) {}
      failedPackages.push(name);
    }
  }

  run(`git checkout ${startingBranch}`, { cwd: absRepoPath });

  if (manualUpdates.length > 0) {
    console.log('Manual updates were detected and not auto-applied:', manualUpdates.map(([n, u]) => `${n} (${u.from} -> ${u.to})`).join(', '));
  }

  console.log(`PRs created: ${createdPRs.length}`);
  createdPRs.forEach((p) => console.log(`- ${p.name}: ${p.url}`));
  if (failedPackages.length) {
    console.log(`Packages that failed to push/PR: ${failedPackages.join(', ')}`);
  }

  console.log('Done.');

  await writeSummary({ mode: 'pr', updates, createdPRs, manualUpdates, failedPackages, packageErrors });
}

main().catch((err) => {
  console.error(err);
  try {
    core.setFailed((err as Error).message || String(err));
  } catch (_) {
    // ignore if core is unavailable
  }
  process.exit(1);
});
