import type { DiscoverableItem } from './types';

function hasHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return /^https?:\/\//i.test(v);
}

export function isRenderableDiscoveryItem(item: DiscoverableItem | null | undefined): item is DiscoverableItem {
  if (!item) return false;
  const contentId = String(item.contentId || '').trim();
  const title = String(item.title || '').trim();
  const creator = String(item.creatorHandle || '').trim();
  const status = String(item.discoveryStatus || 'live').trim().toLowerCase();
  const health = String(item.originHealth || 'healthy').trim().toLowerCase();
  const buyUrl = String(item.buyUrl || '').trim();
  const hasVisual = hasHttpUrl(item.coverUrl) || hasHttpUrl(item.previewUrl);
  if (!contentId || !title || !creator) return false;
  if (!hasHttpUrl(buyUrl)) return false;
  if (!hasVisual) return false;
  if (status !== 'live') return false;
  if (health !== 'healthy') return false;
  return true;
}

export function canOpenCreator(item: DiscoverableItem | null | undefined): boolean {
  return Boolean(item && hasHttpUrl(item.buyUrl));
}

