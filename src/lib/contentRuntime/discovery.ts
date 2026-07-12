import { fetchDiscoverablePage } from '../api';
import { loadConfiguredOrigins } from '../config';
import { dedupeDiscoveryItems, sortNewestFirst } from '../discoveryViewModel';
import type { DiscoverableItem, Topic } from '../types';

const DISCOVERY_FIRST_PASS_TIMEOUT_MS = 4500;
const DISCOVERY_FALLBACK_TIMEOUT_MS = 7000;
const DISCOVERY_MAX_PAGES_PER_ORIGIN = 2;

export async function loadDiscoverableById(contentId: string, originHint: string | null): Promise<DiscoverableItem | null> {
  const origins = await loadConfiguredOrigins();
  const ordered = originHint ? [originHint, ...origins.filter((origin) => origin !== originHint)] : origins;
  const firstPass = await Promise.all(
    ordered.map(async (origin) => {
      try {
        const response = await fetchDiscoverablePage({ origin, topic: 'all', limit: 24, timeoutMs: DISCOVERY_FIRST_PASS_TIMEOUT_MS });
        return response.items.find((item) => item.contentId === contentId) || null;
      } catch {
        return null;
      }
    }),
  );
  const hit = firstPass.find(Boolean) || null;
  if (hit) return hit;
  for (const origin of ordered) {
    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      try {
        const response = await fetchDiscoverablePage({ origin, topic: 'all', limit: 24, cursor, timeoutMs: DISCOVERY_FALLBACK_TIMEOUT_MS });
        const deeperHit = response.items.find((item) => item.contentId === contentId);
        if (deeperHit) return deeperHit;
        if (!response.cursor) break;
        cursor = response.cursor;
      } catch {
        break;
      }
    }
  }
  return null;
}

export async function loadDiscoveryItems(topic: Topic): Promise<DiscoverableItem[]> {
  const origins = await loadConfiguredOrigins();
  const rowsByOrigin = await Promise.all(
    origins.map(async (origin) => {
      const originRows: DiscoverableItem[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < DISCOVERY_MAX_PAGES_PER_ORIGIN; page += 1) {
        try {
          const response = await fetchDiscoverablePage({ origin, topic, limit: 18, cursor, timeoutMs: DISCOVERY_FIRST_PASS_TIMEOUT_MS });
          originRows.push(...response.items);
          if (!response.cursor) break;
          cursor = response.cursor;
        } catch {
          break;
        }
      }
      return originRows;
    }),
  );
  return sortNewestFirst(dedupeDiscoveryItems(rowsByOrigin.flat()));
}
