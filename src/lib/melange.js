const fs = require('fs');
const path = require('path');
const glob = require('glob');
const yaml = require('js-yaml');

function findMelangePackages(repoPath) {
  const pattern = path.join(repoPath, '**/*.yaml');
  const files = glob.sync(pattern, { nodir: true, ignore: ['**/node_modules/**', '**/.git/**'] });
  const packages = {};
  for (const f of files) {
    try {
      const raw = fs.readFileSync(f, 'utf8');
      const doc = yaml.load(raw);
      if (doc && (doc.package || doc.Package) && doc.update) {
        const name = doc.package && doc.package.name ? doc.package.name : (doc.Package && doc.Package.name ? doc.Package.name : path.basename(f));
        packages[name] = { file: f, doc };
      }
    } catch (e) {
      // ignore parse errors
    }
  }
  return packages;
}

function writeMelangePackage(pkg) {
  const yamlStr = yaml.dump(pkg.doc);
  fs.writeFileSync(pkg.file, yamlStr, 'utf8');
}

function updateExpectedCommitInFile(filePath, commitSha) {
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
      if (/^(\s*)-\s+uses:/.test(line) && (RegExp.$1 || '').length <= baseIndent.length) break;

      const withMatch = line.match(/^(\s*)with:\s*$/);
      if (withMatch) {
        withIndent = withMatch[1] + '  ';
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

function updatePackageVersionInFile(filePath, newVersion) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let changed = false;

  // Find top-level package: block
  for (let i = 0; i < lines.length; i++) {
    if (/^package:\s*$/.test(lines[i].trim())) {
      // scan forward for indented fields
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (/^\S/.test(line)) break; // dedent => end of package block
        const m = line.match(/^(\s+)version:\s*(.*)$/);
        if (m) {
          const indent = m[1];
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

function updatePackageEpochInFile(filePath, newEpoch = 0) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^package:\s*$/.test(lines[i].trim())) {
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (/^\S/.test(line)) break;
        const m = line.match(/^(\s+)epoch:\s*(.*)$/);
        if (m) {
          const indent = m[1];
          const current = m[2].trim();
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

module.exports = { findMelangePackages, writeMelangePackage, updatePackageVersionInFile, updatePackageEpochInFile, updateExpectedCommitInFile };
