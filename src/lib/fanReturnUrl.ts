import type { DiscoverableItem } from './types';

function clean(value: unknown): string {
  return String(value || '').trim();
}

export function fanWatchReturnUrl(item: Pick<DiscoverableItem, 'contentId'>): string {
  if (typeof window === 'undefined') return '';
  const contentId = clean(item.contentId);
  if (!contentId) return window.location.href;
  return new URL(`/watch/${encodeURIComponent(contentId)}`, window.location.origin).toString();
}

export function buyUrlWithFanReturnUrl(
  buyUrl: string | null | undefined,
  item: Pick<DiscoverableItem, 'contentId'>,
): string {
  const rawBuyUrl = clean(buyUrl);
  if (!rawBuyUrl || typeof window === 'undefined') return rawBuyUrl || '#';
  try {
    const url = new URL(rawBuyUrl, window.location.origin);
    const returnUrl = fanWatchReturnUrl(item);
    if (returnUrl) url.searchParams.set('returnUrl', returnUrl);
    return url.toString();
  } catch {
    return rawBuyUrl;
  }
}
