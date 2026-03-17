import * as core from '@actions/core';

export interface RuntimeInputs {
  targetRepo: string;
  token: string;
  dryRun: boolean;
  preview: boolean;
  releaseMonitorToken: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
  repoPath: string;
  githubLabels: string[];
}

export function parseBooleanFlag(value: unknown): boolean {
  return value === true || value === 'true';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getInputValue(name: string, env: NodeJS.ProcessEnv, fallback = ''): string {
  try {
    const val = core.getInput(name, { trimWhitespace: true });
    if (val) return val;
  } catch (_) {
    // Ignore when running outside GitHub Actions.
  }

  const envKey = `INPUT_${name.replace(/-/g, '_').toUpperCase()}`;
  return env[envKey] || fallback;
}

export function collectRuntimeInputs(argv: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): RuntimeInputs {
  const targetRepo = readString(argv['target-repo']) || readString(argv['repository']) || getInputValue('repository', env);
  const token = readString(argv['token']) || getInputValue('token', env) || env.GITHUB_TOKEN || '';

  const dryRun =
    parseBooleanFlag(argv['dry-run']) ||
    parseBooleanFlag(getInputValue('dry_run', env)) ||
    parseBooleanFlag(getInputValue('dry-run', env));

  const preview =
    parseBooleanFlag(argv['preview']) ||
    parseBooleanFlag(argv['no-commit']) ||
    parseBooleanFlag(getInputValue('preview', env)) ||
    parseBooleanFlag(getInputValue('no_commit', env)) ||
    parseBooleanFlag(getInputValue('no-commit', env));

  const releaseMonitorToken =
    readString(argv['release-monitor-token']) || env.RELEASE_MONITOR_TOKEN || getInputValue('release_monitor_token', env) || '';

  const gitAuthorName = readString(argv['git-author-name']) || getInputValue('git_author_name', env) || 'melange-updater';
  const gitAuthorEmail = readString(argv['git-author-email']) || getInputValue('git_author_email', env) || 'noreply@example.com';
  const repoPath = readString(argv['repo-path']) || getInputValue('repo_path', env) || env.GITHUB_WORKSPACE || '.';

  const githubLabels =
    (readString(argv['github-labels']) ||
      readString(argv['github_labels']) ||
      getInputValue('github_labels', env) ||
      getInputValue('github-labels', env) ||
      '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  return {
    targetRepo,
    token,
    dryRun,
    preview,
    releaseMonitorToken,
    gitAuthorName,
    gitAuthorEmail,
    repoPath,
    githubLabels,
  };
}

export function validateRuntimeInputs(inputs: RuntimeInputs): string | null {
  if (!inputs.targetRepo) {
    return 'No target repo specified. Use --target-repo owner/repo';
  }

  if (!/^[^\s/]+\/[^\s/]+$/.test(inputs.targetRepo)) {
    return 'Invalid target repo format. Expected owner/repo';
  }

  if (!inputs.token && !inputs.dryRun && !inputs.preview) {
    return 'No token provided. Use --token or set GITHUB_TOKEN (or run with --dry-run/--preview/--no-commit)';
  }

  return null;
}
