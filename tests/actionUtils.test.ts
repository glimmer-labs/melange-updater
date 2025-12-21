import { describe, it, expect } from 'vitest';
import { sanitizeName, escapeShell, ensureCleanWorkingTree, redactSecrets } from '../src/lib/actionUtils';

describe('action utils', () => {
  it('sanitizes names by replacing disallowed characters', () => {
    const name = sanitizeName('hello world/+');
    expect(name).toBe('hello-world--');
  });

  it('escapes double quotes for shell usage', () => {
    const value = escapeShell('foo "bar"');
    expect(value).toBe('foo \\\"bar\\\"');
  });

  it('detects dirty working tree', () => {
    const message = ensureCleanWorkingTree('/tmp', () => ' M file.txt\n');
    expect(message).toContain('Working tree is dirty');
  });

  it('returns empty string for clean working tree', () => {
    const message = ensureCleanWorkingTree('/tmp', () => '   \n');
    expect(message).toBe('');
  });

  it('redacts common token shapes', () => {
    const input = [
      'https://x-access-token:ghs_ABC1234567890@github.com/repo.git',
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'pat github_pat_11AABBCC1234567890XYZ',
      'jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    ].join(' | ');
    const out = redactSecrets(input);
    expect(out).not.toMatch(/gh[sop]_/);
    expect(out).not.toContain('github_pat_');
    expect(out).not.toContain('eyJhbGci');
    expect(out).toContain('x-access-token:[REDACTED]@');
  });
});
