import type { DiscoverableResponse, Topic } from './types';

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

export async function fetchDiscoverablePage(input: {
  origin: string;
  topic: Topic;
  limit?: number;
  cursor?: string | null;
}): Promise<DiscoverableResponse> {
  const { origin, topic, limit = 24, cursor } = input;
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (topic !== 'all') params.set('topic', topic);
  if (cursor) params.set('cursor', cursor);

  const url = `${origin}/public/discoverable-content?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed ${res.status} from ${origin}`);
  }
  const data = (await res.json()) as DiscoverableResponse;

  return {
    cursor: data.cursor || null,
    items: (data.items || []).map((item) => ({
      ...item,
      publicOrigin: item.publicOrigin || origin,
      coverUrl: resolveUrl(item.coverUrl, item.publicOrigin || origin),
      previewUrl: resolveUrl(item.previewUrl, item.publicOrigin || origin),
      buyUrl: resolveUrl(item.buyUrl, item.publicOrigin || origin),
      offerUrl: resolveUrl(item.offerUrl, item.publicOrigin || origin),
      creatorAvatarUrl: resolveUrl(item.creatorAvatarUrl, item.publicOrigin || origin),
      creatorProfileImageUrl: resolveUrl(item.creatorProfileImageUrl, item.publicOrigin || origin),
      profileImageUrl: resolveUrl(item.profileImageUrl, item.publicOrigin || origin),
      avatarUrl: resolveUrl(item.avatarUrl, item.publicOrigin || origin),
    })),
  };
}
