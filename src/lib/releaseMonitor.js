const axios = require('axios');

const BASE = 'https://release-monitoring.org/api/v2/versions/?project_id=%d';

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function filterStableList(list, cfg) {
  if (!cfg) return list;
  const prefix = cfg.version_filter_prefix;
  const contains = cfg.version_filter_contains;
  return (list || []).filter((v) => {
    if (prefix && !String(v).startsWith(prefix)) return false;
    if (contains && !String(v).includes(contains)) return false;
    return true;
  });
}

async function getLatestReleaseVersion(identifier, opts = {}) {
  const url = BASE.replace('%d', encodeURIComponent(identifier));
  const maxRetries = opts.maxRetries || 3;
  const backoffFactor = opts.backoffFactor || 2;
  const initialBackoff = opts.initialBackoff || 1000;
  let lastErr = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const headers = {};
      if (opts.token) headers['Authorization'] = `Token ${opts.token}`;
      const resp = await axios.get(url, { headers, timeout: 15000 });
      if (resp.status === 200) {
        const data = resp.data;
        if (data && Array.isArray(data.stable_versions)) {
          const filtered = filterStableList(data.stable_versions, opts);
          if (filtered.length > 0) return filtered[0];
        }
        if (data && data.stable_versions && data.stable_versions.length === 0) {
          return '';
        }
        // Might be different casing: try latest_version or stable_versions
        if (data && data.latest_version) return data.latest_version;
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
      // retry on network errors
      const backoff = Math.pow(backoffFactor, i) * initialBackoff;
      await sleep(backoff);
    }
  }
  throw lastErr || new Error('max retries reached');
}

module.exports = { getLatestReleaseVersion };
