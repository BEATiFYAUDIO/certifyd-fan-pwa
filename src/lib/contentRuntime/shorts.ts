import { isRenderableDiscoveryItem } from '../discoveryGuard';
import { dedupeDiscoveryItems } from '../discoveryViewModel';
import { normalizeCanonicalOrigin } from '../origin';
import type { DiscoverableItem, Topic } from '../types';
import { loadDiscoverableById, loadDiscoveryItems } from './discovery';

export function contentRuntimeItemKey(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>): string {
  return `${normalizeCanonicalOrigin(item.publicOrigin) || item.publicOrigin}::${item.contentId}`;
}

export async function loadShortsRuntimeQueue(
  topic: Topic,
  contentId: string | null,
  originHint: string | null,
  stateItem: DiscoverableItem | null,
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
  if (contentId) {
    const selectedIndex = queue.findIndex((item) => item.contentId === contentId && (!originHint || normalizeCanonicalOrigin(item.publicOrigin) === normalizeCanonicalOrigin(originHint)));
    if (selectedIndex > 0) {
      const selected = queue[selectedIndex];
      queue = [selected, ...queue.slice(0, selectedIndex), ...queue.slice(selectedIndex + 1)];
    }
  }
  return queue;
}
