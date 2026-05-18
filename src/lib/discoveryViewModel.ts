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
  dynamicRails: DiscoveryRail[];
};

const MAX_RAIL_ITEMS = 8;
const MAX_DYNAMIC_RAILS = 4;
const MIN_DYNAMIC_RAIL_ITEMS = 3;
const MIN_WATCH_RAIL_ITEMS = 2;
const HUMAN_TYPE_LABELS: Record<string, string> = {
  song: 'Music',
  audio: 'Audio',
  video: 'Media',
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
  if (!normalized) return 'Publications';
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

function railSignature(rail: DiscoveryRail): string {
  return rail.items.map(itemKey).join('|');
}

function uniqueItems(items: DiscoverableItem[]): DiscoverableItem[] {
  return dedupeDiscoveryItems(items);
}

function railScore(rows: DiscoverableItem[]): number {
  const unique = uniqueItems(rows);
  const latest = Math.max(...unique.map(itemSortTime), 0);
  return unique.length * 10000000000000 + latest;
}

function hasHeavyOverlap(a: DiscoveryRail, b: DiscoveryRail): boolean {
  const aKeys = new Set(a.items.map(itemKey));
  const bKeys = new Set(b.items.map(itemKey));
  const smaller = Math.min(aKeys.size, bKeys.size);
  if (smaller === 0) return true;
  let overlap = 0;
  for (const key of aKeys) {
    if (bKeys.has(key)) overlap += 1;
  }
  return overlap / smaller >= 0.6;
}

function buildDynamicRails(safe: DiscoverableItem[]): DiscoveryRail[] {
  const candidates: DiscoveryRail[] = [];

  for (const [topic, rows] of bestGroups(groupBy(safe, (item) => text(item.primaryTopic)), MIN_DYNAMIC_RAIL_ITEMS)) {
    const label = displayTopic(topic);
    candidates.push({
      key: `topic:${topic}`,
      title: label,
      subtitle: `Fresh works in ${label.toLowerCase()}`,
      items: sortNewestFirst(uniqueItems(rows)).slice(0, MAX_RAIL_ITEMS),
      layout: 'grid',
    });
  }

  for (const [type, rows] of bestGroups(groupBy(safe, (item) => text(item.contentType).toLowerCase()), MIN_DYNAMIC_RAIL_ITEMS)) {
    const label = displayType(type);
    candidates.push({
      key: `type:${type}`,
      title: label,
      subtitle: 'Browse by format',
      items: sortNewestFirst(uniqueItems(rows)).slice(0, MAX_RAIL_ITEMS),
      layout: 'grid',
    });
  }

  const stableOriginItems = safe.filter((item) => item.originHealth === 'healthy' && (item.originTrust === 'stable' || item.originTrust === 'provider'));
  if (stableOriginItems.length >= MIN_DYNAMIC_RAIL_ITEMS) {
    candidates.push({
      key: 'stable-origins',
      title: 'Reliable Sources',
      subtitle: 'Works from currently healthy creator origins',
      items: sortNewestFirst(uniqueItems(stableOriginItems)).slice(0, MAX_RAIL_ITEMS),
      layout: 'grid',
    });
  }

  const ranked = candidates
    .filter((rail) => rail.items.length >= MIN_DYNAMIC_RAIL_ITEMS)
    .sort((a, b) => railScore(b.items) - railScore(a.items));

  const selected: DiscoveryRail[] = [];
  for (const rail of ranked) {
    if (selected.some((existing) => existing.key === rail.key || railSignature(existing) === railSignature(rail) || hasHeavyOverlap(existing, rail))) {
      continue;
    }
    selected.push(rail);
    if (selected.length >= MAX_DYNAMIC_RAILS) break;
  }

  return selected;
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
  const dynamicRails = buildDynamicRails(safe);
  const stableOriginRail = dynamicRails.find((rail) => rail.key === 'stable-origins') || null;

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
    topicRails: dynamicRails.filter((rail) => rail.key.startsWith('topic:')),
    typeRails: dynamicRails.filter((rail) => rail.key.startsWith('type:')),
    stableOriginRail,
    dynamicRails,
  };
}

export function buildWatchDiscoveryRails(item: DiscoverableItem, items: DiscoverableItem[]): DiscoveryRail[] {
  const safe = dedupeDiscoveryItems(items).filter((candidate) => itemKey(candidate) !== itemKey(item));
  const creator = text(item.creatorHandle).replace(/^@+/, '').toLowerCase();
  const topic = text(item.primaryTopic).toLowerCase();
  const type = text(item.contentType).toLowerCase();
  const origin = text(item.publicOrigin);
  const rails: DiscoveryRail[] = [];
  const used = new Set<string>();
  const pickItems = (rows: DiscoverableItem[]) => sortNewestFirst(rows)
    .filter((candidate) => {
      const key = itemKey(candidate);
      if (used.has(key)) return false;
      return true;
    })
    .slice(0, MAX_RAIL_ITEMS);
  const addRail = (rail: DiscoveryRail) => {
    if (rail.items.length < MIN_WATCH_RAIL_ITEMS) return;
    rails.push(rail);
    rail.items.forEach((candidate) => used.add(itemKey(candidate)));
  };

  const byCreator = safe.filter((candidate) => text(candidate.creatorHandle).replace(/^@+/, '').toLowerCase() === creator);
  if (byCreator.length > 0) {
    addRail({
      key: 'more-from-creator',
      title: 'More From This Creator',
      subtitle: `Other works by @${item.creatorHandle || 'creator'}`,
      items: pickItems(byCreator),
      layout: 'grid',
    });
  }

  const byTopic = safe.filter((candidate) => topic && text(candidate.primaryTopic).toLowerCase() === topic);
  if (byTopic.length > 0) {
    addRail({
      key: 'more-like-this',
      title: 'More Like This',
      subtitle: `More in ${displayTopic(topic).toLowerCase()}`,
      items: pickItems(byTopic),
      layout: 'grid',
    });
  }

  const byType = safe.filter((candidate) => type && text(candidate.contentType).toLowerCase() === type);
  if (byType.length > 0) {
    addRail({
      key: 'same-format',
      title: `More ${displayType(type)}`,
      subtitle: 'Other works in this format',
      items: pickItems(byType),
      layout: 'grid',
    });
  }

  const byOrigin = safe.filter((candidate) => origin && candidate.publicOrigin === origin);
  if (byOrigin.length > 0) {
    addRail({
      key: 'same-source',
      title: 'From This Source',
      subtitle: 'More works published from the same creator home',
      items: pickItems(byOrigin),
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
