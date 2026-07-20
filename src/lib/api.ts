import type {
  ContentContextCreator,
  ContentContextPerson,
  ContentContextWork,
  ContentRelationshipContext,
  DiscoverableItem,
  DiscoverableResponse,
  DiscoverySignalCreator,
  DiscoverySignalsResponse,
  DiscoverySignalWork,
  ProfileTheme,
  Topic,
} from './types';
import { isRenderableDiscoveryItem } from './discoveryGuard';

const DISCOVERABLE_CACHE_MS = 60_000;
const SIGNALS_CACHE_MS = 60_000;
const CONTENT_CONTEXT_CACHE_MS = 60_000;
const discoverablePageCache = new Map<string, { expiresAt: number; promise: Promise<DiscoverableResponse> }>();
const discoverySignalsCache = new Map<string, { expiresAt: number; promise: Promise<DiscoverySignalsResponse | null> }>();
const contentContextCache = new Map<string, { expiresAt: number; promise: Promise<ContentRelationshipContext | null> }>();

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

function normalizeProfileThemeUrls(theme: ProfileTheme | null | undefined, origin: string): ProfileTheme | null | undefined {
  if (!theme || typeof theme !== 'object') return theme;
  return {
    ...theme,
    themeWallpaperImageUrl: resolveUrl(theme.themeWallpaperImageUrl, origin) || theme.themeWallpaperImageUrl || null,
    themeBackgroundImageUrl: resolveUrl(theme.themeBackgroundImageUrl, origin) || theme.themeBackgroundImageUrl || null,
    themeTextureImageUrl: resolveUrl(theme.themeTextureImageUrl, origin) || theme.themeTextureImageUrl || null,
  };
}

async function normalizeDiscoverableItem(item: DiscoverableItem, origin: string): Promise<DiscoverableItem> {
  const publicOrigin = item.publicOrigin || origin;
  const normalized = {
    ...item,
    publicOrigin,
    coverUrl: resolveUrl(item.coverUrl, publicOrigin),
    previewUrl: resolveUrl(item.previewUrl, publicOrigin),
    fullMediaUrl: resolveUrl(item.fullMediaUrl, publicOrigin),
    fullContentUrl: resolveUrl(item.fullContentUrl, publicOrigin),
    mediaUrl: resolveUrl(item.mediaUrl, publicOrigin),
    contentUrl: resolveUrl(item.contentUrl, publicOrigin),
    buyUrl: resolveUrl(item.buyUrl, publicOrigin),
    offerUrl: resolveUrl(item.offerUrl, publicOrigin),
    creatorAvatarUrl: resolveUrl(item.creatorAvatarUrl, publicOrigin),
    creatorProfileImageUrl: resolveUrl(item.creatorProfileImageUrl, publicOrigin),
    profileImageUrl: resolveUrl(item.profileImageUrl, publicOrigin),
    avatarUrl: resolveUrl(item.avatarUrl, publicOrigin),
  };
  return {
    ...normalized,
    profileTheme: normalizeProfileThemeUrls(normalized.profileTheme, publicOrigin) || null,
  };
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
  const now = Date.now();
  const cached = discoverablePageCache.get(url);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Failed ${res.status} from ${origin}`);
      }
      const data = (await res.json()) as DiscoverableResponse;

      const items = await Promise.all((data.items || []).map((item) => normalizeDiscoverableItem(item, origin)));
      return {
        cursor: data.cursor || null,
        items: items.filter((item) => isRenderableDiscoveryItem(item)),
      };
    } catch (error) {
      discoverablePageCache.delete(url);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  })();
  discoverablePageCache.set(url, { expiresAt: now + DISCOVERABLE_CACHE_MS, promise });
  return promise;
}

async function normalizeSignalWork(value: DiscoverySignalWork, origin: string, fallbackTheme?: ProfileTheme | null): Promise<DiscoverySignalWork> {
  const publicOrigin = value.publicOrigin || origin;
  const profileTheme = normalizeProfileThemeUrls(value.profileTheme, publicOrigin) || fallbackTheme || null;
  return {
    ...value,
    publicOrigin,
    profileTheme,
    publicUrl: resolveUrl(value.publicUrl, publicOrigin),
    coverUrl: resolveUrl(value.coverUrl, publicOrigin),
    previewUrl: resolveUrl(value.previewUrl, publicOrigin),
    creatorAvatarUrl: resolveUrl(value.creatorAvatarUrl, publicOrigin),
    contributors: Array.isArray(value.contributors)
      ? await Promise.all(value.contributors.slice(0, 4).map(async (contributor) => ({
          ...contributor,
          avatarUrl: resolveUrl(contributor.avatarUrl, publicOrigin),
          profileUrl: resolveUrl(contributor.profileUrl, publicOrigin),
          profileTheme: normalizeProfileThemeUrls(contributor.profileTheme, publicOrigin) || null,
        })))
      : [],
  };
}

async function normalizeSignalCreator(value: DiscoverySignalCreator, origin: string): Promise<DiscoverySignalCreator> {
  const publicOrigin = value.publicOrigin || origin;
  const profileTheme = normalizeProfileThemeUrls(value.profileTheme, publicOrigin) || null;
  return {
    ...value,
    profileTheme,
    publicOrigin,
    avatarUrl: resolveUrl(value.avatarUrl, publicOrigin),
    profileUrl: resolveUrl(value.profileUrl, publicOrigin),
    representativeWorks: Array.isArray(value.representativeWorks)
      ? await Promise.all(value.representativeWorks.map((work) => normalizeSignalWork(work, publicOrigin, profileTheme)))
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
  const endpoint = `${origin}/public/discovery/signals`;
  const now = Date.now();
  const cached = discoverySignalsCache.get(endpoint);
  if (cached && cached.expiresAt > now) {
    clearTimeout(timeoutId);
    return cached.promise;
  }

  const promise = (async () => {
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) {
      discoverySignalsCache.delete(endpoint);
      return null;
    }
    const data = (await res.json()) as DiscoverySignalsResponse;
    const topCreators = Array.isArray(data.creators?.topCreators)
      ? await Promise.all(data.creators.topCreators.map((creator) => normalizeSignalCreator(creator, origin)))
      : [];
    const ecosystems = Array.isArray(data.ecosystems)
      ? await Promise.all(data.ecosystems.map((creator) => normalizeSignalCreator(creator, origin)))
      : [];
    return {
      ...data,
      creators: {
        topCreators,
      },
      ecosystems,
      works: {
        topSelling: Array.isArray(data.works?.topSelling)
          ? await Promise.all(data.works.topSelling.map((work) => normalizeSignalWork(work, origin)))
          : [],
        mostSupported: Array.isArray(data.works?.mostSupported)
          ? await Promise.all(data.works.mostSupported.map((work) => normalizeSignalWork(work, origin)))
          : [],
        fastestMoving: Array.isArray(data.works?.fastestMoving)
          ? await Promise.all(data.works.fastestMoving.map((work) => normalizeSignalWork(work, origin)))
          : [],
        recentlyAdded: Array.isArray(data.works?.recentlyAdded)
          ? await Promise.all(data.works.recentlyAdded.map((work) => normalizeSignalWork(work, origin)))
          : [],
        recentlySupported: Array.isArray(data.works?.recentlySupported)
          ? await Promise.all(data.works.recentlySupported.map((work) => normalizeSignalWork(work, origin)))
          : [],
        collaborativeReleases: Array.isArray(data.works?.collaborativeReleases)
          ? await Promise.all(data.works.collaborativeReleases.map((work) => normalizeSignalWork(work, origin)))
          : [],
      },
    };
  } catch {
    discoverySignalsCache.delete(endpoint);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
  })();
  discoverySignalsCache.set(endpoint, { expiresAt: now + SIGNALS_CACHE_MS, promise });
  return promise;
}

async function normalizeContextCreator(value: ContentContextCreator | null | undefined, origin: string): Promise<ContentContextCreator | null> {
  if (!value) return null;
  const publicOrigin = value.publicOrigin || origin;
  return {
    ...value,
    avatarUrl: resolveUrl(value.avatarUrl, publicOrigin),
    profileUrl: resolveUrl(value.profileUrl, publicOrigin),
    publicOrigin,
    profileTheme: normalizeProfileThemeUrls(value.profileTheme, publicOrigin) || null,
  };
}

async function normalizeContextPerson(value: ContentContextPerson, origin: string): Promise<ContentContextPerson> {
  const creator = await normalizeContextCreator(value, origin);
  return {
    handle: creator?.handle || null,
    displayName: creator?.displayName || value.displayName || null,
    avatarUrl: creator?.avatarUrl || null,
    profileUrl: creator?.profileUrl || null,
    publicOrigin: creator?.publicOrigin || origin,
    profileTheme: creator?.profileTheme || null,
    role: value.role || null,
    relationshipLabel: value.relationshipLabel || 'Contributor',
  };
}

async function normalizeContextWork(value: ContentContextWork, origin: string): Promise<ContentContextWork> {
  const workOrigin = value.creator?.publicOrigin || origin;
  const creator = await normalizeContextCreator(value.creator, workOrigin);
  return {
    ...value,
    coverUrl: resolveUrl(value.coverUrl, workOrigin),
    previewUrl: resolveUrl(value.previewUrl, workOrigin),
    publicUrl: resolveUrl(value.publicUrl, workOrigin),
    creator,
    profileTheme: normalizeProfileThemeUrls(value.profileTheme, workOrigin) || creator?.profileTheme || null,
  };
}

function normalizeContextArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const creatorAvatarIndexCache = new Map<string, Promise<Map<string, string>>>();
const creatorProfileAvatarCache = new Map<string, Promise<string>>();

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

function extractProfileAvatarUrl(html: string, profileUrl: string): string {
  const candidates = new Set<string>();
  const avatarPathMatches = html.matchAll(/["']([^"']*\/public\/avatars\/[^"']+)["']/gi);
  for (const match of avatarPathMatches) {
    if (match[1]) candidates.add(match[1]);
  }

  const imageMatches = html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi);
  for (const match of imageMatches) {
    const candidate = match[1] || '';
    if (/avatar|profile|\/public\/avatars\//i.test(candidate)) candidates.add(candidate);
  }

  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith('data:')) continue;
    try {
      return new URL(candidate, profileUrl).toString();
    } catch {
      // Ignore malformed image references from remote profile HTML.
    }
  }
  return '';
}

async function fetchPublicProfileAvatar(profileUrl: string | null | undefined): Promise<string> {
  const normalizedProfileUrl = String(profileUrl || '').trim();
  if (!normalizedProfileUrl) return '';

  let cached = creatorProfileAvatarCache.get(normalizedProfileUrl);
  if (!cached) {
    cached = (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(normalizedProfileUrl, { signal: controller.signal });
        if (!res.ok) return '';
        const html = await res.text();
        return extractProfileAvatarUrl(html, normalizedProfileUrl);
      } catch {
        return '';
      } finally {
        clearTimeout(timeoutId);
      }
    })();
    creatorProfileAvatarCache.set(normalizedProfileUrl, cached);
  }

  return cached;
}

async function enrichContextCreatorAvatar<T extends ContentContextCreator | null>(creator: T): Promise<T> {
  if (!creator || creator.avatarUrl) return creator;
  const avatarUrl = await fetchPublicCreatorAvatar(creator.publicOrigin, creator.handle)
    || await fetchPublicProfileAvatar(creator.profileUrl);
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

  const endpoint = `${origin}/public/content/${encodeURIComponent(contentId)}/context`;
  const now = Date.now();
  const cached = contentContextCache.get(endpoint);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, { signal: controller.signal });
      if (!res.ok) return null;
      const data = (await res.json()) as ContentRelationshipContext;
      const creator = await enrichContextCreatorAvatar(await normalizeContextCreator(data.creator, origin));
      const peopleBehindThis = await Promise.all(
        normalizeContextArray<ContentContextPerson>(data.peopleBehindThis)
          .map(async (person) => enrichContextCreatorAvatar(await normalizeContextPerson(person, origin))),
      );
      const featuring = await Promise.all(
        normalizeContextArray<ContentContextPerson>(data.featuring)
          .map(async (person) => enrichContextCreatorAvatar(await normalizeContextPerson(person, origin))),
      );
      const createdWith = await Promise.all(
        normalizeContextArray<ContentContextPerson>(data.createdWith)
          .map(async (person) => enrichContextCreatorAvatar(await normalizeContextPerson(person, origin))),
      );
      const connectedCreators = (await Promise.all(
        normalizeContextArray<ContentContextCreator>(data.connectedCreators)
          .map(async (row) => enrichContextCreatorAvatar(await normalizeContextCreator(row, origin))),
      )).filter((row): row is ContentContextCreator => Boolean(row));
      const builtFrom = await Promise.all(normalizeContextArray<ContentContextWork>(data.builtFrom).map((work) => normalizeContextWork(work, origin)));
      const derivedFrom = await Promise.all(normalizeContextArray<ContentContextWork>(data.derivedFrom).map((work) => normalizeContextWork(work, origin)));
      const worksThatBuiltOnThis = await Promise.all(normalizeContextArray<ContentContextWork>(data.worksThatBuiltOnThis).map((work) => normalizeContextWork(work, origin)));
      const moreTheyWorkedOn = await Promise.all(normalizeContextArray<ContentContextWork>(data.moreTheyWorkedOn).map((work) => normalizeContextWork(work, origin)));
      const relatedWorks = await Promise.all(normalizeContextArray<ContentContextWork>(data.relatedWorks).map((work) => normalizeContextWork(work, origin)));
      return {
        ...data,
        publicOrigin: data.publicOrigin || origin,
        creator,
        peopleBehindThis,
        featuring,
        createdWith,
        builtFrom,
        derivedFrom,
        worksThatBuiltOnThis,
        moreTheyWorkedOn,
        relatedWorks,
        connectedCreators,
      };
    } catch {
      contentContextCache.delete(endpoint);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  contentContextCache.set(endpoint, { expiresAt: now + CONTENT_CONTEXT_CACHE_MS, promise });
  return promise;
}
