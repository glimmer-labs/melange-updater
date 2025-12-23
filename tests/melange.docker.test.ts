import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
import { bumpWithMelangeTool } from '../src/lib/melange';
import { ensureDockerAvailable } from '../src/lib/actionUtils';

const hasDocker = ensureDockerAvailable() === '';

(hasDocker ? describe : describe.skip)('melange bump integration (docker)', () => {
  it('bumps version/epoch/expected-commit via melange CLI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'melange-docker-'));
    const file = path.join(dir, 'pkg.yaml');
    fs.writeFileSync(
      file,
      `package:\n  name: demo\n  version: 0.1.0\n  epoch: 2\nupdate:\n  enabled: true\npipeline:\n  - uses: git-checkout\n    with:\n      repository: example/repo\n      branch: example\n      expected-commit: oldsha\n`,
      'utf8'
    );

    // Pull image if not present to reduce flakes.
    execSync('docker pull cgr.dev/chainguard/melange:latest', { stdio: 'inherit' });

    bumpWithMelangeTool({
      repoPath: dir,
      packageFile: file,
      version: '1.2.3',
      expectedCommit: 'deadbeef',
    });

    const updated = fs.readFileSync(file, 'utf8');
    const doc = yaml.load(updated) as any;
    expect(doc.package.version).toBe('1.2.3');
    expect(doc.package.epoch).toBe(0);
    const pipeline = Array.isArray(doc.pipeline) ? doc.pipeline : [];
    const checkout = pipeline.find((p: any) => p?.uses === 'git-checkout');
    const expectedCommit = checkout?.with?.['expected-commit'];
    expect(expectedCommit).toBe('deadbeef');
  });
});
