import type { DiscoverableResponse, Topic } from './types';

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
  return (await res.json()) as DiscoverableResponse;
}
