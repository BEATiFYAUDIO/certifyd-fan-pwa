import type { DiscoverableItem } from './types';
import { normalizeCanonicalOrigin } from './origin';

const UNLOCKED_ACCESS_CACHE_KEY = 'certifyd-player:unlocked-access:v1';
const UNLOCKED_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;

type UnlockedAccessRecord = {
  contentId: string;
  publicOrigin: string;
  updatedAt: number;
};

function clean(value: unknown): string {
  return String(value || '').trim();
}

function keyForItem(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>): string {
  return `${normalizeCanonicalOrigin(item.publicOrigin)}::${clean(item.contentId)}`;
}

function now() {
  return Date.now();
}

function isFresh(record: UnlockedAccessRecord) {
  return now() - record.updatedAt <= UNLOCKED_ACCESS_TTL_MS;
}

function readRecords(): UnlockedAccessRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UNLOCKED_ACCESS_CACHE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const records = parsed
      .map((row) => ({
        contentId: clean(row?.contentId),
        publicOrigin: normalizeCanonicalOrigin(row?.publicOrigin),
        updatedAt: Number(row?.updatedAt || 0),
      }))
      .filter((row) => row.contentId && row.publicOrigin && Number.isFinite(row.updatedAt) && isFresh(row));
    if (records.length !== parsed.length) writeRecords(records);
    return records;
  } catch {
    return [];
  }
}

function writeRecords(records: UnlockedAccessRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UNLOCKED_ACCESS_CACHE_KEY, JSON.stringify(records.slice(0, 250)));
  } catch {
    // Ignore storage quota/unavailable errors.
  }
}

export function hasRecentUnlockedAccessForItem(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>): boolean {
  const itemKey = keyForItem(item);
  return readRecords().some((record) => keyForItem(record) === itemKey);
}

export function rememberUnlockedAccessForItem(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>) {
  const contentId = clean(item.contentId);
  const publicOrigin = normalizeCanonicalOrigin(item.publicOrigin);
  if (!contentId || !publicOrigin) return;
  const itemKey = keyForItem({ contentId, publicOrigin });
  const next = [
    { contentId, publicOrigin, updatedAt: now() },
    ...readRecords().filter((record) => keyForItem(record) !== itemKey),
  ];
  writeRecords(next);
}

export function forgetUnlockedAccessForItem(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>) {
  const itemKey = keyForItem(item);
  writeRecords(readRecords().filter((record) => keyForItem(record) !== itemKey));
}
