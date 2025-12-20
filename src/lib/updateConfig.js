function normalizeKeys(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    const nk = k.replace(/-/g, '_');
    out[nk] = normalizeKeys(obj[k]);
  }
  return out;
}

module.exports = { normalizeKeys };
