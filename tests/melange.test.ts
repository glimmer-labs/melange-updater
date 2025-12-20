import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyVersionToPackage, updateExpectedCommitInFile } from '../src/lib/melange';
import { PackageInfo } from '../src/types';

function writeYaml(file: string, contents: string) {
  fs.writeFileSync(file, contents, 'utf8');
}

describe('melange helpers', () => {
  it('updates version and resets epoch in place', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'melange-'));
    const file = path.join(dir, 'pkg.yaml');
    writeYaml(
      file,
      `package:\n  name: demo\n  version: 1.0.0\n  epoch: 2\nupdate:\n  enabled: true\n`
    );
    const pkg: PackageInfo = {
      file,
      doc: {
        package: { name: 'demo', version: '1.0.0', epoch: 2 },
        update: { enabled: true },
      },
    };

    const changed = applyVersionToPackage(pkg, '2.3.4');
    const updated = fs.readFileSync(file, 'utf8');

    expect(changed).toBe(true);
    expect(updated).toContain('version: 2.3.4');
    expect(updated).toContain('epoch: 0');
  });

  it('inserts expected-commit under git-checkout step', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'melange-'));
    const file = path.join(dir, 'pkg.yaml');
    writeYaml(
      file,
      `pipeline:\n  - uses: git-checkout\n    with:\n      repository: example/repo\n      branch: main\n`
    );

    const inserted = updateExpectedCommitInFile(file, 'deadbeef');
    const updated = fs.readFileSync(file, 'utf8');

    expect(inserted).toBe(true);
    expect(updated).toContain('expected-commit: deadbeef');
  });
});
