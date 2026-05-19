import type {
  ContentContextCreator,
  ContentContextPerson,
  ContentContextWork,
  ContentRelationshipContext,
  DiscoverableResponse,
  DiscoverySignalCreator,
  DiscoverySignalsResponse,
  DiscoverySignalWork,
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

function normalizeSignalWork(value: DiscoverySignalWork, origin: string): DiscoverySignalWork {
  const publicOrigin = value.publicOrigin || origin;
  return {
    ...value,
    publicOrigin,
    publicUrl: resolveUrl(value.publicUrl, publicOrigin),
    coverUrl: resolveUrl(value.coverUrl, publicOrigin),
    previewUrl: resolveUrl(value.previewUrl, publicOrigin),
    creatorAvatarUrl: resolveUrl(value.creatorAvatarUrl, publicOrigin),
  };
}

function normalizeSignalCreator(value: DiscoverySignalCreator, origin: string): DiscoverySignalCreator {
  const publicOrigin = value.publicOrigin || origin;
  return {
    ...value,
    publicOrigin,
    avatarUrl: resolveUrl(value.avatarUrl, publicOrigin),
    profileUrl: resolveUrl(value.profileUrl, publicOrigin),
    representativeWorks: Array.isArray(value.representativeWorks)
      ? value.representativeWorks.map((work) => normalizeSignalWork(work, publicOrigin))
      : [],
  };
}

export async function fetchDiscoverySignals(input: {
  origin: string;
  timeoutMs?: number;
}): Promise<DiscoverySignalsResponse | null> {
  const { origin, timeoutMs = 5000 } = input;
  if (!origin) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = `${origin}/public/discovery/signals`;
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as DiscoverySignalsResponse;
    return {
      ...data,
      creators: {
        topCreators: Array.isArray(data.creators?.topCreators)
          ? data.creators.topCreators.map((creator) => normalizeSignalCreator(creator, origin))
          : [],
      },
      ecosystems: Array.isArray(data.ecosystems)
        ? data.ecosystems.map((creator) => normalizeSignalCreator(creator, origin))
        : [],
      works: {
        topSelling: Array.isArray(data.works?.topSelling)
          ? data.works.topSelling.map((work) => normalizeSignalWork(work, origin))
          : [],
        mostSupported: Array.isArray(data.works?.mostSupported)
          ? data.works.mostSupported.map((work) => normalizeSignalWork(work, origin))
          : [],
        fastestMoving: Array.isArray(data.works?.fastestMoving)
          ? data.works.fastestMoving.map((work) => normalizeSignalWork(work, origin))
          : [],
        recentlySupported: Array.isArray(data.works?.recentlySupported)
          ? data.works.recentlySupported.map((work) => normalizeSignalWork(work, origin))
          : [],
        collaborativeReleases: Array.isArray(data.works?.collaborativeReleases)
          ? data.works.collaborativeReleases.map((work) => normalizeSignalWork(work, origin))
          : [],
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
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

const creatorAvatarIndexCache = new Map<string, Promise<Map<string, string>>>();

function normalizeHandle(value: string | null | undefined): string {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

async function fetchPublicCreatorAvatar(origin: string | null | undefined, handle: string | null | undefined): Promise<string> {
  const normalizedOrigin = String(origin || '').trim();
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedOrigin || !normalizedHandle) return '';

  let indexed = creatorAvatarIndexCache.get(normalizedOrigin);
  if (!indexed) {
    indexed = fetchDiscoverablePage({
      origin: normalizedOrigin,
      topic: 'all',
      limit: 48,
      timeoutMs: 3000,
    })
      .then((page) => {
        const byHandle = new Map<string, string>();
        for (const item of page.items) {
          const itemHandle = normalizeHandle(item.creatorHandle);
          if (!itemHandle || byHandle.has(itemHandle)) continue;
          const avatarUrl = item.creatorAvatarUrl || item.creatorProfileImageUrl || item.profileImageUrl || item.avatarUrl || '';
          if (avatarUrl) byHandle.set(itemHandle, avatarUrl);
        }
        return byHandle;
      })
      .catch(() => new Map<string, string>());
    creatorAvatarIndexCache.set(normalizedOrigin, indexed);
  }

  const byHandle = await indexed;
  return byHandle.get(normalizedHandle) || '';
}

async function enrichContextCreatorAvatar<T extends ContentContextCreator | null>(creator: T): Promise<T> {
  if (!creator || creator.avatarUrl) return creator;
  const avatarUrl = await fetchPublicCreatorAvatar(creator.publicOrigin, creator.handle);
  if (!avatarUrl) return creator;
  return {
    ...creator,
    avatarUrl,
  } as T;
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
    const creator = await enrichContextCreatorAvatar(normalizeContextCreator(data.creator, origin));
    const peopleBehindThis = await Promise.all(
      normalizeContextArray<ContentContextPerson>(data.peopleBehindThis)
        .map((person) => normalizeContextPerson(person, origin))
        .map((person) => enrichContextCreatorAvatar(person)),
    );
    const featuring = await Promise.all(
      normalizeContextArray<ContentContextPerson>(data.featuring)
        .map((person) => normalizeContextPerson(person, origin))
        .map((person) => enrichContextCreatorAvatar(person)),
    );
    const createdWith = await Promise.all(
      normalizeContextArray<ContentContextPerson>(data.createdWith)
        .map((person) => normalizeContextPerson(person, origin))
        .map((person) => enrichContextCreatorAvatar(person)),
    );
    const connectedCreators = await Promise.all(
      normalizeContextArray<ContentContextCreator>(data.connectedCreators)
        .map((row) => normalizeContextCreator(row, origin))
        .filter((row): row is ContentContextCreator => Boolean(row))
        .map((row) => enrichContextCreatorAvatar(row)),
    );
    return {
      ...data,
      publicOrigin: data.publicOrigin || origin,
      creator,
      peopleBehindThis,
      featuring,
      createdWith,
      builtFrom: normalizeContextArray<ContentContextWork>(data.builtFrom).map((work) => normalizeContextWork(work, origin)),
      derivedFrom: normalizeContextArray<ContentContextWork>(data.derivedFrom).map((work) => normalizeContextWork(work, origin)),
      worksThatBuiltOnThis: normalizeContextArray<ContentContextWork>(data.worksThatBuiltOnThis).map((work) => normalizeContextWork(work, origin)),
      moreTheyWorkedOn: normalizeContextArray<ContentContextWork>(data.moreTheyWorkedOn).map((work) => normalizeContextWork(work, origin)),
      relatedWorks: normalizeContextArray<ContentContextWork>(data.relatedWorks).map((work) => normalizeContextWork(work, origin)),
      connectedCreators,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
