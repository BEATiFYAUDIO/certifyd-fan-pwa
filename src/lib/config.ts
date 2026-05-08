export function getConfiguredOrigins(): string[] {
  const raw = String(import.meta.env.VITE_CERTIFYD_ORIGINS || '').trim();
  return raw
    .split(',')
    .map((v) => v.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}
