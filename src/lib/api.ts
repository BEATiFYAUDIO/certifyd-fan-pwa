import type { DiscoverableResponse, Topic } from './types';
import { isRenderableDiscoveryItem } from './discoveryGuard';

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

function normalizeAccessMode(value: unknown): 'unlocked' | 'locked' | 'owned' {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'owned') return 'owned';
  if (raw === 'unlocked' || raw === 'free_play' || raw === 'free_unlock') return 'unlocked';
  if (raw === 'locked' || raw === 'paid_unlock') return 'locked';
  return 'locked';
}

export async function fetchDiscoverablePage(input: {
  origin: string;
  topic: Topic;
  limit?: number;
  cursor?: string | null;
  timeoutMs?: number;
}): Promise<DiscoverableResponse> {
  const { origin, topic, limit = 24, cursor, timeoutMs = 6000 } = input;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (topic !== 'all') params.set('topic', topic);
  if (cursor) params.set('cursor', cursor);

  const url = `${origin}/public/discoverable-content?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
  if (!res.ok) {
    throw new Error(`Failed ${res.status} from ${origin}`);
  }
  const data = (await res.json()) as DiscoverableResponse;

  return {
    cursor: data.cursor || null,
    items: (data.items || []).map((item) => ({
      ...item,
      accessMode: normalizeAccessMode((item as any).accessMode),
      publicOrigin: item.publicOrigin || origin,
      coverUrl: resolveUrl(item.coverUrl, item.publicOrigin || origin),
      previewUrl: resolveUrl(item.previewUrl, item.publicOrigin || origin),
      buyUrl: resolveUrl(item.buyUrl, item.publicOrigin || origin),
      offerUrl: resolveUrl(item.offerUrl, item.publicOrigin || origin),
      creatorAvatarUrl: resolveUrl(item.creatorAvatarUrl, item.publicOrigin || origin),
      creatorProfileImageUrl: resolveUrl(item.creatorProfileImageUrl, item.publicOrigin || origin),
      profileImageUrl: resolveUrl(item.profileImageUrl, item.publicOrigin || origin),
      avatarUrl: resolveUrl(item.avatarUrl, item.publicOrigin || origin),
    })).filter((item) => isRenderableDiscoveryItem(item)),
  };
}
