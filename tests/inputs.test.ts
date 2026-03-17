import { describe, expect, it } from 'vitest';
import { collectRuntimeInputs, parseBooleanFlag, validateRuntimeInputs } from '../src/core/inputs';

describe('inputs', () => {
  it('parses boolean flags from booleans and string literals', () => {
    expect(parseBooleanFlag(true)).toBe(true);
    expect(parseBooleanFlag('true')).toBe(true);
    expect(parseBooleanFlag(false)).toBe(false);
    expect(parseBooleanFlag('false')).toBe(false);
    expect(parseBooleanFlag(undefined)).toBe(false);
  });

  it('collects runtime inputs from argv and env with expected precedence', () => {
    const inputs = collectRuntimeInputs(
      {
        repository: 'owner/repo',
        token: 'token123',
        preview: true,
        'git-author-name': 'Bot',
      },
      {
        GITHUB_WORKSPACE: '/workspace',
      } as NodeJS.ProcessEnv
    );

    expect(inputs.targetRepo).toBe('owner/repo');
    expect(inputs.token).toBe('token123');
    expect(inputs.preview).toBe(true);
    expect(inputs.gitAuthorName).toBe('Bot');
    expect(inputs.repoPath).toBe('/workspace');
  });

  it('validates required repo/token combinations', () => {
    const missingRepo = validateRuntimeInputs({
      targetRepo: '',
      token: 'x',
      dryRun: false,
      preview: false,
      releaseMonitorToken: '',
      gitAuthorName: 'a',
      gitAuthorEmail: 'b',
      repoPath: '.',
      githubLabels: [],
    });

    const missingToken = validateRuntimeInputs({
      targetRepo: 'owner/repo',
      token: '',
      dryRun: false,
      preview: false,
      releaseMonitorToken: '',
      gitAuthorName: 'a',
      gitAuthorEmail: 'b',
      repoPath: '.',
      githubLabels: [],
    });

    const okInPreview = validateRuntimeInputs({
      targetRepo: 'owner/repo',
      token: '',
      dryRun: false,
      preview: true,
      releaseMonitorToken: '',
      gitAuthorName: 'a',
      gitAuthorEmail: 'b',
      repoPath: '.',
      githubLabels: [],
    });

    expect(missingRepo).toContain('No target repo specified');
    expect(missingToken).toContain('No token provided');
    expect(okInPreview).toBeNull();
  });
});
