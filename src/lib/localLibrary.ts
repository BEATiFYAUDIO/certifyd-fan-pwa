import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DiscoverableItem, ProfileTheme } from './types';
import { canonicalCreatorProfileUrlForItem } from './destinations';
import { loadDiscoverableById } from './contentRuntime/discovery';
import {
  LEGACY_SAVED_WORKS_STORAGE_KEY,
  LIBRARY_EVENT,
  itemIdFromDiscoverable,
  libraryRepository,
  parseItemId,
  type LibraryItemRecord,
} from './libraryStore';

export const SAVED_WORKS_STORAGE_KEY = LEGACY_SAVED_WORKS_STORAGE_KEY;
export const SAVED_CREATORS_STORAGE_KEY = 'certifyd-player:saved-creators:v1';
export const FOLLOWED_CREATORS_STORAGE_KEY = 'certifyd-player:followed-creators:v1';

const LOCAL_LIBRARY_EVENT = 'certifyd-player:local-library-change';
const MAX_CREATORS = 100;

export type LocalCreator = {
  key: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  profileUrl: string;
  publicOrigin: string;
  profileTheme?: ProfileTheme | null;
  itemCount?: number;
  freeCount?: number;
  premiumCount?: number;
  topics?: string[];
  types?: string[];
  latestTitle?: string;
};

export function creatorKey(handle: string | null | undefined, publicOrigin: string | null | undefined): string {
  const cleanHandle = String(handle || '').trim().replace(/^@+/, '').toLowerCase();
  const cleanOrigin = String(publicOrigin || '').trim().replace(/\/+$/, '').toLowerCase();
  return `${cleanOrigin}::${cleanHandle}`;
}

export function creatorFromItem(item: DiscoverableItem): LocalCreator | null {
  const handle = String(item.creatorHandle || '').trim().replace(/^@+/, '');
  if (!handle || !item.publicOrigin) return null;
  const publicOrigin = String(item.publicOrigin).replace(/\/+$/, '');
  return {
    key: creatorKey(handle, publicOrigin),
    handle,
    displayName: handle.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    avatarUrl: item.creatorAvatarUrl || item.creatorProfileImageUrl || item.profileImageUrl || item.avatarUrl || '',
    profileUrl: canonicalCreatorProfileUrlForItem(item),
    publicOrigin,
    profileTheme: item.profileTheme || null,
    itemCount: 1,
    freeCount: item.accessMode === 'locked' || item.isLocked ? 0 : 1,
    premiumCount: item.accessMode === 'locked' || item.isLocked || Number(item.priceSats || 0) > 0 ? 1 : 0,
    topics: item.primaryTopic ? [item.primaryTopic] : [],
    types: item.contentType ? [item.contentType] : [],
    latestTitle: item.title || '',
  };
}

function safeParseArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(LOCAL_LIBRARY_EVENT));
}

function readCreators(key: string): LocalCreator[] {
  return safeParseArray<LocalCreator>(key)
    .filter((creator) => Boolean(creator?.key && creator?.handle && creator?.publicOrigin))
    .slice(0, MAX_CREATORS);
}

export function useLocalLibrary() {
  const [version, setVersion] = useState(0);
  const [libraryItems, setLibraryItems] = useState<LibraryItemRecord[]>(() => libraryRepository.getItems());
  const [resolvedSavedWorks, setResolvedSavedWorks] = useState<DiscoverableItem[]>([]);

  useEffect(() => {
    const refresh = () => {
      setLibraryItems(libraryRepository.getItems());
      setVersion((current) => current + 1);
    };
    window.addEventListener('storage', refresh);
    window.addEventListener(LOCAL_LIBRARY_EVENT, refresh);
    window.addEventListener(LIBRARY_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(LOCAL_LIBRARY_EVENT, refresh);
      window.removeEventListener(LIBRARY_EVENT, refresh);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const resolve = async () => {
      const resolved: DiscoverableItem[] = [];
      for (const record of libraryItems) {
        const parsed = parseItemId(record.itemId);
        if (!parsed) continue;
        const item = await loadDiscoverableById(parsed.contentId, parsed.publicOrigin);
        if (!active) return;
        if (item) resolved.push(item);
      }
      if (active) setResolvedSavedWorks(resolved);
    };
    void resolve();
    return () => {
      active = false;
    };
  }, [libraryItems]);

  const savedWorks = resolvedSavedWorks;
  const savedCreators = useMemo(() => {
    void version;
    return readCreators(SAVED_CREATORS_STORAGE_KEY);
  }, [version]);
  const followedCreators = useMemo(() => {
    void version;
    return readCreators(FOLLOWED_CREATORS_STORAGE_KEY);
  }, [version]);

  const savedWorkKeys = useMemo(() => new Set(libraryItems.map((record) => record.itemId)), [libraryItems]);
  const savedCreatorKeys = useMemo(() => new Set(savedCreators.map((creator) => creator.key)), [savedCreators]);
  const followedCreatorKeys = useMemo(() => new Set(followedCreators.map((creator) => creator.key)), [followedCreators]);

  const toggleSavedWork = useCallback((item: DiscoverableItem) => {
    const key = itemIdFromDiscoverable(item);
    if (!key) return;
    setLibraryItems(libraryRepository.hasItem(key)
      ? libraryRepository.removeItem(key)
      : libraryRepository.addItem(key));
  }, []);

  const toggleSavedCreator = useCallback((creator: LocalCreator | null) => {
    if (!creator) return;
    const current = readCreators(SAVED_CREATORS_STORAGE_KEY);
    const exists = current.some((row) => row.key === creator.key);
    const next = exists ? current.filter((row) => row.key !== creator.key) : [creator, ...current].slice(0, MAX_CREATORS);
    writeArray(SAVED_CREATORS_STORAGE_KEY, next);
  }, []);

  const toggleFollowedCreator = useCallback((creator: LocalCreator | null) => {
    if (!creator) return;
    const current = readCreators(FOLLOWED_CREATORS_STORAGE_KEY);
    const exists = current.some((row) => row.key === creator.key);
    const next = exists ? current.filter((row) => row.key !== creator.key) : [creator, ...current].slice(0, MAX_CREATORS);
    writeArray(FOLLOWED_CREATORS_STORAGE_KEY, next);
  }, []);

  return {
    savedWorks,
    libraryItems,
    savedCreators,
    followedCreators,
    savedWorkKeys,
    savedCreatorKeys,
    followedCreatorKeys,
    toggleSavedWork,
    toggleSavedCreator,
    toggleFollowedCreator,
  };
}
