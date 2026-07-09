import type { DiscoverableItem } from './types';
import { normalizeCanonicalOrigin } from './origin';

function clean(value: unknown): string {
  return String(value || '').trim();
}

export function fanWatchReturnUrl(item: Pick<DiscoverableItem, 'contentId'>): string {
  if (typeof window === 'undefined') return '';
  const contentId = clean(item.contentId);
  if (!contentId) return window.location.href;
  return new URL(`/watch/${encodeURIComponent(contentId)}`, window.location.origin).toString();
}

export function contentboxBuyUrlForItem(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>): string {
  const contentId = clean(item.contentId);
  const publicOrigin = normalizeCanonicalOrigin(item.publicOrigin);
  if (!contentId || !publicOrigin) return '';
  return `${publicOrigin}/buy/${encodeURIComponent(contentId)}`;
}

function isFanWatchUrl(url: URL): boolean {
  return url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)[0] === 'watch';
}

function isContentboxBuyUrl(url: URL): boolean {
  return url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)[0] === 'buy';
}

function purchaseUrlOrFallback(
  buyUrl: string | null | undefined,
  item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>,
): string {
  const rawBuyUrl = clean(buyUrl);
  const fallbackBuyUrl = contentboxBuyUrlForItem(item);
  if (!rawBuyUrl) return fallbackBuyUrl || '#';
  if (typeof window === 'undefined') return rawBuyUrl || fallbackBuyUrl || '#';
  try {
    const url = new URL(rawBuyUrl, window.location.origin);
    if (isFanWatchUrl(url) || !isContentboxBuyUrl(url)) return fallbackBuyUrl || '#';
    return url.toString();
  } catch {
    return fallbackBuyUrl || rawBuyUrl;
  }
}

export function buyUrlWithFanReturnUrl(
  buyUrl: string | null | undefined,
  item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>,
): string {
  const resolvedBuyUrl = purchaseUrlOrFallback(buyUrl, item);
  if (!resolvedBuyUrl || resolvedBuyUrl === '#' || typeof window === 'undefined') return resolvedBuyUrl || '#';
  try {
    const url = new URL(resolvedBuyUrl, window.location.origin);
    const returnUrl = fanWatchReturnUrl(item);
    if (returnUrl) url.searchParams.set('returnUrl', returnUrl);
    return url.toString();
  } catch {
    return resolvedBuyUrl;
  }
}
