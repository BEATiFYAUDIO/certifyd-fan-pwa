import type { ContentContextCreator, ContentContextPerson, DiscoverableItem } from './types';
import { normalizeCanonicalOrigin } from './origin';

function clean(value: unknown): string {
  return String(value || '').trim();
}

function safeHttpUrl(value: unknown, fallbackOrigin?: string | null): URL | null {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const base = fallbackOrigin ? `${fallbackOrigin.replace(/\/+$/, '')}/` : undefined;
    const url = new URL(raw, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

function sameOrigin(url: URL, origin: string | null): boolean {
  if (!origin) return true;
  return url.origin.toLowerCase() === origin.toLowerCase();
}

function isContentboxProfilePath(url: URL): boolean {
  const parts = url.pathname.split('/').filter(Boolean);
  return parts.length >= 2 && parts[0] === 'u' && Boolean(parts[1]);
}

function isContentboxBuyPath(url: URL): boolean {
  const parts = url.pathname.split('/').filter(Boolean);
  return parts.length >= 2 && parts[0] === 'buy' && parts[1] !== 'content';
}

function profileUrlFromOriginAndHandle(publicOrigin: string | null, handle: string | null): string {
  const origin = normalizeCanonicalOrigin(publicOrigin);
  const cleanHandle = clean(handle).replace(/^@+/, '');
  if (!origin || !cleanHandle) return '';
  return `${origin}/u/${encodeURIComponent(cleanHandle)}`;
}

function explicitProfileCandidates(value: unknown): unknown[] {
  const record = value as Record<string, unknown> | null | undefined;
  return [
    record?.creatorProfileUrl,
    record?.creatorUrl,
    record?.profileUrl,
    record?.publicProfileUrl,
    record?.profilePath,
  ];
}

export function canonicalCreatorProfileUrl(input: {
  publicOrigin?: string | null;
  creatorHandle?: string | null;
  profileUrl?: string | null;
  creatorUrl?: string | null;
  value?: unknown;
}): string {
  const publicOrigin = normalizeCanonicalOrigin(input.publicOrigin);
  const candidates = [
    input.profileUrl,
    input.creatorUrl,
    ...explicitProfileCandidates(input.value),
  ];
  for (const candidate of candidates) {
    const url = safeHttpUrl(candidate, publicOrigin);
    if (!url || !sameOrigin(url, publicOrigin) || !isContentboxProfilePath(url)) continue;
    return url.toString();
  }
  return profileUrlFromOriginAndHandle(publicOrigin, input.creatorHandle || null);
}

export function canonicalCreatorProfileUrlForPerson(
  person: ContentContextCreator | ContentContextPerson | null | undefined,
  fallbackOrigin?: string | null,
): string {
  if (!person) return '';
  return canonicalCreatorProfileUrl({
    publicOrigin: person.publicOrigin || fallbackOrigin || null,
    creatorHandle: person.handle,
    profileUrl: person.profileUrl,
    value: person,
  });
}

export function canonicalCreatorProfileUrlForItem(item: DiscoverableItem | null | undefined): string {
  if (!item) return '';
  return canonicalCreatorProfileUrl({
    publicOrigin: item.publicOrigin,
    creatorHandle: item.creatorHandle,
    value: item,
  });
}

export function canonicalWorkBuyUrl(input: {
  contentId?: string | null;
  publicOrigin?: string | null;
  buyUrl?: string | null;
  value?: unknown;
}): string {
  const contentId = clean(input.contentId);
  const publicOrigin = normalizeCanonicalOrigin(input.publicOrigin);
  const record = input.value as Record<string, unknown> | null | undefined;
  const candidates = [input.buyUrl, record?.buyUrl, record?.publicBuyUrl];
  for (const candidate of candidates) {
    const url = safeHttpUrl(candidate, publicOrigin);
    if (!url || !sameOrigin(url, publicOrigin) || !isContentboxBuyPath(url)) continue;
    return url.toString();
  }
  if (!contentId || !publicOrigin) return '';
  return `${publicOrigin}/buy/${encodeURIComponent(contentId)}`;
}

export function canonicalWorkBuyUrlForItem(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'> & Partial<Pick<DiscoverableItem, 'buyUrl'>>): string {
  return canonicalWorkBuyUrl({
    contentId: item.contentId,
    publicOrigin: item.publicOrigin,
    buyUrl: item.buyUrl,
    value: item,
  });
}
