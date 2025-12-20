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

module.exports = { findMelangePackages, writeMelangePackage, updatePackageVersionInFile };
