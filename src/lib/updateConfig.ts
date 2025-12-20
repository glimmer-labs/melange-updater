export function normalizeKeys<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((item) => normalizeKeys(item)) as unknown as T;
  if (typeof obj !== 'object') return obj;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const normalizedKey = key.replace(/-/g, '_');
    out[normalizedKey] = normalizeKeys((obj as Record<string, unknown>)[key]);
  }
  return out as unknown as T;
}
