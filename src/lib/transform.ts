import semver from 'semver';
import { UpdateConfig } from '../types';

const DEFAULT_IGNORE_REGEX_PATTERNS = [
  '*alpha*',
  '*rc*',
  '*beta*',
  '*pre*',
  '*preview*',
  '*dev*',
  '*nightly*',
  '*snapshot*',
  '*eap*',
  '*canary*',
];

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

function globToRegex(pat: string): string {
  // Escape regex meta, then convert glob asterisks to .*
  const escaped = pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(/\*/g, '.*');
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

function resolveIgnorePatterns(updateConfig: UpdateConfig | undefined): string[] {
  const custom = Array.isArray(updateConfig?.ignore_regex_patterns) ? updateConfig.ignore_regex_patterns : [];
  return [...DEFAULT_IGNORE_REGEX_PATTERNS, ...custom];
}

export function shouldIgnoreVersion(updateConfig: UpdateConfig | undefined, versionStr: string): boolean {
  const patterns = resolveIgnorePatterns(updateConfig);
  for (const pat of patterns) {
    try {
      const re = new RegExp(pat, 'i');
      if (re.test(versionStr)) return true;
    } catch (_) {
      try {
        const re = new RegExp(globToRegex(pat), 'i');
        if (re.test(versionStr)) return true;
      } catch (_) {
        // ignore malformed regex
      }
    }
  }
  return false;
}
