type OriginsRegistry = {
  origins?: unknown;
  trustedContentUrls?: unknown;
};

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isAllowedOrigin(raw: string): boolean {
  const v = normalizeOrigin(raw);
  if (!v) return false;
  if (v.startsWith("https://")) return true;
  if (v.startsWith("http://localhost")) return true;
  if (v.startsWith("http://127.0.0.1")) return true;
  return false;
}

function parseCsvOrigins(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((v) => normalizeOrigin(v))
    .filter((v) => isAllowedOrigin(v));
}

function normalizeTrustedContentUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function isAllowedTrustedContentUrl(raw: string): boolean {
  const normalized = normalizeTrustedContentUrl(raw);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return true;
    return false;
  } catch {
    return false;
  }
}

function parseCsvTrustedContentUrls(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((v) => normalizeTrustedContentUrl(v))
    .filter((v) => isAllowedTrustedContentUrl(v));
}

function dedupeOrigins(origins: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const origin of origins) {
    const normalized = normalizeOrigin(origin);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function extractRegistryOrigins(payload: OriginsRegistry | null): string[] {
  if (!payload || !Array.isArray(payload.origins)) return [];
  return payload.origins
    .map((v) => (typeof v === "string" ? normalizeOrigin(v) : ""))
    .filter((v) => isAllowedOrigin(v));
}

function dedupeTrustedContentUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const normalized = normalizeTrustedContentUrl(url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function extractRegistryTrustedContentUrls(payload: OriginsRegistry | null): string[] {
  if (!payload || !Array.isArray(payload.trustedContentUrls)) return [];
  return payload.trustedContentUrls
    .map((v) => (typeof v === "string" ? normalizeTrustedContentUrl(v) : ""))
    .filter((v) => isAllowedTrustedContentUrl(v));
}

async function loadOriginsRegistry(): Promise<OriginsRegistry | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}origins.json`, { cache: "no-store" });
    if (res.ok) return (await res.json()) as OriginsRegistry;
  } catch {
    // Missing/malformed origins.json is tolerated for static compatibility.
  }
  return null;
}

export async function loadConfiguredOrigins(): Promise<string[]> {
  const envOrigins = parseCsvOrigins(String(import.meta.env.VITE_CERTIFYD_ORIGINS || ""));
  const fileOrigins = extractRegistryOrigins(await loadOriginsRegistry());

  return dedupeOrigins([...fileOrigins, ...envOrigins]);
}

export async function loadConfiguredTrustedContentUrls(): Promise<string[]> {
  const envUrls = parseCsvTrustedContentUrls(String(import.meta.env.VITE_CERTIFYD_TRUSTED_CONTENT_URLS || ""));
  const fileUrls = extractRegistryTrustedContentUrls(await loadOriginsRegistry());

  return dedupeTrustedContentUrls([...fileUrls, ...envUrls]);
}
