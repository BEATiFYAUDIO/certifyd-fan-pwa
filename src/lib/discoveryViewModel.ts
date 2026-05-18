import type { DiscoverableItem } from './types';
import { isRenderableDiscoveryItem } from './discoveryGuard';

export type DiscoveryRail = {
  key: string;
  title: string;
  subtitle: string;
  items: DiscoverableItem[];
  layout?: 'grid' | 'row';
};

export type CreatorSpotlight = {
  key: string;
  handle: string;
  publicOrigin: string;
  avatarUrl: string;
  profileUrl: string;
  itemCount: number;
  freeCount: number;
  premiumCount: number;
  topics: string[];
  latestTitle: string;
};

export type HomeDiscoveryViewModel = {
  freeItems: DiscoverableItem[];
  lockedItems: DiscoverableItem[];
  recentRail: DiscoveryRail | null;
  creatorSpotlights: CreatorSpotlight[];
  topicRails: DiscoveryRail[];
  typeRails: DiscoveryRail[];
  stableOriginRail: DiscoveryRail | null;
};

const MAX_RAIL_ITEMS = 8;
const MAX_SIDE_RAILS = 3;
const HUMAN_TYPE_LABELS: Record<string, string> = {
  song: 'Music',
  audio: 'Audio',
  video: 'Video Works',
  book: 'Books',
  file: 'Files',
  document: 'Documents',
  contract: 'Contracts',
  image: 'Images',
  derivative: 'Related Works',
  remix: 'Remixes',
  mashup: 'Mashups',
};

function itemKey(item: DiscoverableItem): string {
  return `${item.publicOrigin}::${item.contentId}`;
}

function text(value: unknown): string {
  return String(value || '').trim();
}

export function itemSortTime(item: DiscoverableItem): number {
  const extra = item as DiscoverableItem & { publishedAt?: unknown; createdAt?: unknown; updatedAt?: unknown };
  const raw = extra.publishedAt || extra.createdAt || extra.updatedAt || '';
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortNewestFirst(items: DiscoverableItem[]): DiscoverableItem[] {
  return [...items].sort((a, b) => {
    const at = itemSortTime(a);
    const bt = itemSortTime(b);
    if (at !== bt) return bt - at;
    return itemKey(b).localeCompare(itemKey(a));
  });
}

export function dedupeDiscoveryItems(items: DiscoverableItem[]): DiscoverableItem[] {
  const seen = new Map<string, DiscoverableItem>();
  for (const item of items) {
    if (!isRenderableDiscoveryItem(item)) continue;
    const key = itemKey(item);
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

export function searchableText(item: DiscoverableItem): string {
  return [item.title, item.creatorHandle, item.primaryTopic, item.contentType, item.description]
    .map((part) => text(part).toLowerCase())
    .join(' ');
}

export function displayType(value: string | null | undefined): string {
  const normalized = text(value).toLowerCase();
  if (!normalized) return 'Work';
  return HUMAN_TYPE_LABELS[normalized] || normalized.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayTopic(value: string | null | undefined): string {
  const normalized = text(value).toLowerCase();
  if (!normalized) return 'Works';
  return normalized.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function groupBy(items: DiscoverableItem[], keyFor: (item: DiscoverableItem) => string): Map<string, DiscoverableItem[]> {
  const grouped = new Map<string, DiscoverableItem[]>();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    const rows = grouped.get(key) || [];
    rows.push(item);
    grouped.set(key, rows);
  }
  return grouped;
}

function bestGroups(grouped: Map<string, DiscoverableItem[]>, minItems = 2): Array<[string, DiscoverableItem[]]> {
  return [...grouped.entries()]
    .filter(([, rows]) => rows.length >= minItems)
    .sort((a, b) => {
      if (a[1].length !== b[1].length) return b[1].length - a[1].length;
      return a[0].localeCompare(b[0]);
    });
}

export function buildCreatorSpotlights(items: DiscoverableItem[], limit = 6): CreatorSpotlight[] {
  const grouped = groupBy(items, (item) => `${item.publicOrigin}::${text(item.creatorHandle).replace(/^@+/, '')}`);
  return bestGroups(grouped, 1).slice(0, limit).map(([key, rows]) => {
    const sorted = sortNewestFirst(rows);
    const first = sorted[0];
    const handle = text(first.creatorHandle).replace(/^@+/, '') || 'creator';
    const avatarUrl = first.creatorAvatarUrl || first.creatorProfileImageUrl || first.profileImageUrl || first.avatarUrl || '';
    const topics = [...new Set(sorted.map((item) => text(item.primaryTopic)).filter(Boolean))].slice(0, 2);
    return {
      key,
      handle,
      publicOrigin: first.publicOrigin,
      avatarUrl,
      profileUrl: `${first.publicOrigin.replace(/\/+$/, '')}/u/${encodeURIComponent(handle)}`,
      itemCount: rows.length,
      freeCount: rows.filter((item) => item.accessMode === 'unlocked' || item.accessMode === 'owned').length,
      premiumCount: rows.filter((item) => item.accessMode === 'locked').length,
      topics,
      latestTitle: first.title || 'Untitled',
    };
  });
}

export function buildHomeDiscoveryViewModel(items: DiscoverableItem[]): HomeDiscoveryViewModel {
  const safe = dedupeDiscoveryItems(items);
  const freeItems = safe.filter((item) => item.accessMode === 'unlocked' || item.accessMode === 'owned');
  const lockedItems = safe.filter((item) => item.accessMode === 'locked');
  const recent = sortNewestFirst(safe).slice(0, MAX_RAIL_ITEMS);
  const hasRealTime = recent.some((item) => itemSortTime(item) > 0);

  const topicRails = bestGroups(groupBy(safe, (item) => text(item.primaryTopic)), 2)
    .slice(0, MAX_SIDE_RAILS)
    .map(([topic, rows]) => ({
      key: `topic:${topic}`,
      title: `${displayTopic(topic)} Works`,
      subtitle: 'More publications in this lane',
      items: sortNewestFirst(rows).slice(0, MAX_RAIL_ITEMS),
      layout: 'grid' as const,
    }));

  const typeRails = bestGroups(groupBy(safe, (item) => text(item.contentType).toLowerCase()), 2)
    .slice(0, MAX_SIDE_RAILS)
    .map(([type, rows]) => ({
      key: `type:${type}`,
      title: displayType(type),
      subtitle: 'Works grouped by format',
      items: sortNewestFirst(rows).slice(0, MAX_RAIL_ITEMS),
      layout: 'grid' as const,
    }));

  const stableOriginItems = safe.filter((item) => item.originHealth === 'healthy' && (item.originTrust === 'stable' || item.originTrust === 'provider'));

  return {
    freeItems,
    lockedItems,
    recentRail: recent.length > 0 ? {
      key: 'recent',
      title: hasRealTime ? 'Recently Published' : 'Recently Indexed',
      subtitle: hasRealTime ? 'Fresh works across the network' : 'Freshly found across connected creators',
      items: recent,
      layout: 'grid',
    } : null,
    creatorSpotlights: buildCreatorSpotlights(safe),
    topicRails,
    typeRails,
    stableOriginRail: stableOriginItems.length >= 2 ? {
      key: 'stable-origins',
      title: 'Reliable Sources',
      subtitle: 'Works from currently healthy creator origins',
      items: sortNewestFirst(stableOriginItems).slice(0, MAX_RAIL_ITEMS),
      layout: 'grid',
    } : null,
  };
}

export function buildWatchDiscoveryRails(item: DiscoverableItem, items: DiscoverableItem[]): DiscoveryRail[] {
  const safe = dedupeDiscoveryItems(items).filter((candidate) => itemKey(candidate) !== itemKey(item));
  const creator = text(item.creatorHandle).replace(/^@+/, '').toLowerCase();
  const topic = text(item.primaryTopic).toLowerCase();
  const type = text(item.contentType).toLowerCase();
  const origin = text(item.publicOrigin);
  const rails: DiscoveryRail[] = [];

  const byCreator = safe.filter((candidate) => text(candidate.creatorHandle).replace(/^@+/, '').toLowerCase() === creator);
  if (byCreator.length > 0) {
    rails.push({
      key: 'more-from-creator',
      title: 'More From This Creator',
      subtitle: `Other works by @${item.creatorHandle || 'creator'}`,
      items: sortNewestFirst(byCreator).slice(0, MAX_RAIL_ITEMS),
      layout: 'grid',
    });
  }

  const byTopic = safe.filter((candidate) => topic && text(candidate.primaryTopic).toLowerCase() === topic);
  if (byTopic.length > 0) {
    rails.push({
      key: 'more-like-this',
      title: 'More Like This',
      subtitle: `More ${displayTopic(topic).toLowerCase()} works`,
      items: sortNewestFirst(byTopic).slice(0, MAX_RAIL_ITEMS),
      layout: 'grid',
    });
  }

  const byType = safe.filter((candidate) => type && text(candidate.contentType).toLowerCase() === type);
  if (byType.length > 0) {
    rails.push({
      key: 'same-format',
      title: `More ${displayType(type)}`,
      subtitle: 'Other works in this format',
      items: sortNewestFirst(byType).slice(0, MAX_RAIL_ITEMS),
      layout: 'grid',
    });
  }

  const byOrigin = safe.filter((candidate) => origin && candidate.publicOrigin === origin);
  if (byOrigin.length > 0) {
    rails.push({
      key: 'same-source',
      title: 'From This Source',
      subtitle: 'More works published from the same creator home',
      items: sortNewestFirst(byOrigin).slice(0, MAX_RAIL_ITEMS),
      layout: 'grid',
    });
  }

  const seen = new Set<string>();
  return rails.filter((rail) => {
    const signature = rail.items.map(itemKey).join('|');
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  }).slice(0, 3);
}
