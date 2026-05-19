import type {
  ContentContextCreator,
  ContentContextPerson,
  ContentContextWork,
  ContentRelationshipContext,
  DiscoverableResponse,
  Topic,
} from './types';
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

function normalizeContextCreator(value: ContentContextCreator | null | undefined, origin: string): ContentContextCreator | null {
  if (!value) return null;
  return {
    ...value,
    avatarUrl: resolveUrl(value.avatarUrl, value.publicOrigin || origin),
    profileUrl: resolveUrl(value.profileUrl, value.publicOrigin || origin),
    publicOrigin: value.publicOrigin || origin,
  };
}

function normalizeContextPerson(value: ContentContextPerson, origin: string): ContentContextPerson {
  const creator = normalizeContextCreator(value, origin);
  return {
    handle: creator?.handle || null,
    displayName: creator?.displayName || value.displayName || null,
    avatarUrl: creator?.avatarUrl || null,
    profileUrl: creator?.profileUrl || null,
    publicOrigin: creator?.publicOrigin || origin,
    role: value.role || null,
    relationshipLabel: value.relationshipLabel || 'Contributor',
  };
}

function normalizeContextWork(value: ContentContextWork, origin: string): ContentContextWork {
  const workOrigin = value.creator?.publicOrigin || origin;
  return {
    ...value,
    coverUrl: resolveUrl(value.coverUrl, workOrigin),
    previewUrl: resolveUrl(value.previewUrl, workOrigin),
    publicUrl: resolveUrl(value.publicUrl, workOrigin),
    creator: normalizeContextCreator(value.creator, workOrigin),
  };
}

function normalizeContextArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function fetchContentContext(input: {
  origin: string;
  contentId: string;
  timeoutMs?: number;
}): Promise<ContentRelationshipContext | null> {
  const { origin, contentId, timeoutMs = 5000 } = input;
  if (!origin || !contentId) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = `${origin}/public/content/${encodeURIComponent(contentId)}/context`;
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as ContentRelationshipContext;
    return {
      ...data,
      publicOrigin: data.publicOrigin || origin,
      creator: normalizeContextCreator(data.creator, origin),
      peopleBehindThis: normalizeContextArray<ContentContextPerson>(data.peopleBehindThis).map((person) => normalizeContextPerson(person, origin)),
      featuring: normalizeContextArray<ContentContextPerson>(data.featuring).map((person) => normalizeContextPerson(person, origin)),
      createdWith: normalizeContextArray<ContentContextPerson>(data.createdWith).map((person) => normalizeContextPerson(person, origin)),
      builtFrom: normalizeContextArray<ContentContextWork>(data.builtFrom).map((work) => normalizeContextWork(work, origin)),
      derivedFrom: normalizeContextArray<ContentContextWork>(data.derivedFrom).map((work) => normalizeContextWork(work, origin)),
      worksThatBuiltOnThis: normalizeContextArray<ContentContextWork>(data.worksThatBuiltOnThis).map((work) => normalizeContextWork(work, origin)),
      moreTheyWorkedOn: normalizeContextArray<ContentContextWork>(data.moreTheyWorkedOn).map((work) => normalizeContextWork(work, origin)),
      relatedWorks: normalizeContextArray<ContentContextWork>(data.relatedWorks).map((work) => normalizeContextWork(work, origin)),
      connectedCreators: normalizeContextArray<ContentContextCreator>(data.connectedCreators)
        .map((creator) => normalizeContextCreator(creator, origin))
        .filter((creator): creator is ContentContextCreator => Boolean(creator)),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
