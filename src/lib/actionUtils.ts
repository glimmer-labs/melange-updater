import { execSync, ExecSyncOptions } from 'child_process';
import * as core from '@actions/core';
import fs from 'fs';
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

// Redact common token formats so we don't leak secrets in logs or issues.
export function redactSecrets(value: string): string {
  if (!value) return value;
  let out = value;
  out = out.replace(/x-access-token:[^@\s]+@/g, 'x-access-token:[REDACTED]@');
  out = out.replace(/gh[soupm]_[A-Za-z0-9]{12,}/g, 'gh*_REDACTED');
  return out;
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
  packageErrors?: { name: string; phase: string; message: string }[];
}

const SUMMARY_MARKER = '<!-- melange-updater-summary -->';
let summaryWritten = false;

export async function writeSummary({ mode, updates = {}, createdPRs = [], manualUpdates = [], failedPackages = [], packageErrors = [] }: WriteSummaryInput): Promise<void> {
  // Skip when running outside of GitHub Actions where GITHUB_STEP_SUMMARY is missing.
  if (!core || !core.summary || !process.env.GITHUB_STEP_SUMMARY) return;
  if (summaryWritten) return;

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile && fs.existsSync(summaryFile)) {
    try {
      const existing = fs.readFileSync(summaryFile, 'utf8');
      if (existing.includes(SUMMARY_MARKER)) return;
    } catch (_) {
      // ignore read errors
    }
  }
  const s = core.summary;
  const updateEntries = Object.entries(updates || {});

  s.clear();
  s.addRaw(`${SUMMARY_MARKER}\n`);
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

  if (packageErrors.length > 0) {
    s.addHeading('Errors');
    s.addList(packageErrors.map((e) => `${e.name} (${e.phase}): ${e.message}`));
  }

  await s.write();
  summaryWritten = true;
}

export type ExecOutputFn = (cmd: string, cwd?: string) => string;

export function ensureCleanWorkingTree(cwd: string, execGetOutputFn: ExecOutputFn): string {
  const status = execGetOutputFn('git status --porcelain', cwd);
  if (status.trim()) {
    return 'Working tree is dirty. Please ensure a clean state before running the action.';
  }
  return '';
}
