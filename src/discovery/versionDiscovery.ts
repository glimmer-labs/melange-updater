import semver from 'semver';
import { Octokit } from '@octokit/rest';
import { resolveExpectedCommit } from '../providers/commitResolver';
import { getLatestGitTag } from '../providers/gitTags';
import { getLatestGithubRelease } from '../providers/githubReleases';
import { getGitBranchFromPipeline, getGitRepoFromPipeline } from './pipeline';
import { getLatestReleaseVersion } from '../providers/releaseMonitor';
import { applyTransforms, shouldIgnoreVersion } from './transform';
import { normalizeKeys } from './updateConfig';
import { PackageInfo, UpdateConfig, UpdateEntry } from '../types';
import { createLogger, Logger } from '../core/logger';

interface DiscoverPackageUpdateArgs {
  name: string;
  pkg: PackageInfo;
  octo: Octokit;
  releaseMonitorToken: string;
  logger?: Logger;
}

export async function discoverPackageUpdate({
  name,
  pkg,
  octo,
  releaseMonitorToken,
  logger,
}: DiscoverPackageUpdateArgs): Promise<UpdateEntry | null> {
  const log = logger || createLogger(`discover:${name}`);
  const updateCfgRaw = pkg.doc.update || {};
  const updateCfg = normalizeKeys(updateCfgRaw) as UpdateConfig;

  if (updateCfg.enabled === false) {
    log.info('update.enabled is false - skipping');
    return null;
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
    log.info(`querying release-monitor id ${id}`);
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
      log.info(`querying GitHub releases ${owner}/${repo}`);
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
      log.info(`querying git tags from ${repoUrl}`);
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
        log.warn(`failed to query git tags: ${msg}`);
      }
    }
  }

  if (!latest) {
    log.info('no candidate latest version found');
    return null;
  }

  const transformed = applyTransforms(updateCfg, latest);
  log.info(`latest raw=${latest} transformed=${transformed}`);

  if (shouldIgnoreVersion(updateCfg, transformed, latest)) {
    log.info(`version ${transformed} ignored by ignore-regex-patterns`);
    return null;
  }

  const currentVersion = pkg.doc.package?.version || pkg.doc.Package?.version || '';
  if (!currentVersion) {
    log.info('no current version in package metadata');
  }

  let shouldUpdate = false;
  if (semver.valid(transformed) && semver.valid(currentVersion)) {
    shouldUpdate = semver.gt(transformed, currentVersion);
  } else if (transformed !== currentVersion) {
    shouldUpdate = true;
  }

  if (!shouldUpdate) {
    return null;
  }

  log.info(`will update ${currentVersion} -> ${transformed}${isManual ? ' (manual)' : ''}`);

  let commitSha = '';
  const tagCandidates: string[] = [];

  if (tagForCommit && transformed && transformed !== tagForCommit && (latestSource === 'github' || latestSource === 'git')) {
    tagCandidates.push(transformed);
  }

  if (tagForCommit) {
    tagCandidates.push(tagForCommit);
  }

  if (!isManual) {
    commitSha = await resolveExpectedCommit({
      source: latestSource,
      tag: tagForCommit,
      tagCandidates,
      repoUrl: repoUrlForCommit,
      branch: branchForCommit,
      owner: githubOwner,
      repo: githubRepoName,
      octo,
      packageName: name,
    });
  }

  return {
    from: currentVersion,
    to: transformed,
    file: pkg.file,
    manual: isManual,
    commit: commitSha,
  };
}
