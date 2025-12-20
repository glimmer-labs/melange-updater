#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const minimist = require('minimist');
const core = require('@actions/core');
const { Octokit } = require('@octokit/rest');
const { getLatestReleaseVersion } = require('./lib/releaseMonitor');
const { getLatestGithubRelease } = require('./lib/githubReleases');
const { getLatestGitTag } = require('./lib/gitTags');
const { findMelangePackages, writeMelangePackage, updatePackageVersionInFile } = require('./lib/melange');
const { applyTransforms, shouldIgnoreVersion } = require('./lib/transform');
const semver = require('semver');

function run(cmd, opts = {}) {
  console.log('>', cmd);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function execGetOutput(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8' });
  } catch (e) {
    return '';
  }
}

function escapeShell(s) {
  return s.replace(/"/g, '\\"');
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function applyVersionToPackage(pkg, newVersion) {
  // First try targeted in-place replacement to preserve formatting
  const replaced = updatePackageVersionInFile(pkg.file, newVersion);
  if (replaced) return true;

  // Fallback to full YAML write if pattern not found
  if (pkg.doc.package && pkg.doc.package.version) {
    pkg.doc.package.version = newVersion;
    writeMelangePackage(pkg);
    return true;
  }
  if (pkg.doc.Package && pkg.doc.Package.version) {
    pkg.doc.Package.version = newVersion;
    writeMelangePackage(pkg);
    return true;
  }
  return false;
}

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
    console.error('No target repo specified. Use --target-repo owner/repo');
    process.exit(1);
  }
  if (!/^[^\s/]+\/[^\s/]+$/.test(targetRepo)) {
    console.error('Invalid target repo format. Expected owner/repo');
    process.exit(1);
  }
  if (!token && !dryRun && !preview) {
    console.error('No token provided. Use --token or set GITHUB_TOKEN (or run with --dry-run/--preview/--no-commit)');
    process.exit(1);
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

  async function createIssueForPackage(pkgName, message, phase) {
    if (!token) {
      console.warn(`Cannot create issue for ${pkgName} (${phase}): no token available.`);
      return;
    }
    try {
      const [owner, repo] = targetRepo.split('/');
      const title = `melange updater failure for ${pkgName}`;
      const body = `melange updater encountered an error ${phase ? `during ${phase} ` : ''}for package **${pkgName}**.\n\nError: ${message}`;
      await octo.rest.issues.create({ owner, repo, title, body });
      console.log(`Created issue for ${pkgName}: ${title}`);
    } catch (e) {
      console.warn(`Failed to create issue for ${pkgName}: ${e.message}`);
    }
  }

  function ensureCleanWorkingTree() {
    const status = execGetOutput('git status --porcelain', absRepoPath);
    if (status.trim()) {
      console.error('Working tree is dirty. Please ensure a clean state before running the action.');
      return false;
    }
    return true;
  }

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
      if (updateCfg.release_monitor && updateCfg.release_monitor.identifier) {
        const id = updateCfg.release_monitor.identifier;
        console.log(`${name}: querying release-monitor id ${id}`);
        latest = await getLatestReleaseVersion(id, {
          token: releaseMonitorToken,
          version_filter_prefix: updateCfg.release_monitor.version_filter_prefix,
          version_filter_contains: updateCfg.release_monitor.version_filter_contains,
        });
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
        updates[name] = { from: currentVersion, to: transformed, file: pkg.file, manual: isManual };
        // do not write files yet; we'll apply changes only if there are updates and not in dry-run
      }
    } catch (e) {
      console.warn(`failed to process package ${name}: ${e.message}`);
      if (!dryRun && !preview) {
        await createIssueForPackage(name, e.message, 'version discovery');
      }
    }
  }

  // If no updates detected, exit without creating any branch or committing
  const updatesCount = Object.keys(updates).length;
  if (updatesCount === 0) {
    console.log('No updates detected. Exiting without creating a branch.');
    if (dryRun) console.log('Dry run mode: nothing was changed.');
    return;
  }

  // If dry-run and there are updates, just print what would be done and exit
  if (dryRun) {
    console.log('Dry run enabled — the following updates would be applied:');
    console.log(JSON.stringify(updates, null, 2));
    return;
  }

  // Preview/no-commit mode: apply updates locally to files, write summary, but do NOT branch/commit/push/PR
  if (preview) {
    for (const [name, u] of Object.entries(updates)) {
      if (u.manual) continue;
      const pkg = packages[name];
      if (!pkg) continue;
      applyVersionToPackage(pkg, u.to);
    }
    console.log('Preview mode: updates applied locally; no branch/commit/push/PR.');
    return;
  }

  // Proceed to create a PR per non-manual package update
  const nonManualUpdates = Object.entries(updates).filter(([, u]) => !u.manual);
  const manualUpdates = Object.entries(updates).filter(([, u]) => u.manual);

  if (nonManualUpdates.length === 0) {
    console.log('Only manual updates detected; nothing to auto-apply.');
    return;
  }

  const [owner, repo] = targetRepo.split('/');
  const { data: repoData } = await octo.rest.repos.get({ owner, repo });
  const defaultBranch = repoData.default_branch || 'main';
  const startingBranch = execGetOutput('git rev-parse --abbrev-ref HEAD', absRepoPath).trim() || defaultBranch;
  const remoteUrl = `https://x-access-token:${token}@github.com/${targetRepo}.git`;

  if (!ensureCleanWorkingTree()) {
    return;
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
        await createIssueForPackage(name, pushErr.message, 'git push');
        run(`git checkout ${defaultBranch}`, { cwd: absRepoPath });
        continue;
      }

      const prTitle = `Automated update for ${name}`;
      const prBody = `This PR updates ${name}: ${u.from} -> ${u.to}${githubLabels.length ? `\n\nLabels: ${githubLabels.join(', ')}` : ''}`;

      const { data: pr } = await octo.rest.pulls.create({ owner, repo, title: prTitle, head: branch, base: defaultBranch, body: prBody });
      console.log('Created PR:', pr.html_url);
      createdPRs.push({ name, url: pr.html_url });

      if (githubLabels.length > 0) {
        try {
          await octo.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels: githubLabels });
          console.log(`Added labels to PR for ${name}: ${githubLabels.join(', ')}`);
        } catch (labelErr) {
          console.warn(`Failed adding labels for ${name}: ${labelErr.message}`);
        }
      }

      // return to default branch for the next package
      run(`git checkout ${defaultBranch}`, { cwd: absRepoPath });
    } catch (e) {
      console.warn(`Failed to create PR for ${name}: ${e.message}`);
      await createIssueForPackage(name, e.message, 'PR creation');
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
}

main().catch(err => { console.error(err); process.exit(1); });
