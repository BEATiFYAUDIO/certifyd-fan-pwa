import { isLockedOrPremium, isRenderableDiscoveryItem } from '../discoveryGuard';
import { dedupeDiscoveryItems } from '../discoveryViewModel';
import { normalizeCanonicalOrigin } from '../origin';
import type { DiscoverableItem, Topic } from '../types';
import { loadDiscoverableById, loadDiscoveryItems } from './discovery';
import { hydrateCanonicalOfferForItem } from './hydration';

export function contentRuntimeItemKey(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>): string {
  return `${normalizeCanonicalOrigin(item.publicOrigin) || item.publicOrigin}::${item.contentId}`;
}

async function hydrateShortsQueue(queue: DiscoverableItem[], limit: number, options: { premiumOnly?: boolean } = {}): Promise<DiscoverableItem[]> {
  const hydratedItems = await Promise.all(
    queue.slice(0, limit).map(async (item) => {
      try {
        return await hydrateCanonicalOfferForItem(item, {
          trustCanonicalFullPlayback: options.premiumOnly === true,
        });
      } catch {
        return item;
      }
    }),
  );
  const hydratedByKey = new Map(hydratedItems.map((item) => [contentRuntimeItemKey(item), item]));
  return queue.map((item) => hydratedByKey.get(contentRuntimeItemKey(item)) || item);
}

export async function loadShortsRuntimeQueue(
  topic: Topic,
  contentId: string | null,
  originHint: string | null,
  stateItem: DiscoverableItem | null,
  options: { freeOnly?: boolean; premiumOnly?: boolean } = {},
): Promise<DiscoverableItem[]> {
  const extras: DiscoverableItem[] = [];
  if (stateItem && isRenderableDiscoveryItem(stateItem)) extras.push(stateItem);
  if (contentId && !extras.some((item) => item.contentId === contentId)) {
    const hit = await loadDiscoverableById(contentId, originHint);
    if (hit) extras.push(hit);
  }
  let queue = dedupeDiscoveryItems([...extras, ...await loadDiscoveryItems(topic)])
    .filter((item) => isRenderableDiscoveryItem(item))
    .filter((item) => Boolean(item.coverUrl || item.previewUrl || item.fullMediaUrl || item.fullContentUrl || item.mediaUrl || item.contentUrl));
  if (options.freeOnly) {
    queue = queue.filter((item) => item.isFree === true || item.accessMode === 'unlocked' || item.accessMode === 'owned' || Number(item.priceSats || 0) === 0);
  }
  if (options.premiumOnly) {
    queue = queue.filter((item) => isLockedOrPremium(item));
  }
  if (contentId) {
    const selectedIndex = queue.findIndex((item) => item.contentId === contentId && (!originHint || normalizeCanonicalOrigin(item.publicOrigin) === normalizeCanonicalOrigin(originHint)));
    if (selectedIndex > 0) {
      const selected = queue[selectedIndex];
      queue = [selected, ...queue.slice(0, selectedIndex), ...queue.slice(selectedIndex + 1)];
    }
  }
  if ((contentId || options.premiumOnly) && queue[0]) {
    queue = await hydrateShortsQueue(queue, Math.min(queue.length, 3), { premiumOnly: options.premiumOnly });
  }
  return queue;
}
