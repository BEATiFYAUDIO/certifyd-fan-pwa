export function normalizeCanonicalOrigin(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return '';
  }
}
