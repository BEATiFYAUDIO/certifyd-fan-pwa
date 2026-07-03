import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DiscoverableItem, ProfileTheme } from './types';

export const SAVED_WORKS_STORAGE_KEY = 'certifyd-player:saved-works:v1';
export const SAVED_CREATORS_STORAGE_KEY = 'certifyd-player:saved-creators:v1';
export const FOLLOWED_CREATORS_STORAGE_KEY = 'certifyd-player:followed-creators:v1';

const LOCAL_LIBRARY_EVENT = 'certifyd-player:local-library-change';
const MAX_SAVED_WORKS = 100;
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

function workKey(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>): string {
  return `${item.publicOrigin}::${item.contentId}`;
}

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
    profileUrl: `${publicOrigin}/u/${encodeURIComponent(handle)}`,
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

function readSavedWorks(): DiscoverableItem[] {
  return safeParseArray<DiscoverableItem>(SAVED_WORKS_STORAGE_KEY)
    .filter((item) => Boolean(item?.contentId && item?.publicOrigin))
    .slice(0, MAX_SAVED_WORKS);
}

function readCreators(key: string): LocalCreator[] {
  return safeParseArray<LocalCreator>(key)
    .filter((creator) => Boolean(creator?.key && creator?.handle && creator?.publicOrigin))
    .slice(0, MAX_CREATORS);
}

export function useLocalLibrary() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setVersion((current) => current + 1);
    window.addEventListener('storage', refresh);
    window.addEventListener(LOCAL_LIBRARY_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(LOCAL_LIBRARY_EVENT, refresh);
    };
  }, []);

  const savedWorks = useMemo(() => {
    void version;
    return readSavedWorks();
  }, [version]);
  const savedCreators = useMemo(() => {
    void version;
    return readCreators(SAVED_CREATORS_STORAGE_KEY);
  }, [version]);
  const followedCreators = useMemo(() => {
    void version;
    return readCreators(FOLLOWED_CREATORS_STORAGE_KEY);
  }, [version]);

  const savedWorkKeys = useMemo(() => new Set(savedWorks.map(workKey)), [savedWorks]);
  const savedCreatorKeys = useMemo(() => new Set(savedCreators.map((creator) => creator.key)), [savedCreators]);
  const followedCreatorKeys = useMemo(() => new Set(followedCreators.map((creator) => creator.key)), [followedCreators]);

  const toggleSavedWork = useCallback((item: DiscoverableItem) => {
    const key = workKey(item);
    const current = readSavedWorks();
    const exists = current.some((row) => workKey(row) === key);
    const next = exists ? current.filter((row) => workKey(row) !== key) : [item, ...current].slice(0, MAX_SAVED_WORKS);
    writeArray(SAVED_WORKS_STORAGE_KEY, next);
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
