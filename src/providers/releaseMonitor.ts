const BASE = 'https://release-monitoring.org/api/v2/versions/?project_id=%d';

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function filterStableList(list: unknown[], cfg: { version_filter_prefix?: string; version_filter_contains?: string } | undefined) {
  if (!cfg) return list;
  const prefix = cfg.version_filter_prefix;
  const contains = cfg.version_filter_contains;
  return (list || []).filter((v) => {
    if (prefix && !String(v).startsWith(prefix)) return false;
    if (contains && !String(v).includes(contains)) return false;
    return true;
  });
}

interface ReleaseMonitorOptions {
  token?: string;
  version_filter_prefix?: string;
  version_filter_contains?: string;
  maxRetries?: number;
  backoffFactor?: number;
  initialBackoff?: number;
}

export async function getLatestReleaseVersion(identifier: string | number, opts: ReleaseMonitorOptions = {}): Promise<string> {
  const url = BASE.replace('%d', encodeURIComponent(String(identifier)));
  const maxRetries = opts.maxRetries || 3;
  const backoffFactor = opts.backoffFactor || 2;
  const initialBackoff = opts.initialBackoff || 1000;
  let lastErr: unknown = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const headers: Record<string, string> = {};
      if (opts.token) headers['Authorization'] = `Token ${opts.token}`;
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (resp.status === 200) {
        const data = (await resp.json()) as any;
        if (data && Array.isArray(data.stable_versions)) {
          const filtered = filterStableList(data.stable_versions, opts);
          if (filtered.length > 0) return filtered[0] as string;
        }
        if (data && data.stable_versions && data.stable_versions.length === 0) {
          return '';
        }
        if (data && data.latest_version) return data.latest_version as string;
        return '';
      }
      lastErr = new Error(`Non-OK HTTP ${resp.status}`);
      if (resp.status === 500 || resp.status === 503) {
        const backoff = Math.pow(backoffFactor, i) * initialBackoff;
        await sleep(backoff);
        continue;
      }
      break;
    } catch (err) {
      lastErr = err;
      const backoff = Math.pow(backoffFactor, i) * initialBackoff;
      await sleep(backoff);
    }
  }
  throw (lastErr instanceof Error ? lastErr : new Error('max retries reached'));
}
