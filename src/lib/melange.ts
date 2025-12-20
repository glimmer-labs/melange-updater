import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import yaml from 'js-yaml';
import { PackageDoc, PackageInfo } from '../types';

export function findMelangePackages(repoPath: string): Record<string, PackageInfo> {
  const pattern = path.join(repoPath, '**/*.yaml');
  const files = globSync(pattern, { nodir: true, ignore: ['**/node_modules/**', '**/.git/**'] });
  const packages: Record<string, PackageInfo> = {};
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const doc = yaml.load(raw) as PackageDoc | undefined;
      if (doc && (doc.package || doc.Package) && doc.update) {
        const name = doc.package?.name || doc.Package?.name || path.basename(file);
        packages[name] = { file, doc };
      }
    } catch (_) {
      // ignore parse errors
    }
  }
  return packages;
}

export function writeMelangePackage(pkg: PackageInfo): void {
  const yamlStr = yaml.dump(pkg.doc);
  fs.writeFileSync(pkg.file, yamlStr, 'utf8');
}

export function updateExpectedCommitInFile(filePath: string, commitSha: string): boolean {
  if (!commitSha) return false;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const usesMatch = lines[i].match(/^(\s*)-\s+uses:\s+git-checkout/);
    if (!usesMatch) continue;
    const baseIndent = usesMatch[1] || '';
    let withIndent = '';
    let branchLine = -1;
    let expectedLine = -1;
    let insertPos = -1;

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) continue;
      const nestedUses = line.match(/^(\s*)-\s+uses:/);
      if (nestedUses && (nestedUses[1] || '').length <= baseIndent.length) break;

      const withMatch = line.match(/^(\s*)with:\s*$/);
      if (withMatch) {
        withIndent = `${withMatch[1]}  `;
        insertPos = j + 1;
        continue;
      }

      if (withIndent) {
        if (line.includes('expected-commit:')) {
          expectedLine = j;
          break;
        }
        if (line.includes('branch:')) branchLine = j;
        insertPos = j + 1;
      }
    }

    if (expectedLine >= 0) {
      const indent = (lines[expectedLine].match(/^\s*/) || [''])[0];
      lines[expectedLine] = `${indent}expected-commit: ${commitSha}`;
      changed = true;
    } else if (withIndent) {
      const idx = branchLine >= 0 ? branchLine + 1 : insertPos >= 0 ? insertPos : i + 1;
      lines.splice(idx, 0, `${withIndent}expected-commit: ${commitSha}`);
      changed = true;
    }
    break;
  }

  if (!changed) return false;
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return true;
}

export function updatePackageVersionInFile(filePath: string, newVersion: string): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^package:\s*$/.test(lines[i].trim())) {
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (/^\S/.test(line)) break;
        const match = line.match(/^(\s+)version:\s*(.*)$/);
        if (match) {
          const indent = match[1];
          lines[j] = `${indent}version: ${newVersion}`;
          changed = true;
          break;
        }
      }
      break;
    }
  }

  if (!changed) return false;
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return true;
}

export function updatePackageEpochInFile(filePath: string, newEpoch = 0): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^package:\s*$/.test(lines[i].trim())) {
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (/^\S/.test(line)) break;
        const match = line.match(/^(\s+)epoch:\s*(.*)$/);
        if (match) {
          const indent = match[1];
          const current = match[2].trim();
          if (current !== String(newEpoch)) {
            lines[j] = `${indent}epoch: ${newEpoch}`;
            changed = true;
          }
          break;
        }
      }
      break;
    }
  }

  if (!changed) return false;
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return true;
}

export function applyVersionToPackage(pkg: PackageInfo, newVersion: string): boolean {
  const versionUpdated = updatePackageVersionInFile(pkg.file, newVersion);
  const epochUpdated = updatePackageEpochInFile(pkg.file, 0);
  if (versionUpdated || epochUpdated) return true;

  if (pkg.doc.package?.version !== undefined) {
    pkg.doc.package.version = newVersion;
    if (typeof pkg.doc.package.epoch !== 'undefined') pkg.doc.package.epoch = 0;
    writeMelangePackage(pkg);
    return true;
  }
  if (pkg.doc.Package?.version !== undefined) {
    pkg.doc.Package.version = newVersion;
    if (typeof pkg.doc.Package.epoch !== 'undefined') pkg.doc.Package.epoch = 0;
    writeMelangePackage(pkg);
    return true;
  }
  return false;
}
