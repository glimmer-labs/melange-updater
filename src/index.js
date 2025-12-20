#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const core = require('@actions/core');
const { Octokit } = require('@octokit/rest');
const { getLatestReleaseVersion } = require('./lib/releaseMonitor');
const { getLatestGithubRelease } = require('./lib/githubReleases');
const { getLatestGitTag } = require('./lib/gitTags');
const { findMelangePackages, applyVersionToPackage, updateExpectedCommitInFile } = require('./lib/melange');
const { getGitRepoFromPipeline, getGitBranchFromPipeline } = require('./lib/pipeline');
const { resolveExpectedCommit } = require('./lib/commitResolver');
const { applyTransforms, shouldIgnoreVersion } = require('./lib/transform');
const { run, execGetOutput, escapeShell, sanitizeName, failAndExit, writeSummary, ensureCleanWorkingTree } = require('./lib/actionUtils');
const { createIssueForPackage, createPullRequestWithLabels } = require('./lib/githubActions');
const semver = require('semver');

async function main() {
  // Support both CLI invocation (minimist) and GitHub Action inputs via env/with.
  const argv = minimist(process.argv.slice(2));

  function input(name, fallback = '') {
    // core.getInput returns '' if not set; prefer env INPUT_* when running as action.
    try {
      const v = core.getInput(name, { trimWhitespace: true });
      if (v) return v;
    } catch (_) {
      // ignore if core not available or input missing
    }
    return process.env[`INPUT_${name.replace(/-/g, '_').toUpperCase()}`] || fallback;
  }

  const targetRepo = argv['target-repo'] || argv['repository'] || input('repository');
  const token = argv['token'] || process.env.GITHUB_TOKEN || input('token');
  const dryRun = argv['dry-run'] === true || argv['dry-run'] === 'true';
  const preview = argv['preview'] === true || argv['preview'] === 'true' || argv['no-commit'] === true || argv['no-commit'] === 'true';
  const releaseMonitorToken = argv['release-monitor-token'] || process.env.RELEASE_MONITOR_TOKEN || input('release_monitor_token') || '';
  const gitAuthorName = argv['git-author-name'] || input('git_author_name') || 'melange-updater';
  const gitAuthorEmail = argv['git-author-email'] || input('git_author_email') || 'noreply@example.com';
  const repoPath = argv['repo-path'] || input('repo-path') || process.env.GITHUB_WORKSPACE || '.';
  const githubLabels = (argv['github-labels'] || input('github-labels') || '').split(',').map(s => s.trim()).filter(Boolean);

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


  // Discover melange packages
  const packages = findMelangePackages(absRepoPath);
  console.log('Found', Object.keys(packages).length, 'candidate melange packages');

  const updates = {};
  const octo = new Octokit({ auth: token });
  const { normalizeKeys } = require('./lib/updateConfig');
  const createdPRs = [];
  const failedPackages = [];

  for (const [name, pkg] of Object.entries(packages)) {
    try {
      const updateCfgRaw = pkg.doc.update || {};
      const updateCfg = normalizeKeys(updateCfgRaw || {});

      // honor enable flag; manual packages are handled separately (we'll surface manual updates in PR without auto-applying)
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
      if (updateCfg.release_monitor && updateCfg.release_monitor.identifier) {
        const id = updateCfg.release_monitor.identifier;
        console.log(`${name}: querying release-monitor id ${id}`);
        latest = await getLatestReleaseVersion(id, {
          token: releaseMonitorToken,
          version_filter_prefix: updateCfg.release_monitor.version_filter_prefix,
          version_filter_contains: updateCfg.release_monitor.version_filter_contains,
        });
        latestSource = 'release-monitor';
        repoUrlForCommit = (updateCfg.git && updateCfg.git.repository) || getGitRepoFromPipeline(pkg.doc);
        branchForCommit = (updateCfg.git && updateCfg.git.branch) || getGitBranchFromPipeline(pkg.doc);
      }

      // GitHub config uses `identifier: org/repo` in melange YAML
      if (!latest && updateCfg.github && updateCfg.github.identifier) {
        const [owner, repo] = (updateCfg.github.identifier || '').split('/');
        if (owner && repo) {
          console.log(`${name}: querying GitHub releases ${owner}/${repo}`);
          latest = await getLatestGithubRelease(owner, repo, octo, {
            useTag: !!updateCfg.github.use_tag,
            tag_filter_prefix: updateCfg.github.tag_filter_prefix,
            tag_filter_contains: updateCfg.github.tag_filter_contains || updateCfg.github.tag_filter, // legacy
          });
          if (latest) {
            latestSource = 'github';
            tagForCommit = latest;
            githubOwner = owner;
            githubRepoName = repo;
          }
        }
      }

      // Git mode: query remote tags of the repo used by git-checkout
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
            console.warn(`${name}: failed to query git tags: ${e.message}`);
          }
        }
      }

      if (!latest) {
        console.log(`${name}: no candidate latest version found`);
        continue;
      }

      // apply provider-specific strips + version transforms
      const transformed = applyTransforms(updateCfg, latest);
      console.log(`${name}: latest raw=${latest} transformed=${transformed}`);

      // ignore patterns
      if (shouldIgnoreVersion(updateCfg, transformed)) {
        console.log(`${name}: version ${transformed} ignored by ignore-regex-patterns`);
        continue;
      }

      // determine current package version
      const currentVersion = (pkg.doc.package && pkg.doc.package.version) || (pkg.doc.Package && pkg.doc.Package.version) || '';

      if (!currentVersion) {
        console.log(`${name}: no current version in package metadata`);
      }

      // compare semver if possible
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
        // do not write files yet; we'll apply changes only if there are updates and not in dry-run
      }
    } catch (e) {
      console.warn(`failed to process package ${name}: ${e.message}`);
      if (!dryRun && !preview) {
        await createIssueForPackage({ octo, targetRepo, token, pkgName: name, message: e.message, phase: 'version discovery' });
      }
    }
  }

  // If no updates detected, exit without creating any branch or committing
  const updatesCount = Object.keys(updates).length;
  const updateEntries = Object.entries(updates);
  const manualUpdates = updateEntries.filter(([, u]) => u.manual);
  const nonManualUpdates = updateEntries.filter(([, u]) => !u.manual);

  if (updatesCount === 0) {
    console.log('No updates detected. Exiting without creating a branch.');
    if (dryRun) console.log('Dry run mode: nothing was changed.');
    await writeSummary({ mode: 'no-updates', updates });
    return;
  }

  // If dry-run and there are updates, just print what would be done and exit
  if (dryRun) {
    console.log('Dry run enabled — the following updates would be applied:');
    console.log(JSON.stringify(updates, null, 2));
    await writeSummary({ mode: 'dry-run', updates, manualUpdates });
    return;
  }

  // Preview/no-commit mode: apply updates locally to files, write summary, but do NOT branch/commit/push/PR
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
    await writeSummary({ mode: 'preview', updates, manualUpdates });
    return;
  }

  // Proceed to create a PR per non-manual package update

  if (nonManualUpdates.length === 0) {
    console.log('Only manual updates detected; nothing to auto-apply.');
    await writeSummary({ mode: 'manual-only', updates, manualUpdates });
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
      // ensure we start from the default/base branch for each package
      run(`git checkout ${defaultBranch}`, { cwd: absRepoPath });

      const pkg = packages[name];
      if (!pkg) {
        console.warn(`Package metadata for ${name} not found; skipping.`);
        continue;
      }

      // Apply the update to the working tree
      applyVersionToPackage(pkg, u.to);
      if (u.commit) {
        updateExpectedCommitInFile(pkg.file, u.commit);
      }

      const safeName = sanitizeName(name);
      const branch = `melange-update-${safeName}-${Date.now()}`;
      run(`git checkout -b ${branch}`, { cwd: absRepoPath });
      run('git add -A', { cwd: absRepoPath });
      run('git commit -m "chore(update): automatic update for ' + escapeShell(name) + '"', { cwd: absRepoPath });
      try {
        run(`git push ${remoteUrl} HEAD:${branch}`, { cwd: absRepoPath });
      } catch (pushErr) {
        console.warn(`Failed to push branch for ${name}: ${pushErr.message}`);
        failedPackages.push(name);
        await createIssueForPackage({ octo, targetRepo, token, pkgName: name, message: pushErr.message, phase: 'git push' });
        run(`git checkout ${defaultBranch}`, { cwd: absRepoPath });
        continue;
      }

      const prTitle = `Automated update for ${name}`;
      const prBody = `This PR updates ${name}: ${u.from} -> ${u.to}${githubLabels.length ? `\n\nLabels: ${githubLabels.join(', ')}` : ''}`;

      const pr = await createPullRequestWithLabels({ octo, owner, repo, title: prTitle, head: branch, base: defaultBranch, body: prBody, labels: githubLabels });
      createdPRs.push({ name, url: pr.html_url });

      // return to default branch for the next package
      run(`git checkout ${defaultBranch}`, { cwd: absRepoPath });
    } catch (e) {
      console.warn(`Failed to create PR for ${name}: ${e.message}`);
      await createIssueForPackage({ octo, targetRepo, token, pkgName: name, message: e.message, phase: 'PR creation' });
      try { run(`git checkout ${defaultBranch}`, { cwd: absRepoPath }); } catch (_) {}
      failedPackages.push(name);
    }
  }

  // return to the starting branch
  run(`git checkout ${startingBranch}`, { cwd: absRepoPath });

  if (manualUpdates.length > 0) {
    console.log('Manual updates were detected and not auto-applied:', manualUpdates.map(([n, u]) => `${n} (${u.from} -> ${u.to})`).join(', '));
  }

  console.log(`PRs created: ${createdPRs.length}`);
  createdPRs.forEach(p => console.log(`- ${p.name}: ${p.url}`));
  if (failedPackages.length) {
    console.log(`Packages that failed to push/PR: ${failedPackages.join(', ')}`);
  }

  console.log('Done.');

  await writeSummary({ mode: 'pr', updates, createdPRs, manualUpdates, failedPackages });
}

main().catch(err => {
  console.error(err);
  try {
    core.setFailed(err.message || String(err));
  } catch (_) {
    // ignore if core is unavailable
  }
  process.exit(1);
});
