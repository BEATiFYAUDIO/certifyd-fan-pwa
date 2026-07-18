import { parseItemId } from './libraryStore';

export const BUNDLES_STORAGE_KEY = 'certifyd.bundles.v1';
export const BUNDLES_EVENT = 'certifyd.bundles.change';

const MAX_BUNDLES = 100;
const MAX_BUNDLE_ITEMS = 250;
const MAX_SHARED_DATA_CHARS = 12000;

export type BundleVisibility = 'private' | 'unlisted' | 'public';

export type Bundle = {
  id: string;
  title: string;
  description?: string;
  itemIds: string[];
  visibility: BundleVisibility;
  createdAt: string;
  updatedAt: string;
};

export type CreateBundleInput = {
  title: string;
  description?: string;
  itemIds: string[];
  visibility?: BundleVisibility;
};

export type UpdateBundleInput = Partial<Pick<Bundle, 'title' | 'description' | 'itemIds' | 'visibility'>>;

export type SharedBundleManifest = {
  version: 1;
  title: string;
  description?: string;
  itemIds: string[];
  createdAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
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

function writeBundles(bundles: Bundle[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BUNDLES_STORAGE_KEY, JSON.stringify(bundles.slice(0, MAX_BUNDLES)));
    window.dispatchEvent(new CustomEvent(BUNDLES_EVENT));
  } catch {
    /* ignore storage failures */
  }
}

function validDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function visibilityFromValue(value: unknown): BundleVisibility {
  return value === 'private' || value === 'unlisted' || value === 'public' ? value : 'private';
}

export function dedupeBundleItemIds(values: unknown[]): string[] {
  const seen = new Set<string>();
  const itemIds: string[] = [];
  for (const value of values) {
    const itemId = typeof value === 'string' ? value.trim() : '';
    if (!itemId || !parseItemId(itemId) || seen.has(itemId)) continue;
    seen.add(itemId);
    itemIds.push(itemId);
  }
  return itemIds.slice(0, MAX_BUNDLE_ITEMS);
}

function normalizeBundle(value: unknown): Bundle | null {
  const row = value as Partial<Bundle> | null;
  if (!row || typeof row !== 'object') return null;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  const createdAt = validDate(row.createdAt, nowIso());
  const itemIds = dedupeBundleItemIds(Array.isArray(row.itemIds) ? row.itemIds : []);
  if (!id || !title || !itemIds.length) return null;
  return {
    id,
    title,
    description: typeof row.description === 'string' && row.description.trim() ? row.description.trim() : undefined,
    itemIds,
    visibility: visibilityFromValue(row.visibility),
    createdAt,
    updatedAt: validDate(row.updatedAt, createdAt),
  };
}

function readBundles(): Bundle[] {
  return safeParseArray(BUNDLES_STORAGE_KEY)
    .map(normalizeBundle)
    .filter((bundle): bundle is Bundle => Boolean(bundle))
    .slice(0, MAX_BUNDLES);
}

function createBundleId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `bundle_${crypto.randomUUID()}`;
  return `bundle_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function listBundles(): Bundle[] {
  return readBundles().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getBundle(id: string): Bundle | null {
  return readBundles().find((bundle) => bundle.id === id) || null;
}

export function createBundle(input: CreateBundleInput): Bundle {
  const title = input.title.trim();
  if (!title) throw new Error('Title is required.');
  const itemIds = dedupeBundleItemIds(input.itemIds);
  if (!itemIds.length) throw new Error('Choose at least one item.');
  const timestamp = nowIso();
  const bundle: Bundle = {
    id: createBundleId(),
    title,
    description: input.description?.trim() || undefined,
    itemIds,
    visibility: visibilityFromValue(input.visibility),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  writeBundles([bundle, ...readBundles()]);
  return bundle;
}

export function updateBundle(id: string, updates: UpdateBundleInput): Bundle | null {
  let updated: Bundle | null = null;
  const bundles = readBundles().map((bundle) => {
    if (bundle.id !== id) return bundle;
    const nextTitle = updates.title != null ? updates.title.trim() : bundle.title;
    const nextItemIds = updates.itemIds != null ? dedupeBundleItemIds(updates.itemIds) : bundle.itemIds;
    if (!nextTitle || !nextItemIds.length) return bundle;
    updated = {
      ...bundle,
      title: nextTitle,
      description: updates.description != null ? updates.description.trim() || undefined : bundle.description,
      itemIds: nextItemIds,
      visibility: updates.visibility != null ? visibilityFromValue(updates.visibility) : bundle.visibility,
      updatedAt: nowIso(),
    };
    return updated;
  });
  writeBundles(bundles);
  return updated;
}

export function deleteBundle(id: string): void {
  writeBundles(readBundles().filter((bundle) => bundle.id !== id));
}

export function encodeSharedBundle(bundle: Pick<Bundle, 'title' | 'description' | 'itemIds' | 'createdAt'>): string {
  const manifest: SharedBundleManifest = {
    version: 1,
    title: bundle.title,
    description: bundle.description,
    itemIds: dedupeBundleItemIds(bundle.itemIds),
    createdAt: bundle.createdAt,
  };
  const json = JSON.stringify(manifest);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSharedBundle(data: string): SharedBundleManifest | null {
  if (!data || data.length > MAX_SHARED_DATA_CHARS) return null;
  try {
    const padded = data.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(data.length / 4) * 4, '=');
    const parsed = JSON.parse(decodeURIComponent(escape(atob(padded)))) as Partial<SharedBundleManifest>;
    if (parsed.version !== 1 || typeof parsed.title !== 'string' || !Array.isArray(parsed.itemIds)) return null;
    const title = parsed.title.trim();
    const itemIds = dedupeBundleItemIds(parsed.itemIds);
    if (!title || !itemIds.length) return null;
    return {
      version: 1,
      title,
      description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : undefined,
      itemIds,
      createdAt: validDate(parsed.createdAt, nowIso()),
    };
  } catch {
    return null;
  }
}

export function sharedBundleUrl(data: string): string {
  const configuredBase = String(import.meta.env.VITE_CERTIFYD_FAN_PUBLIC_URL || '').trim();
  const runtimeBase = typeof window !== 'undefined'
    ? new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString()
    : '/';
  const base = configuredBase || runtimeBase;
  return new URL(`bundles/shared?data=${encodeURIComponent(data)}`, base.endsWith('/') ? base : `${base}/`).toString();
}
