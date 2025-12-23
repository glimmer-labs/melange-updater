import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import yaml from 'js-yaml';
import { PackageDoc, PackageInfo } from '../types';
import { execSync } from 'child_process';

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

interface MelangeBumpOptions {
  repoPath: string;
  packageFile: string;
  version: string;
  expectedCommit?: string;
}

export function bumpWithMelangeTool({ repoPath, packageFile, version, expectedCommit }: MelangeBumpOptions): void {
  const relPath = path.relative(repoPath, packageFile);
  const expectedArg = expectedCommit ? ` --expected-commit ${expectedCommit}` : '';
  const cmd = `docker run --rm -v "${repoPath}":/work -w /work cgr.dev/chainguard/melange:latest bump ${relPath} ${version}${expectedArg}`;
  execSync(cmd, { stdio: 'inherit' });
}
