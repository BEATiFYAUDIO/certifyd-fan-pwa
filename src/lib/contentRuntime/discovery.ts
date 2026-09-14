import { fetchDiscoverablePage } from '../api';
import { loadConfiguredOrigins, loadConfiguredTrustedContentUrls } from '../config';
import { dedupeDiscoveryItems, sortNewestFirst } from '../discoveryViewModel';
import { isRenderableDiscoveryItem } from '../discoveryGuard';
import { normalizeCanonicalOffer } from '../offerFetch';
import type { DiscoverableItem, Topic } from '../types';

const DISCOVERY_FIRST_PASS_TIMEOUT_MS = 4500;
const DISCOVERY_FALLBACK_TIMEOUT_MS = 7000;
const DISCOVERY_MAX_PAGES_PER_ORIGIN = 2;
const DISCOVERY_RUNTIME_CACHE_MS = 60_000;

const discoverableByIdCache = new Map<string, { expiresAt: number; promise: Promise<DiscoverableItem | null> }>();
const discoveryItemsCache = new Map<string, { expiresAt: number; promise: Promise<DiscoverableItem[]> }>();
const trustedContentItemsCache = new Map<string, { expiresAt: number; promise: Promise<DiscoverableItem[]> }>();

function cacheKeyForId(contentId: string, originHint: string | null): string {
  return `${originHint || '*'}::${contentId}`;
}

async function findDiscoverableInOrigin(contentId: string, origin: string, timeoutMs: number): Promise<DiscoverableItem | null> {
  try {
    const response = await fetchDiscoverablePage({ origin, topic: 'all', limit: 24, timeoutMs });
    return response.items.find((item) => item.contentId === contentId) || null;
  } catch {
    return null;
  }
}

function resolveUrl(value: unknown, origin: string): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed, `${origin}/`).toString();
  } catch {
    return '';
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function topicValue(value: unknown): DiscoverableItem['primaryTopic'] {
  const normalized = text(value).toLowerCase();
  if (
    normalized === 'entertainment' ||
    normalized === 'music' ||
    normalized === 'news' ||
    normalized === 'gaming' ||
    normalized === 'sports' ||
    normalized === 'technology'
  ) {
    return normalized;
  }
  return null;
}

function deriveTrustedOfferEndpoint(url: string): { origin: string; buyUrl: string; offerUrl: string; contentId: string } | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0] === 'buy' && segments[1] && segments[2] !== 'offer') {
      const contentId = segments[1];
      return {
        origin: parsed.origin,
        buyUrl: `${parsed.origin}/buy/${encodeURIComponent(contentId)}`,
        offerUrl: `${parsed.origin}/buy/content/${encodeURIComponent(contentId)}/offer`,
        contentId,
      };
    }
    if (segments[0] === 'buy' && segments[1] === 'content' && segments[2] && segments[3] === 'offer') {
      const contentId = segments[2];
      return {
        origin: parsed.origin,
        buyUrl: `${parsed.origin}/buy/${encodeURIComponent(contentId)}`,
        offerUrl: parsed.toString(),
        contentId,
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchTrustedOffer(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const endpoint = deriveTrustedOfferEndpoint(url);
  if (!endpoint) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint.offerUrl, { signal: controller.signal, credentials: 'omit' });
    if (!res.ok) return null;
    return normalizeCanonicalOffer(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function trustedOfferToDiscoverableItem(url: string, offer: Record<string, unknown>): DiscoverableItem | null {
  const endpoint = deriveTrustedOfferEndpoint(url);
  if (!endpoint) return null;
  const origin = text(offer.publicOrigin) || endpoint.origin;
  const contentId = text(offer.contentId) || endpoint.contentId;
  const title = text(offer.title);
  const creatorHandle = text(offer.creatorHandle);
  const publishedAt = typeof offer.publishProof === 'object' && offer.publishProof
    ? text((offer.publishProof as Record<string, unknown>).publishedAt)
    : '';
  const priceSats = numberValue(offer.priceSats);
  const accessModeRaw = text(offer.accessMode).toLowerCase();
  const accessMode: DiscoverableItem['accessMode'] =
    accessModeRaw === 'owned' || accessModeRaw === 'unlocked' || accessModeRaw === 'locked'
      ? accessModeRaw
      : priceSats > 0 ? 'locked' : 'unlocked';
  const playback = typeof offer.playback === 'object' && offer.playback
    ? offer.playback as DiscoverableItem['canonicalPlayback']
    : null;
  const item: DiscoverableItem = {
    contentId,
    title,
    description: text(offer.description) || null,
    creatorHandle,
    contentType: text(offer.contentType) || text(offer.type) || 'content',
    primaryTopic: topicValue(offer.primaryTopic),
    coverUrl: resolveUrl(offer.coverUrl, origin),
    previewUrl: resolveUrl(offer.previewUrl || playback?.previewUrl || playback?.streamUrl, origin),
    fullMediaUrl: resolveUrl(offer.fullMediaUrl, origin) || null,
    fullContentUrl: resolveUrl(offer.fullContentUrl, origin) || null,
    mediaUrl: resolveUrl(offer.mediaUrl, origin) || null,
    contentUrl: resolveUrl(offer.contentUrl, origin) || null,
    createdAt: text(offer.createdAt) || null,
    updatedAt: text(offer.updatedAt) || null,
    publishedAt: publishedAt || text(offer.publishedAt) || null,
    buyUrl: resolveUrl(offer.buyUrl, origin) || endpoint.buyUrl,
    offerUrl: resolveUrl(offer.offerUrl, origin) || endpoint.offerUrl,
    priceSats,
    accessMode,
    isLocked: typeof offer.isLocked === 'boolean' ? offer.isLocked : accessMode === 'locked',
    hasFullAccess: typeof offer.hasFullAccess === 'boolean' ? offer.hasFullAccess : false,
    owned: typeof offer.owned === 'boolean' ? offer.owned : false,
    primaryFileMime: text(offer.primaryFileMime) || null,
    paymentAccessProof: typeof offer.paymentAccessProof === 'object' && offer.paymentAccessProof
      ? offer.paymentAccessProof as DiscoverableItem['paymentAccessProof']
      : null,
    canonicalPlayback: playback,
    canonicalOfferHydrated: true,
    canonicalPlaybackAuthorized: Boolean(playback),
    publicOrigin: origin,
    creatorAvatarUrl: resolveUrl(offer.creatorAvatarUrl, origin) || null,
    creatorProfileImageUrl: resolveUrl(offer.creatorProfileImageUrl, origin) || null,
    profileImageUrl: resolveUrl(offer.profileImageUrl, origin) || null,
    avatarUrl: resolveUrl(offer.avatarUrl, origin) || null,
    profileTheme: typeof offer.profileTheme === 'object' && offer.profileTheme ? offer.profileTheme as DiscoverableItem['profileTheme'] : null,
    discoveryStatus: 'live',
    originTrust: 'stable',
    originHealth: 'healthy',
  };
  return isRenderableDiscoveryItem(item) ? item : null;
}

export async function loadTrustedContentItems(topic: Topic): Promise<DiscoverableItem[]> {
  const now = Date.now();
  const cached = trustedContentItemsCache.get(topic);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (async () => {
    const urls = await loadConfiguredTrustedContentUrls();
    const items = await Promise.all(urls.map(async (url) => {
      const offer = await fetchTrustedOffer(url, DISCOVERY_FIRST_PASS_TIMEOUT_MS);
      if (!offer) return null;
      const item = trustedOfferToDiscoverableItem(url, offer);
      if (!item) return null;
      if (topic !== 'all' && item.primaryTopic !== topic) return null;
      return item;
    }));
    return items.filter((item): item is DiscoverableItem => Boolean(item));
  })();

  trustedContentItemsCache.set(topic, { expiresAt: now + DISCOVERY_RUNTIME_CACHE_MS, promise });
  return promise;
}

export async function loadDiscoverableById(contentId: string, originHint: string | null): Promise<DiscoverableItem | null> {
  const cacheKey = cacheKeyForId(contentId, originHint);
  const now = Date.now();
  const cached = discoverableByIdCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (async () => {
    const trustedHit = (await loadTrustedContentItems('all')).find((item) => item.contentId === contentId) || null;
    if (trustedHit && (!originHint || trustedHit.publicOrigin === originHint)) return trustedHit;

    const origins = await loadConfiguredOrigins();
    const ordered = originHint ? [originHint, ...origins.filter((origin) => origin !== originHint)] : origins;

    if (originHint) {
      const hintedHit = await findDiscoverableInOrigin(contentId, originHint, DISCOVERY_FIRST_PASS_TIMEOUT_MS);
      if (hintedHit) return hintedHit;
    }

    const firstPassOrigins = originHint ? ordered.slice(1) : ordered;
    const firstPass = await Promise.all(
      firstPassOrigins.map((origin) => findDiscoverableInOrigin(contentId, origin, DISCOVERY_FIRST_PASS_TIMEOUT_MS)),
    );
    const hit = firstPass.find(Boolean) || null;
    if (hit) return hit;
    for (const origin of ordered) {
      let cursor: string | null = null;
      for (let page = 0; page < 3; page += 1) {
        try {
          const response = await fetchDiscoverablePage({ origin, topic: 'all', limit: 24, cursor, timeoutMs: DISCOVERY_FALLBACK_TIMEOUT_MS });
          const deeperHit = response.items.find((item) => item.contentId === contentId);
          if (deeperHit) return deeperHit;
          if (!response.cursor) break;
          cursor = response.cursor;
        } catch {
          break;
        }
      }
    }
    return null;
  })();

  discoverableByIdCache.set(cacheKey, { expiresAt: now + DISCOVERY_RUNTIME_CACHE_MS, promise });
  return promise;
}

export async function loadDiscoveryItems(topic: Topic): Promise<DiscoverableItem[]> {
  const now = Date.now();
  const cached = discoveryItemsCache.get(topic);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (async () => {
    const origins = await loadConfiguredOrigins();
    const rowsByOrigin = await Promise.all(
      origins.map(async (origin) => {
        const originRows: DiscoverableItem[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < DISCOVERY_MAX_PAGES_PER_ORIGIN; page += 1) {
          try {
            const response = await fetchDiscoverablePage({ origin, topic, limit: 18, cursor, timeoutMs: DISCOVERY_FIRST_PASS_TIMEOUT_MS });
            originRows.push(...response.items);
            if (!response.cursor) break;
            cursor = response.cursor;
          } catch {
            break;
          }
        }
        return originRows;
      }),
    );
    const trustedItems = await loadTrustedContentItems(topic);
    return sortNewestFirst(dedupeDiscoveryItems([...trustedItems, ...rowsByOrigin.flat()]));
  })();

  discoveryItemsCache.set(topic, { expiresAt: now + DISCOVERY_RUNTIME_CACHE_MS, promise });
  return promise;
}
