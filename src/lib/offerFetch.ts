export type CanonicalOfferPayload = Record<string, unknown> & {
  offer?: unknown;
};

export function normalizeCanonicalOffer(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const maybeOffer = (payload as CanonicalOfferPayload).offer;
  if (maybeOffer && typeof maybeOffer === 'object') return maybeOffer as Record<string, unknown>;
  return payload as Record<string, unknown>;
}

export async function fetchCanonicalOfferPayload(offerUrls: string[]): Promise<Record<string, unknown> | null> {
  let lastError: unknown = null;
  const urls = [...new Set(offerUrls.map((url) => String(url || '').trim()).filter(Boolean))];

  for (const offerUrl of urls) {
    try {
      const response = await fetch(offerUrl, { credentials: 'include' });
      if (response.ok) {
        const offer = normalizeCanonicalOffer(await response.json());
        if (offer) return offer;
      }
    } catch {
      // Anonymous fallback below keeps public preview playback working when credentialed CORS is unavailable.
    }

    try {
      const response = await fetch(offerUrl, { credentials: 'omit' });
      if (response.ok) {
        const offer = normalizeCanonicalOffer(await response.json());
        if (offer) return offer;
      }
      lastError = new Error(`Offer unavailable: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Offer unavailable');
}
