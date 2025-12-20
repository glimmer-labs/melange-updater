import semver from 'semver';
import { UpdateConfig } from '../types';

function stripAffixes(cfg: { strip_prefix?: string; strip_suffix?: string } | undefined, v: string): string {
  let out = v;
  if (!cfg) return out;
  if (cfg.strip_prefix && out.startsWith(cfg.strip_prefix)) {
    out = out.slice(cfg.strip_prefix.length);
  }
  if (cfg.strip_suffix && out.endsWith(cfg.strip_suffix)) {
    out = out.slice(0, -cfg.strip_suffix.length);
  }
  return out;
}

function applyVersionTransformsList(list: { match: string; replace: string }[] | undefined, v: string): string {
  if (!Array.isArray(list)) return v;
  let out = v;
  for (const rule of list) {
    if (!rule || !rule.match || rule.replace === undefined) continue;
    try {
      const re = new RegExp(rule.match);
      out = out.replace(re, rule.replace);
    } catch (_) {
      // ignore bad regex
    }
  }
  return out;
}

export function applyTransforms(updateConfig: UpdateConfig | undefined, versionStr: string): string {
  let v = versionStr;
  if (!v) return v;

  if (updateConfig?.version_separator) {
    v = v.split(updateConfig.version_separator).join('.');
  }

  if (updateConfig?.release_monitor) {
    v = stripAffixes(updateConfig.release_monitor, v);
  }
  if (updateConfig?.github) {
    v = stripAffixes(updateConfig.github, v);
  }
  if (updateConfig?.git) {
    v = stripAffixes(updateConfig.git, v);
  }

  if (updateConfig?.version_transform) {
    v = applyVersionTransformsList(updateConfig.version_transform, v);
  }

  if (!semver.valid(v)) {
    const coerced = semver.coerce(v);
    if (coerced) v = coerced.version;
  }
  return v;
}

export function shouldIgnoreVersion(updateConfig: UpdateConfig | undefined, versionStr: string): boolean {
  if (!updateConfig || !Array.isArray(updateConfig.ignore_regex_patterns)) return false;
  for (const pat of updateConfig.ignore_regex_patterns) {
    try {
      const re = new RegExp(pat);
      if (re.test(versionStr)) return true;
    } catch (_) {
      // ignore malformed regex
    }
  }
  return false;
}
