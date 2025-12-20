import { execSync, ExecSyncOptions } from 'child_process';
import * as core from '@actions/core';
import { UpdateEntry, UpdateMap } from '../types';

export function run(cmd: string, opts: ExecSyncOptions = {}): void {
  console.log('>', cmd);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

export function execGetOutput(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8' });
  } catch (_) {
    return '';
  }
}

export function escapeShell(value: string): string {
  return value.replace(/"/g, '\\"');
}

export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function failAndExit(message: string): never {
  console.error(message);
  try {
    core.setFailed(message);
  } catch (_) {
    // core may be unavailable in CLI mode
  }
  process.exit(1);
}

interface WriteSummaryInput {
  mode?: string;
  updates?: UpdateMap;
  createdPRs?: { name: string; url: string }[];
  manualUpdates?: Array<[string, UpdateEntry]>;
  failedPackages?: string[];
}

export async function writeSummary({ mode, updates = {}, createdPRs = [], manualUpdates = [], failedPackages = [] }: WriteSummaryInput): Promise<void> {
  // Skip when running outside of GitHub Actions where GITHUB_STEP_SUMMARY is missing.
  if (!core || !core.summary || !process.env.GITHUB_STEP_SUMMARY) return;
  const s = core.summary;
  const updateEntries = Object.entries(updates || {});

  s.clear();
  s.addHeading('Melange updater');
  if (mode) s.addRaw(`Mode: ${mode}\n\n`);

  if (updateEntries.length > 0) {
    s.addTable([
      [
        { data: 'Package', header: true },
        { data: 'From', header: true },
        { data: 'To', header: true },
        { data: 'Manual', header: true },
        { data: 'Commit', header: true },
      ],
      ...updateEntries.map(([name, u]) => [name, u.from || '', u.to || '', u.manual ? 'yes' : 'no', u.commit || '']),
    ]);
  } else {
    s.addRaw('No updates detected.\n\n');
  }

  if (createdPRs.length > 0) {
    s.addHeading('Created PRs');
    s.addList(createdPRs.map((p) => `${p.name}: ${p.url}`));
  }

  if (manualUpdates.length > 0) {
    s.addHeading('Manual updates');
    s.addList(manualUpdates.map(([name, u]) => `${name}: ${u.from || ''} -> ${u.to || ''}`));
  }

  if (failedPackages.length > 0) {
    s.addHeading('Failures');
    s.addList(failedPackages);
  }

  await s.write();
}

export type ExecOutputFn = (cmd: string, cwd?: string) => string;

export function ensureCleanWorkingTree(cwd: string, execGetOutputFn: ExecOutputFn): string {
  const status = execGetOutputFn('git status --porcelain', cwd);
  if (status.trim()) {
    return 'Working tree is dirty. Please ensure a clean state before running the action.';
  }
  return '';
}
