type OriginsRegistry = {
  origins?: unknown;
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

export async function loadConfiguredOrigins(): Promise<string[]> {
  const envOrigins = parseCsvOrigins(String(import.meta.env.VITE_CERTIFYD_ORIGINS || ""));

  let fileOrigins: string[] = [];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}origins.json`, { cache: "no-store" });
    if (res.ok) {
      const payload = (await res.json()) as OriginsRegistry;
      fileOrigins = extractRegistryOrigins(payload);
    }
  } catch {
    // Missing/malformed origins.json is tolerated for static compatibility.
  }

  return dedupeOrigins([...fileOrigins, ...envOrigins]);
}

