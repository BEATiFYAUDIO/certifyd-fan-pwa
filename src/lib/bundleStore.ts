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
  version: 1 | 2;
  title: string;
  description?: string;
  itemIds: string[];
  createdAt: string;
  recovered?: boolean;
};

type CompactSharedBundleManifest = {
  v: 2;
  t: string;
  d?: string;
  c?: string;
  o: string | string[];
  i: string[] | [number, string][];
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
  const itemIds = dedupeBundleItemIds(bundle.itemIds);
  const origins: string[] = [];
  const originIndexes = new Map<string, number>();
  const rows: [number, string][] = [];
  for (const itemId of itemIds) {
    const parsed = parseItemId(itemId);
    if (!parsed) continue;
    let originIndex = originIndexes.get(parsed.publicOrigin);
    if (originIndex == null) {
      originIndex = origins.length;
      origins.push(parsed.publicOrigin);
      originIndexes.set(parsed.publicOrigin, originIndex);
    }
    rows.push([originIndex, parsed.contentId]);
  }
  const manifest: CompactSharedBundleManifest = origins.length === 1
    ? {
        v: 2,
        t: bundle.title,
        d: bundle.description,
        o: origins[0],
        i: rows.map(([, contentId]) => contentId),
      }
    : {
        v: 2,
        t: bundle.title,
        d: bundle.description,
        o: origins,
        i: rows,
      };
  const json = JSON.stringify(manifest);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeSharedBundleText(data: string): string | null {
  if (!data || data.length > MAX_SHARED_DATA_CHARS) return null;
  try {
    const padded = data.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(data.length / 4) * 4, '=');
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return null;
  }
}

function normalizeSharedManifest(parsed: unknown): SharedBundleManifest | null {
  const row = parsed as Partial<SharedBundleManifest> | Partial<CompactSharedBundleManifest> | null;
  if (!row || typeof row !== 'object') return null;

  if ('version' in row) {
    if (row.version !== 1 || typeof row.title !== 'string' || !Array.isArray(row.itemIds)) return null;
    const title = row.title.trim();
    const itemIds = dedupeBundleItemIds(row.itemIds);
    if (!title || !itemIds.length) return null;
    return {
      version: 1,
      title,
      description: typeof row.description === 'string' && row.description.trim() ? row.description.trim() : undefined,
      itemIds,
      createdAt: validDate(row.createdAt, nowIso()),
    };
  }

  if ('v' in row) {
    if (row.v !== 2 || typeof row.t !== 'string') return null;
    const title = row.t.trim();
    const compactOrigins = row.o;
    const compactItems = row.i;
    if (!title || !compactOrigins || !Array.isArray(compactItems)) return null;
    const itemIds: string[] = [];
    if (typeof compactOrigins === 'string') {
      for (const contentId of compactItems) {
        if (typeof contentId !== 'string') continue;
        itemIds.push(`${compactOrigins.replace(/\/+$/, '')}::${contentId.trim()}`);
      }
    } else if (Array.isArray(compactOrigins)) {
      for (const compactItem of compactItems) {
        if (!Array.isArray(compactItem) || compactItem.length !== 2) continue;
        const [originIndex, contentId] = compactItem;
        const origin = compactOrigins[originIndex];
        if (typeof origin !== 'string' || typeof contentId !== 'string') continue;
        itemIds.push(`${origin.replace(/\/+$/, '')}::${contentId.trim()}`);
      }
    }
    const normalizedItemIds = dedupeBundleItemIds(itemIds);
    if (!normalizedItemIds.length) return null;
    return {
      version: 2,
      title,
      description: typeof row.d === 'string' && row.d.trim() ? row.d.trim() : undefined,
      itemIds: normalizedItemIds,
      createdAt: validDate(row.c, nowIso()),
    };
  }

  return null;
}

function extractJsonString(source: string, key: string): string {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (!match) return '';
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

function recoverPartialSharedBundle(source: string): SharedBundleManifest | null {
  const explicitMatches = source.match(/https?:\/\/[^"\\\s,[\]]+::[A-Za-z0-9._:-]+/g) || [];
  const compactOrigin = extractJsonString(source, 'o');
  const compactMatches = compactOrigin
    ? Array.from(source.matchAll(/"(cm[a-z0-9]{10,})"/gi), (match) => `${compactOrigin.replace(/\/+$/, '')}::${match[1]}`)
    : [];
  const itemIds = dedupeBundleItemIds([...explicitMatches, ...compactMatches]);
  if (!itemIds.length) return null;
  return {
    version: 1,
    title: extractJsonString(source, 'title') || extractJsonString(source, 't') || 'Shared Bundle Preview',
    description: extractJsonString(source, 'description') || extractJsonString(source, 'd') || undefined,
    itemIds,
    createdAt: nowIso(),
    recovered: true,
  };
}

export function decodeSharedBundle(data: string): SharedBundleManifest | null {
  const text = decodeSharedBundleText(data);
  if (!text) return null;
  try {
    return normalizeSharedManifest(JSON.parse(text));
  } catch {
    return recoverPartialSharedBundle(text);
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
