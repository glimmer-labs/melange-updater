const semver = require('semver');

function stripAffixes(cfg, v) {
  if (!cfg) return v;
  if (cfg.strip_prefix && v.startsWith(cfg.strip_prefix)) {
    v = v.slice(cfg.strip_prefix.length);
  }
  if (cfg.strip_suffix && v.endsWith(cfg.strip_suffix)) {
    v = v.slice(0, -cfg.strip_suffix.length);
  }
  return v;
}

function applyVersionTransformsList(list, v) {
  if (!Array.isArray(list)) return v;
  let out = v;
  for (const rule of list) {
    if (!rule || !rule.match || rule.replace === undefined) continue;
    try {
      const re = new RegExp(rule.match);
      out = out.replace(re, rule.replace);
    } catch (e) {
      // ignore bad regex
    }
  }
  return out;
}

function applyTransforms(updateConfig, versionStr) {
  let v = versionStr;
  if (!v) return v;

  // separator
  if (updateConfig && updateConfig.version_separator) {
    v = v.split(updateConfig.version_separator).join('.');
  }

  // provider-specific strips
  if (updateConfig && updateConfig.release_monitor) {
    v = stripAffixes(updateConfig.release_monitor, v);
  }
  if (updateConfig && updateConfig.github) {
    v = stripAffixes(updateConfig.github, v);
  }
  if (updateConfig && updateConfig.git) {
    v = stripAffixes(updateConfig.git, v);
  }

  // version-transform rules
  if (updateConfig && updateConfig.version_transform) {
    v = applyVersionTransformsList(updateConfig.version_transform, v);
  }

  // Basic semver normalization: if it's not valid, try to coerce
  if (!semver.valid(v)) {
    const coerced = semver.coerce(v);
    if (coerced) v = coerced.version;
  }
  return v;
}

function shouldIgnoreVersion(updateConfig, versionStr) {
  if (!updateConfig || !Array.isArray(updateConfig.ignore_regex_patterns)) return false;
  for (const pat of updateConfig.ignore_regex_patterns) {
    try {
      const re = new RegExp(pat);
      if (re.test(versionStr)) return true;
    } catch (e) {
      // ignore malformed regex
    }
  }
  return false;
}

module.exports = { applyTransforms, shouldIgnoreVersion };
