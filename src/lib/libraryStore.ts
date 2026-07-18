import type { DiscoverableItem } from './types';

export const LIBRARY_STORAGE_KEY = 'certifyd.library.v1';
export const LEGACY_SAVED_WORKS_STORAGE_KEY = 'certifyd-player:saved-works:v1';
export const LIBRARY_EVENT = 'certifyd.library.change';

const MAX_LIBRARY_ITEMS = 500;

export type LibraryItemRecord = {
  itemId: string;
  addedAt: string;
};

export function itemIdFromParts(publicOrigin: string | null | undefined, contentId: string | null | undefined): string {
  const origin = String(publicOrigin || '').trim().replace(/\/+$/, '');
  const id = String(contentId || '').trim();
  return origin && id ? `${origin}::${id}` : '';
}

export function itemIdFromDiscoverable(item: Pick<DiscoverableItem, 'publicOrigin' | 'contentId'>): string {
  return itemIdFromParts(item.publicOrigin, item.contentId);
}

export function parseItemId(itemId: string): { publicOrigin: string; contentId: string } | null {
  const separatorIndex = itemId.indexOf('::');
  if (separatorIndex <= 0 || separatorIndex >= itemId.length - 2) return null;
  const publicOrigin = itemId.slice(0, separatorIndex).trim().replace(/\/+$/, '');
  const contentId = itemId.slice(separatorIndex + 2).trim();
  if (!publicOrigin || !contentId) return null;
  return { publicOrigin, contentId };
}

function safeParseArray(key: string): unknown[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLibrary(records: LibraryItemRecord[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(records.slice(0, MAX_LIBRARY_ITEMS)));
    window.dispatchEvent(new CustomEvent(LIBRARY_EVENT));
    return true;
  } catch {
    return false;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function validDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function normalizeLibraryRecords(rows: unknown[], fallbackAddedAt = nowIso()): LibraryItemRecord[] {
  const seen = new Set<string>();
  const records: LibraryItemRecord[] = [];
  for (const value of rows) {
    const row = value as Partial<LibraryItemRecord> | null;
    const itemId = typeof row?.itemId === 'string' ? row.itemId.trim() : '';
    if (!itemId || !parseItemId(itemId) || seen.has(itemId)) continue;
    seen.add(itemId);
    records.push({ itemId, addedAt: validDate(row?.addedAt, fallbackAddedAt) });
  }
  return records.slice(0, MAX_LIBRARY_ITEMS);
}

function readLegacySavedItemIds(): string[] {
  const seen = new Set<string>();
  const itemIds: string[] = [];
  for (const value of safeParseArray(LEGACY_SAVED_WORKS_STORAGE_KEY)) {
    const row = value as Partial<DiscoverableItem> | null;
    const itemId = itemIdFromParts(row?.publicOrigin, row?.contentId);
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    itemIds.push(itemId);
  }
  return itemIds;
}

function migrateLibraryIfNeeded(): LibraryItemRecord[] {
  if (typeof window === 'undefined') return [];
  const hasNewLibraryStore = window.localStorage.getItem(LIBRARY_STORAGE_KEY) !== null;
  const current = normalizeLibraryRecords(safeParseArray(LIBRARY_STORAGE_KEY));
  if (hasNewLibraryStore) return current;
  const timestamp = nowIso();
  const migrated = normalizeLibraryRecords(readLegacySavedItemIds().map((itemId) => ({ itemId, addedAt: timestamp })), timestamp);
  if (!migrated.length) return [];
  return writeLibrary(migrated) ? migrated : [];
}

export const libraryRepository = {
  getItems(): LibraryItemRecord[] {
    return migrateLibraryIfNeeded();
  },
  addItem(itemId: string): LibraryItemRecord[] {
    if (!parseItemId(itemId)) return migrateLibraryIfNeeded();
    const current = migrateLibraryIfNeeded();
    if (current.some((row) => row.itemId === itemId)) return current;
    const next = [{ itemId, addedAt: nowIso() }, ...current].slice(0, MAX_LIBRARY_ITEMS);
    writeLibrary(next);
    return next;
  },
  removeItem(itemId: string): LibraryItemRecord[] {
    const next = migrateLibraryIfNeeded().filter((row) => row.itemId !== itemId);
    writeLibrary(next);
    return next;
  },
  hasItem(itemId: string): boolean {
    return migrateLibraryIfNeeded().some((row) => row.itemId === itemId);
  },
};
