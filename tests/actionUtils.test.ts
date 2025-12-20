import { describe, it, expect } from 'vitest';
import { sanitizeName, escapeShell, ensureCleanWorkingTree } from '../src/lib/actionUtils';

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
});
