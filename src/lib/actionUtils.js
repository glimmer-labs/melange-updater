const { execSync } = require('child_process');
const core = require('@actions/core');

function run(cmd, opts = {}) {
  console.log('>', cmd);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function execGetOutput(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8' });
  } catch (e) {
    return '';
  }
}

function escapeShell(s) {
  return s.replace(/"/g, '\\"');
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function failAndExit(message) {
  console.error(message);
  try {
    core.setFailed(message);
  } catch (_) {
    // core may be unavailable in CLI mode
  }
  process.exit(1);
}

async function writeSummary({ mode, updates = {}, createdPRs = [], manualUpdates = [], failedPackages = [] }) {
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

function ensureCleanWorkingTree(cwd, execGetOutputFn) {
  const status = execGetOutputFn('git status --porcelain', cwd);
  if (status.trim()) {
    return 'Working tree is dirty. Please ensure a clean state before running the action.';
  }
  return '';
}

module.exports = { run, execGetOutput, escapeShell, sanitizeName, failAndExit, writeSummary, ensureCleanWorkingTree };
