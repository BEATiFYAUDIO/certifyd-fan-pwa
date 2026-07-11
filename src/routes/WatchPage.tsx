import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStage1APlayer } from '../components/stage1APlayerContext';
import { fetchContentContext, fetchDiscoverablePage } from '../lib/api';
import { loadConfiguredOrigins } from '../lib/config';
import { resolveAccessFromOffer, type CanonicalOffer } from '../lib/accessResolver';
import { fetchCanonicalOfferPayload, normalizeCanonicalOffer } from '../lib/offerFetch';
import { rememberReceiptProofForItem, withReceiptProofs } from '../lib/receiptProofs';
import { hydrateReceiptStatusForItem, type ReceiptAccessStatus } from '../lib/receiptStatus';
import { normalizeCanonicalOrigin } from '../lib/origin';
import { buyUrlWithFanReturnUrl, contentboxBuyUrlForItem } from '../lib/fanReturnUrl';
import type { ContentContextCreator, ContentContextPerson, ContentContextWork, ContentRelationshipContext, DiscoverableItem, Topic } from '../lib/types';
import { canOpenCreator, isLockedOrPremium, isRenderableDiscoveryItem } from '../lib/discoveryGuard';
import { displayStateFromItem } from '../lib/playbackDisplay';
import { buildWatchDiscoveryRails, dedupeDiscoveryItems, sortNewestFirst, type DiscoveryRail } from '../lib/discoveryViewModel';
import { getCardThemeVars } from '../lib/profileTheme';

function useMobileReelsMode() {
  const [isMobile, setIsMobile] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 900));
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia('(max-width: 899px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return isMobile;
}

function ctaLabel(item: DiscoverableItem) {
  return displayStateFromItem(item).ctaLabel;
}

function resolveAbsoluteUrl(value: unknown, origin: string): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed, `${origin}/`).toString();
  } catch {
    return '';
  }
}

function priceLabel(item: DiscoverableItem): string {
  return displayStateFromItem(item).label;
}

function previewSecondsValue(...values: unknown[]): DiscoverableItem['previewSeconds'] {
  for (const value of values) {
    if (typeof value === 'number' || typeof value === 'string' || value === null) return value;
  }
  return null;
}

type CanonicalOfferResult = {
  offer: CanonicalOffer | null;
  receiptStatus: ReceiptAccessStatus | null;
};

async function fetchCanonicalOffer(item: DiscoverableItem): Promise<CanonicalOfferResult> {
  let receiptStatus = await hydrateReceiptStatusForItem(item);
  const canonicalOfferUrl = resolveAbsoluteUrl(`/buy/content/${encodeURIComponent(item.contentId)}/offer`, item.publicOrigin);
  const baseOfferUrls = [...new Set([String(item.offerUrl || '').trim(), canonicalOfferUrl].filter(Boolean))];
  const offerUrls = baseOfferUrls.flatMap((offerUrl) => withReceiptProofs(offerUrl, item));
  const offer = normalizeCanonicalOffer(await fetchCanonicalOfferPayload(offerUrls)) as CanonicalOffer | null;
  const paymentAccessProof = offer?.paymentAccessProof && typeof offer.paymentAccessProof === 'object'
    ? offer.paymentAccessProof as Record<string, unknown>
    : null;
  rememberReceiptProofForItem(item, {
    receiptId: typeof paymentAccessProof?.paymentReceiptId === 'string' ? paymentAccessProof.paymentReceiptId : typeof offer?.receiptId === 'string' ? offer.receiptId : undefined,
    receiptToken: typeof paymentAccessProof?.receiptToken === 'string' ? paymentAccessProof.receiptToken : typeof offer?.receiptToken === 'string' ? offer.receiptToken : undefined,
    paymentIntentId: typeof paymentAccessProof?.paymentIntentId === 'string' ? paymentAccessProof.paymentIntentId : typeof offer?.paymentIntentId === 'string' ? offer.paymentIntentId : undefined,
    paidAt: typeof paymentAccessProof?.paidAt === 'string' ? paymentAccessProof.paidAt : typeof offer?.paidAt === 'string' ? offer.paidAt : undefined,
  });
  if (!receiptStatus) receiptStatus = await hydrateReceiptStatusForItem(item);
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    console.debug('[Certifyd receipt propagation]', 'WatchPage offer hydration result', {
      item: { contentId: item.contentId, publicOrigin: item.publicOrigin },
      receiptStatus,
      offer,
    });
  }
  return { offer, receiptStatus };
}

function mergeCanonicalOffer(item: DiscoverableItem, offer: CanonicalOffer, receiptStatus: ReceiptAccessStatus | null): DiscoverableItem {
  const origin = item.publicOrigin;
  const access = resolveAccessFromOffer(item, offer, receiptStatus);
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    console.debug('[Certifyd receipt propagation]', 'WatchPage resolved access', {
      item: { contentId: item.contentId, publicOrigin: item.publicOrigin },
      receiptStatus,
      access,
      playback: access.playback,
    });
  }

  return {
    ...item,
    title: typeof offer.title === 'string' && offer.title.trim() ? offer.title : item.title,
    description: typeof offer.description === 'string' ? offer.description : item.description,
    contentType: typeof offer.type === 'string' && offer.type.trim()
      ? offer.type
      : (typeof offer.contentType === 'string' && offer.contentType.trim() ? offer.contentType : item.contentType),
    primaryTopic: typeof offer.primaryTopic === 'string' && offer.primaryTopic.trim()
      ? (offer.primaryTopic as DiscoverableItem['primaryTopic'])
      : item.primaryTopic,
    creatorHandle: typeof offer.creatorHandle === 'string' && offer.creatorHandle.trim() ? offer.creatorHandle : item.creatorHandle,
    profileTheme: offer.profileTheme && typeof offer.profileTheme === 'object'
      ? offer.profileTheme as DiscoverableItem['profileTheme']
      : item.profileTheme,
    coverUrl: resolveAbsoluteUrl(offer.coverUrl, origin) || item.coverUrl,
    previewUrl: access.playback.mode === 'preview'
      ? resolveAbsoluteUrl(access.playback.streamUrl, origin) || resolveAbsoluteUrl(offer.previewUrl, origin) || item.previewUrl
      : resolveAbsoluteUrl(offer.previewUrl, origin) || item.previewUrl,
    fullMediaUrl: access.playback.mode === 'full'
      ? resolveAbsoluteUrl(access.playback.streamUrl, origin) || resolveAbsoluteUrl(offer.fullMediaUrl, origin) || item.fullMediaUrl || null
      : null,
    fullContentUrl: access.playback.mode === 'full'
      ? resolveAbsoluteUrl(access.playback.streamUrl, origin) || resolveAbsoluteUrl(offer.fullContentUrl, origin) || item.fullContentUrl || null
      : null,
    buyUrl: resolveAbsoluteUrl(offer.buyUrl, origin) || item.buyUrl,
    offerUrl: resolveAbsoluteUrl(offer.offerUrl, origin) || item.offerUrl || resolveAbsoluteUrl(`/buy/content/${encodeURIComponent(item.contentId)}/offer`, origin),
    priceSats: access.priceSats,
    accessMode: access.accessMode,
    isLocked: access.isLocked,
    isFree: access.isFree,
    hasFullAccess: access.owned,
    owned: access.owned,
    canonicalOfferHydrated: true,
    previewSeconds: previewSecondsValue(access.playback.previewLimitSeconds, offer.previewSeconds, offer.previewDurationSeconds, offer.previewLimitSeconds, item.previewSeconds),
    primaryFileMime: typeof offer.primaryFileMime === 'string' ? offer.primaryFileMime : item.primaryFileMime,
    paymentAccessProof: offer.paymentAccessProof && typeof offer.paymentAccessProof === 'object'
      ? offer.paymentAccessProof as DiscoverableItem['paymentAccessProof']
      : item.paymentAccessProof,
  };
}

async function hydrateCanonicalOffer(item: DiscoverableItem): Promise<DiscoverableItem> {
  const { offer, receiptStatus } = await fetchCanonicalOffer(item);
  if (!offer) {
    if (import.meta.env.DEV) {
      console.debug('[Certifyd WatchPage resolver]', {
        phase: 'canonical-offer-missing',
        contentId: item.contentId,
        title: item.title,
      });
    }
    return item;
  }
  const hydrated = mergeCanonicalOffer(item, offer, receiptStatus);
  if (import.meta.env.DEV) {
    console.debug('[Certifyd WatchPage resolver]', {
      phase: 'canonical-offer-hydrated',
      contentId: hydrated.contentId,
      title: hydrated.title,
      priceSats: hydrated.priceSats,
      isLocked: hydrated.isLocked,
      accessMode: hydrated.accessMode,
      hasFullAccess: hydrated.hasFullAccess,
      previewUrl: Boolean(hydrated.previewUrl),
      fullMediaUrl: Boolean(hydrated.fullMediaUrl),
    });
  }
  return hydrated;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Failed to load content';
}

type CreditItem = {
  participantName?: string | null;
  displayName?: string | null;
  handle?: string | null;
  role?: string | null;
  sharePercent?: number | string | null;
  percent?: number | string | null;
};

const FREEBIES_FIRST_PASS_TIMEOUT_MS = 4500;
const FREEBIES_FALLBACK_TIMEOUT_MS = 7000;
const FREEBIES_MAX_PAGES_PER_ORIGIN = 2;

async function loadById(contentId: string, originHint: string | null): Promise<DiscoverableItem | null> {
  const origins = await loadConfiguredOrigins();
  const ordered = originHint ? [originHint, ...origins.filter((o) => o !== originHint)] : origins;

  // Fast path: query first page on all origins in parallel.
  const firstPass = await Promise.all(
    ordered.map(async (origin) => {
      try {
        const response = await fetchDiscoverablePage({
          origin,
          topic: 'all',
          limit: 24,
          timeoutMs: FREEBIES_FIRST_PASS_TIMEOUT_MS,
        });
        return response.items.find((i) => i.contentId === contentId) || null;
      } catch {
        return null;
      }
    })
  );
  const hit = firstPass.find(Boolean) || null;
  if (hit) return hit;

  // Fallback: deeper sequential page walk.
  for (const origin of ordered) {
    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      try {
        const response = await fetchDiscoverablePage({
          origin,
          topic: 'all',
          limit: 24,
          cursor,
          timeoutMs: FREEBIES_FALLBACK_TIMEOUT_MS,
        });
        const deeperHit = response.items.find((i) => i.contentId === contentId);
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

async function loadCredits(item: DiscoverableItem): Promise<CreditItem[]> {
  const endpoint = `${item.publicOrigin}/public/content/${encodeURIComponent(item.contentId)}/credits`;
  const res = await fetch(endpoint);
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? (data as CreditItem[]) : [];
}

function normalizeTopic(value: string): Topic {
  const raw = String(value || 'all').toLowerCase();
  if (raw === 'entertainment' || raw === 'music' || raw === 'news' || raw === 'gaming' || raw === 'sports' || raw === 'technology') {
    return raw;
  }
  return 'all';
}

async function loadFreebies(topic: Topic): Promise<DiscoverableItem[]> {
  const origins = await loadConfiguredOrigins();
  const rowsByOrigin = await Promise.all(
    origins.map(async (origin) => {
      const originRows: DiscoverableItem[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < FREEBIES_MAX_PAGES_PER_ORIGIN; page += 1) {
        try {
          const response = await fetchDiscoverablePage({
            origin,
            topic,
            limit: 18,
            cursor,
            timeoutMs: FREEBIES_FIRST_PASS_TIMEOUT_MS,
          });
          originRows.push(...response.items);
          if (!response.cursor) break;
          cursor = response.cursor;
        } catch {
          break;
        }
      }
      return originRows;
    })
  );
  const rows: DiscoverableItem[] = rowsByOrigin.flat();
  const seen = new Map<string, DiscoverableItem>();
  for (const it of rows) {
    if (isLockedOrPremium(it) || !(it.accessMode === 'unlocked' || it.accessMode === 'owned')) continue;
    const key = `${it.publicOrigin}::${it.contentId}`;
    if (!seen.has(key)) seen.set(key, it);
  }
  return sortNewestFirst([...seen.values()]);
}

async function loadDiscoveryItems(topic: Topic): Promise<DiscoverableItem[]> {
  const origins = await loadConfiguredOrigins();
  const rowsByOrigin = await Promise.all(
    origins.map(async (origin) => {
      const originRows: DiscoverableItem[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < FREEBIES_MAX_PAGES_PER_ORIGIN; page += 1) {
        try {
          const response = await fetchDiscoverablePage({
            origin,
            topic,
            limit: 18,
            cursor,
            timeoutMs: FREEBIES_FIRST_PASS_TIMEOUT_MS,
          });
          originRows.push(...response.items);
          if (!response.cursor) break;
          cursor = response.cursor;
        } catch {
          break;
        }
      }
      return originRows;
    })
  );
  return sortNewestFirst(dedupeDiscoveryItems(rowsByOrigin.flat()));
}

function watchHrefForItem(item: DiscoverableItem): string {
  return `/watch/${encodeURIComponent(item.contentId)}?origin=${encodeURIComponent(item.publicOrigin)}`;
}

function discoveryItemKey(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'> | null | undefined): string {
  return item ? `${item.publicOrigin}::${item.contentId}` : '';
}

type WatchDetailRow = { label: string; value: string; kind?: 'item' | 'heading' };

function addWatchDetailRow(rows: WatchDetailRow[], label: string, value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return;
  rows.push({ label, value: text });
}

function WatchDiscoveryCard({
  item,
  queue,
  onSelect,
  onPlay,
}: {
  item: DiscoverableItem;
  queue: DiscoverableItem[];
  onSelect: (item: DiscoverableItem) => void;
  onPlay: (item: DiscoverableItem, queue: DiscoverableItem[]) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const playbackDisplay = displayStateFromItem(item);
  const creator = String(item.creatorHandle || 'creator').replace(/^@+/, '');
  const themeVars = useMemo(() => getCardThemeVars(item.profileTheme), [item.profileTheme]);
  return (
    <Link
      to={watchHrefForItem(item)}
      state={{ item }}
      className="creator-themed-card group block overflow-hidden rounded-2xl border p-2"
      style={themeVars}
      onClick={(event) => {
        event.preventDefault();
        onSelect(item);
      }}
    >
      <div className="creator-themed-media relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-800/90 transition duration-300 group-hover:-translate-y-0.5">
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            playbackDisplay.state === 'preview' ? 'creator-themed-badge border' : 'creator-themed-badge-muted border'
          }`}>
            {playbackDisplay.label}
          </span>
        </div>
        {item.coverUrl && !imageFailed ? (
          <img
            src={item.coverUrl}
            alt={item.title || 'Content cover'}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 px-4 text-center">
            <p className="line-clamp-2 text-sm font-semibold text-zinc-200">{item.title || 'Untitled'}</p>
            <p className="mt-1 text-xs text-zinc-400">{(item.primaryTopic || 'topic').toUpperCase()} · {item.contentType.toUpperCase()}</p>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <button
          type="button"
          className="absolute bottom-2 right-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-black text-black opacity-0 shadow-lg transition group-hover:opacity-100 focus:opacity-100"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPlay(item, queue);
          }}
          aria-label={`Play ${item.title || 'work'}`}
        >
          Play
        </button>
      </div>
      <div className="mt-2 min-w-0">
        <div className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100">{item.title || 'Untitled'}</div>
        <div className="mt-1 truncate text-xs text-zinc-400">@{creator} • {item.contentType || 'work'}</div>
      </div>
    </Link>
  );
}

function ExplorationRail({
  rail,
  onSelectItem,
  onPlayItem,
}: {
  rail: DiscoveryRail;
  onSelectItem: (item: DiscoverableItem) => void;
  onPlayItem: (item: DiscoverableItem, queue: DiscoverableItem[]) => void;
}) {
  if (rail.items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-100">{rail.title}</h2>
        <p className="mt-1 text-xs text-zinc-400">{rail.subtitle}</p>
      </div>
      <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {rail.items.map((related) => (
          <WatchDiscoveryCard
            key={`${rail.key}:${related.publicOrigin}:${related.contentId}`}
            item={related}
            queue={rail.items}
            onSelect={onSelectItem}
            onPlay={onPlayItem}
          />
        ))}
      </div>
    </section>
  );
}

function personKey(person: ContentContextPerson | ContentContextCreator): string {
  return `${person.profileUrl || ''}|${person.handle || ''}|${person.displayName || ''}`.toLowerCase();
}

function workKey(work: ContentContextWork): string {
  return `${work.contentId}|${work.publicUrl || ''}`;
}

function watchHrefForWork(work: ContentContextWork): string {
  let origin: string;
  try {
    origin = work.publicUrl ? new URL(work.publicUrl).origin : '';
  } catch {
    origin = '';
  }
  const params = origin ? `?origin=${encodeURIComponent(origin)}` : '';
  return `/watch/${encodeURIComponent(work.contentId)}${params}`;
}

function workToDiscoverableItem(work: ContentContextWork): DiscoverableItem | null {
  let publicOrigin = (work as ContentContextWork & { publicOrigin?: string | null }).publicOrigin || '';
  try {
    publicOrigin = publicOrigin || (work.publicUrl ? new URL(work.publicUrl).origin : '');
  } catch {
    publicOrigin = publicOrigin || '';
  }
  if (!work.contentId || !publicOrigin) return null;
  const buyUrl = contentboxBuyUrlForItem({ contentId: work.contentId, publicOrigin });
  const normalizedTopic = normalizeTopic(work.primaryTopic || 'all');
  return {
    contentId: work.contentId,
    title: work.title || 'Untitled work',
    description: null,
    creatorHandle: work.creator?.handle || work.creator?.displayName || null,
    contentType: work.contentType || 'work',
    primaryTopic: normalizedTopic === 'all' ? null : normalizedTopic,
    coverUrl: work.coverUrl || '',
    previewUrl: work.previewUrl || '',
    buyUrl,
    offerUrl: `${publicOrigin}/buy/content/${encodeURIComponent(work.contentId)}/offer`,
    priceSats: 0,
    accessMode: 'unlocked',
    publicOrigin,
    profileTheme: work.profileTheme || work.creator?.profileTheme || null,
  };
}

function compactPersonLabel(person: ContentContextPerson | ContentContextCreator | null | undefined): string {
  if (!person) return '';
  return person.displayName || person.handle || 'Creator';
}

function dedupePeople<T extends ContentContextPerson | ContentContextCreator>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = personKey(row);
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function dedupeWorks(rows: ContentContextWork[], exclude = new Set<string>()): ContentContextWork[] {
  const seen = new Set<string>(exclude);
  const out: ContentContextWork[] = [];
  for (const row of rows) {
    const key = workKey(row);
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function isUpstreamPerson(person: ContentContextPerson): boolean {
  return /^upstream\b/i.test(person.relationshipLabel || '');
}

function isLowValueGenericPerson(person: ContentContextPerson | ContentContextCreator): boolean {
  const display = String(person.displayName || '').trim().toLowerCase();
  const handle = String(person.handle || '').trim().replace(/^@+/, '').toLowerCase();
  const profileUrl = String(person.profileUrl || '').trim().toLowerCase();
  const isPlaceholderContributor = display === 'contributor' && (!handle || handle === 'contributor');
  const hasPlaceholderProfile = /\/u\/contributor(?:[/?#]|$)/i.test(profileUrl);
  const hasRealPublicIdentity = Boolean(person.avatarUrl || (person.profileUrl && !hasPlaceholderProfile));
  return isPlaceholderContributor && !hasRealPublicIdentity;
}

function filterDisplayPeople(rows: ContentContextPerson[]): ContentContextPerson[] {
  return rows.filter((person) => !isLowValueGenericPerson(person));
}

function filterDisplayCreators(rows: ContentContextCreator[]): ContentContextCreator[] {
  return rows.filter((creator) => !isLowValueGenericPerson(creator));
}

function PeopleList({ people }: { people: ContentContextPerson[] }) {
  if (!people.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {people.map((person) => {
        const label = person.displayName || person.handle || 'Contributor';
        const handle = person.handle ? `@${String(person.handle).replace(/^@+/, '')}` : null;
        const body = (
          <div className="watch-card watch-card-hover flex min-w-0 items-center gap-3 rounded-xl border p-3 transition">
            {person.avatarUrl ? (
              <img src={person.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-zinc-700 object-cover" loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <div className="watch-card flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-xs font-bold watch-accent-text">
                {label.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-100">{label}</div>
              <div className="truncate text-xs text-zinc-400">
                {person.relationshipLabel || person.role || 'Contributor'}{handle ? ` • ${handle}` : ''}
              </div>
            </div>
          </div>
        );
        return person.profileUrl ? (
          <a key={personKey(person)} href={person.profileUrl} target="_blank" rel="noreferrer" className="block">
            {body}
          </a>
        ) : (
          <div key={personKey(person)}>{body}</div>
        );
      })}
    </div>
  );
}

function WorksList({
  works,
  onSelectWork,
  onPlayWork,
}: {
  works: ContentContextWork[];
  onSelectWork?: (item: DiscoverableItem) => void;
  onPlayWork?: (item: DiscoverableItem, queue: DiscoverableItem[]) => void;
}) {
  const { playItem } = useStage1APlayer();
  const playableWorks = useMemo(
    () => works.map((work) => workToDiscoverableItem(work)).filter((work): work is DiscoverableItem => Boolean(work)),
    [works]
  );
  if (!works.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {works.map((work) => {
        const creator = work.creator?.displayName || work.creator?.handle || 'Creator';
        const playableWork = workToDiscoverableItem(work);
        const card = (
          <div className="watch-card watch-card-hover group overflow-hidden rounded-xl border text-left transition">
            <div className="relative aspect-video bg-zinc-950">
              {work.coverUrl ? (
                <img src={work.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex h-full items-center justify-center px-3 text-center text-xs uppercase tracking-[0.18em] text-zinc-500">
                  {work.contentType || 'Work'}
                </div>
              )}
              {playableWork ? (
                <button
                  type="button"
                  className="absolute bottom-2 right-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-black text-black opacity-0 shadow-lg transition group-hover:opacity-100 focus:opacity-100"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (onPlayWork) {
                      onPlayWork(playableWork, playableWorks);
                      return;
                    }
                    void playItem(playableWork, { queue: playableWorks });
                  }}
                  aria-label={`Play ${work.title || 'work'}`}
                >
                  Play
                </button>
              ) : null}
            </div>
            <div className="space-y-1 p-3">
              <div className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100">{work.title || 'Untitled work'}</div>
              <div className="truncate text-xs text-zinc-400">{creator} • {work.contentType || 'work'}</div>
              <div className="watch-accent-text truncate text-xs font-semibold">{work.relationshipLabel || 'Related work'}</div>
            </div>
          </div>
        );
        return playableWork ? (
          <div
            key={workKey(work)}
            role="button"
            tabIndex={0}
            className="block w-full text-left"
            onClick={() => {
              if (onSelectWork) {
                onSelectWork(playableWork);
                return;
              }
              void playItem(playableWork, { queue: playableWorks });
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              if (onSelectWork) {
                onSelectWork(playableWork);
                return;
              }
              void playItem(playableWork, { queue: playableWorks });
            }}
          >
            {card}
          </div>
        ) : work.contentId ? (
          <Link
            key={workKey(work)}
            to={watchHrefForWork(work)}
            className="block"
          >
            {card}
          </Link>
        ) : work.publicUrl ? (
          <a key={workKey(work)} href={work.publicUrl} target="_blank" rel="noreferrer" className="block">{card}</a>
        ) : (
          <div key={workKey(work)}>{card}</div>
        );
      })}
    </div>
  );
}

function ConnectedCreators({ creators }: { creators: ContentContextCreator[] }) {
  const rows = dedupePeople(creators).slice(0, 8);
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((creator) => {
        const label = creator.displayName || creator.handle || 'Creator';
        const chip = (
          <span className="watch-card watch-card-hover inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm text-zinc-200">
            {creator.avatarUrl ? <img src={creator.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : null}
            <span>{label}</span>
          </span>
        );
        return creator.profileUrl ? (
          <a key={personKey(creator)} href={creator.profileUrl} target="_blank" rel="noreferrer">
            {chip}
          </a>
        ) : (
          <span key={personKey(creator)}>{chip}</span>
        );
      })}
    </div>
  );
}

function HeroAttributionLineage({
  context,
  credits,
}: {
  context: ContentRelationshipContext | null;
  credits: CreditItem[];
}) {
  const creator = context?.creator || null;
  const source = dedupeWorks([...(context?.derivedFrom || []), ...(context?.builtFrom || [])])[0] || null;
  const people = filterDisplayPeople(
    dedupePeople([...(context?.peopleBehindThis || []), ...(context?.createdWith || [])]),
  ).slice(0, 4);
  const creditRows = credits.slice(0, 3).map((credit) => {
    const name = credit.displayName || credit.participantName || credit.handle || 'Contributor';
    const handle = credit.handle ? `@${String(credit.handle).replace(/^@+/, '')}` : '';
    const role = credit.role || 'credit';
    const share = credit.sharePercent ?? credit.percent;
    return `${name}${handle ? ` ${handle}` : ''} · ${role}${share != null ? ` · ${share}%` : ''}`;
  });

  if (!creator && !source && people.length === 0 && creditRows.length === 0) return null;

  return (
    <div className="watch-hero-lineage">
      <div className="watch-hero-lineage-head">
        <div>
          <div className="watch-hero-lineage-heading">Attribution & Lineage</div>
          <p>Where this work comes from and who is publicly connected to it.</p>
        </div>
        {creator?.profileUrl ? (
          <a className="watch-hero-lineage-open" href={creator.profileUrl} target="_blank" rel="noreferrer">
            Open Creator
          </a>
        ) : null}
      </div>
      <div className="watch-hero-lineage-grid">
        {creator ? (
          <a
            className="watch-hero-lineage-card watch-hero-lineage-person"
            href={creator.profileUrl || undefined}
            target={creator.profileUrl ? '_blank' : undefined}
            rel={creator.profileUrl ? 'noreferrer' : undefined}
          >
            <span>Created by</span>
            <div>
              {creator.avatarUrl ? <img src={creator.avatarUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
              <strong>{compactPersonLabel(creator)}</strong>
              {creator.handle ? <small>@{String(creator.handle).replace(/^@+/, '')}</small> : null}
            </div>
          </a>
        ) : null}
        {source ? (
          <div className="watch-hero-lineage-card">
            <span>{source.relationshipLabel || 'Built from'}</span>
            <strong>{source.title || 'Untitled work'}</strong>
            <small>{compactPersonLabel(source.creator)}</small>
          </div>
        ) : null}
        {people.length ? (
          <div className="watch-hero-lineage-card">
            <span>People involved</span>
            <div className="watch-hero-lineage-chips">
              {people.map((person) => {
                const chip = (
                  <small>
                    {person.avatarUrl ? <img src={person.avatarUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
                    <b>{compactPersonLabel(person)}</b>
                    {person.handle ? <em>@{String(person.handle).replace(/^@+/, '')}</em> : null}
                  </small>
                );
                return person.profileUrl ? (
                  <a key={personKey(person)} href={person.profileUrl} target="_blank" rel="noreferrer">
                    {chip}
                  </a>
                ) : (
                  <span key={personKey(person)}>{chip}</span>
                );
              })}
            </div>
          </div>
        ) : null}
        {creditRows.length ? (
          <div className="watch-hero-lineage-card">
            <span>Credits</span>
            <div className="watch-hero-lineage-list">
              {creditRows.map((row) => <small key={row}>{row}</small>)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FreebiesRelationshipPanel({ context, open, onToggle }: { context: ContentRelationshipContext | null; open: boolean; onToggle: () => void }) {
  if (!context) return null;
  const peopleBehindThis = filterDisplayPeople(
    dedupePeople(context.peopleBehindThis || []).filter((person) => !isUpstreamPerson(person)),
  ).slice(0, 6);
  const derivedFrom = dedupeWorks(context.derivedFrom || []).slice(0, 4);
  const connectedCreators = filterDisplayCreators(dedupePeople(context.connectedCreators || [])).slice(0, 6);
  const moreTheyWorkedOn = dedupeWorks(context.moreTheyWorkedOn || []).slice(0, 4);
  const excludedRelated = new Set([...derivedFrom, ...moreTheyWorkedOn].map(workKey));
  const relatedWorks = dedupeWorks(context.relatedWorks || [], excludedRelated).slice(0, 4);
  const hasAny = derivedFrom.length || connectedCreators.length || peopleBehindThis.length || moreTheyWorkedOn.length || relatedWorks.length;
  if (!hasAny) return null;

  return (
    <div
      className="watch-panel absolute inset-x-3 z-30 rounded-2xl border p-3 shadow-2xl backdrop-blur-md md:left-auto md:right-4 md:w-[420px]"
      style={{ bottom: 'calc(7.25rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="watch-accent-text block text-xs font-semibold uppercase tracking-[0.18em]">Explore this work</span>
          <span className="mt-1 block text-xs text-zinc-300">People and related works</span>
        </span>
        <span className="rounded-full border border-zinc-600 px-2 py-1 text-xs font-semibold text-zinc-200">
          {open ? 'Hide' : 'Open'}
        </span>
      </button>

      {open ? (
        <div className="mt-3 max-h-[48vh] space-y-4 overflow-y-auto pr-1">
          {derivedFrom.length ? (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Derived From</div>
              <WorksList works={derivedFrom} />
            </div>
          ) : null}

          {connectedCreators.length ? (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Connected Creators</div>
              <ConnectedCreators creators={connectedCreators} />
            </div>
          ) : null}

          {peopleBehindThis.length ? (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">People Behind This</div>
              <PeopleList people={peopleBehindThis} />
            </div>
          ) : null}

          {moreTheyWorkedOn.length ? (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">More They Worked On</div>
              <WorksList works={moreTheyWorkedOn} />
            </div>
          ) : null}

          {relatedWorks.length ? (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Related Works</div>
              <WorksList works={relatedWorks} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FreebiesWatch({
  contentId,
  topic,
  originHint,
  stateItem,
}: {
  contentId: string;
  topic: Topic;
  originHint: string | null;
  stateItem: DiscoverableItem | null;
}) {
  const { item: playerItem, playItem, setMobilePlayerOpen } = useStage1APlayer();
  const [items, setItems] = useState<DiscoverableItem[]>(stateItem && isRenderableDiscoveryItem(stateItem) ? [stateItem] : []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [relationshipContextState, setRelationshipContextState] = useState<{ key: string; context: ContentRelationshipContext | null } | null>(null);
  const [relationshipOpenKey, setRelationshipOpenKey] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const canonicalHydrationKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const feed = await loadFreebies(topic);
        if (!active) return;
        const map = new Map<string, DiscoverableItem>();
        for (const it of feed) map.set(`${it.publicOrigin}::${it.contentId}`, it);
        if (stateItem && isRenderableDiscoveryItem(stateItem)) map.set(`${stateItem.publicOrigin}::${stateItem.contentId}`, stateItem);
        let merged = [...map.values()];
        const selectedKey = stateItem
          ? `${stateItem.publicOrigin}::${stateItem.contentId}`
          : `${originHint || ''}::${contentId}`;
        const selectedIndex = merged.findIndex(
          (it) => `${it.publicOrigin}::${it.contentId}` === selectedKey || it.contentId === contentId,
        );
        if (selectedIndex > 0) {
          const selected = merged[selectedIndex];
          merged.splice(selectedIndex, 1);
          merged = [selected, ...merged];
        }
        setItems(merged.filter((it) => isRenderableDiscoveryItem(it)));
      } catch (e: unknown) {
        if (!active) return;
        setError(toErrorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [contentId, originHint, stateItem, topic]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!best) return;
        const idx = Number((best.target as HTMLElement).dataset.index || 0);
        setActiveIndex(idx);
      },
      { root, threshold: [0.5, 0.7, 0.9] },
    );
    sectionRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [items]);

  const visibleDiscoveryItem = items[activeIndex] || null;
  const visibleDiscoveryItemKey = visibleDiscoveryItem ? `${visibleDiscoveryItem.publicOrigin}::${visibleDiscoveryItem.contentId}` : null;

  useEffect(() => {
    let active = true;
    if (!visibleDiscoveryItem || !visibleDiscoveryItemKey) return;
    void fetchContentContext({ origin: visibleDiscoveryItem.publicOrigin, contentId: visibleDiscoveryItem.contentId })
      .then((context) => {
        if (!active) return;
        setRelationshipContextState({ key: visibleDiscoveryItemKey, context });
      })
      .catch(() => {
        if (!active) return;
        setRelationshipContextState({ key: visibleDiscoveryItemKey, context: null });
      });
    return () => {
      active = false;
    };
  }, [visibleDiscoveryItem, visibleDiscoveryItemKey]);
  const visibleDiscoveryRelationshipContext =
    visibleDiscoveryItemKey && relationshipContextState?.key === visibleDiscoveryItemKey ? relationshipContextState.context : null;

  useEffect(() => {
    let active = true;
    if (!visibleDiscoveryItem || !visibleDiscoveryItemKey || canonicalHydrationKeys.current.has(visibleDiscoveryItemKey)) return;
    canonicalHydrationKeys.current.add(visibleDiscoveryItemKey);
    void hydrateCanonicalOffer(visibleDiscoveryItem)
      .then((hydrated) => {
        if (!active || hydrated === visibleDiscoveryItem) return;
        setItems((current) =>
          current.map((row) => (`${row.publicOrigin}::${row.contentId}` === visibleDiscoveryItemKey ? hydrated : row)),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [visibleDiscoveryItem, visibleDiscoveryItemKey]);

  return (
    <main className="h-[100dvh] overflow-hidden bg-black text-white">
      <div className="fixed left-3 z-40" style={{ top: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <Link to="/" className="rounded-full bg-black/50 px-3 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-black/70">
          ← Back
        </Link>
      </div>

      {loading ? <div className="flex h-screen items-center justify-center text-zinc-300">Loading freebies…</div> : null}
      {error ? <div className="flex h-screen items-center justify-center p-4 text-red-300">{error}</div> : null}

      {!loading && !error ? (
        <div ref={scrollerRef} className="watch-reel-scroller h-[100dvh] snap-y snap-mandatory overflow-y-auto overscroll-y-contain">
          {items.map((it, index) => {
            const visualSrc = it.coverUrl || '';
            const themeVars = getCardThemeVars(it.profileTheme);
            const isActivePlaybackItem = playerItem?.contentId === it.contentId && playerItem.publicOrigin === it.publicOrigin;
            return (
              <section
                key={`${it.publicOrigin}:${it.contentId}:${index}`}
                className="watch-shell relative h-[100dvh] snap-start bg-black"
                style={themeVars}
                data-index={index}
                ref={(el) => {
                  sectionRefs.current[index] = el;
                }}
              >
                <div className="block h-full w-full bg-black text-left" aria-label={`Preview ${it.title || 'Free Drop'}`}>
                  {visualSrc ? (
                    <img src={visualSrc} alt={it.title || 'content'} className="h-full w-full object-cover md:object-contain" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-zinc-500">No media</div>
                  )}
                </div>

                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/90 via-black/55 to-transparent" />
                <div
                  className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 p-4"
                  style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
                >
                  <div className="min-w-0">
                    <h1 className="line-clamp-2 text-2xl font-bold">{it.title || 'Untitled'}</h1>
                    <p className="mt-1 text-sm text-zinc-200">@{it.creatorHandle || 'creator'} • {it.primaryTopic || 'topic'} • {it.contentType}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <button
                      type="button"
                      className={`rounded-xl px-4 py-2 text-sm font-bold ${isActivePlaybackItem ? 'bg-white/15 text-white' : 'watch-action-primary'}`}
                      onClick={() => {
                        setMobilePlayerOpen(true);
                        if (!isActivePlaybackItem) void playItem(it, { mediaAspect: 'portrait', queue: items });
                      }}
                    >
                      {isActivePlaybackItem ? 'Playing' : 'Play'}
                    </button>
                    {canOpenCreator(it) ? (
                      <a
                        href={it.buyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="watch-action-primary rounded-xl px-4 py-2 text-sm font-bold"
                      >
                        {ctaLabel(it)}
                      </a>
                    ) : null}
                  </div>
                </div>

                {index === activeIndex ? (
                  <FreebiesRelationshipPanel
                    context={visibleDiscoveryRelationshipContext}
                    open={relationshipOpenKey === visibleDiscoveryItemKey}
                    onToggle={() => {
                      setRelationshipOpenKey((current) => (current === visibleDiscoveryItemKey ? null : visibleDiscoveryItemKey));
                    }}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}

function StandardWatch({
  contentId,
  originHint,
  stateItem,
}: {
  contentId: string;
  originHint: string | null;
  stateItem: DiscoverableItem | null;
}) {
  const { item: activePlaybackItem, playItem, setDrawerContent } = useStage1APlayer();
  const navigate = useNavigate();
  const [item, setItem] = useState<DiscoverableItem | null>(stateItem && isRenderableDiscoveryItem(stateItem) ? stateItem : null);
  const [loading, setLoading] = useState(!(stateItem && isRenderableDiscoveryItem(stateItem)));
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditItem[]>([]);
  const [discoveryItems, setDiscoveryItems] = useState<DiscoverableItem[]>(stateItem && isRenderableDiscoveryItem(stateItem) ? [stateItem] : []);
  const [relationshipContextState, setRelationshipContextState] = useState<{ key: string; context: ContentRelationshipContext | null } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canonicalHydrationKeys = useRef<Set<string>>(new Set());
  const lastPlaybackSelectionKey = useRef(discoveryItemKey(activePlaybackItem));

  useEffect(() => {
    let active = true;
    if (!contentId) return undefined;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await loadById(contentId, originHint);
        if (!active) return;
        if (!res) {
          setError('Content not found in configured origins.');
          return;
        }
        if (!isRenderableDiscoveryItem(res)) {
          setError("This creator’s node is temporarily offline.");
          return;
        }
        setItem(res);
        setDiscoveryItems((current) => dedupeDiscoveryItems([res, ...current]));
      } catch (e: unknown) {
        if (!active) return;
        setError(toErrorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [contentId, originHint, stateItem]);

  useEffect(() => {
    let active = true;
    if (!item) return;
    const topic = normalizeTopic(item.primaryTopic || 'all');
    void loadDiscoveryItems(topic)
      .then((rows) => {
        if (!active) return;
        setDiscoveryItems(dedupeDiscoveryItems([item, ...rows]));
      })
      .catch(() => {
        if (!active) return;
        setDiscoveryItems((current) => dedupeDiscoveryItems([item, ...current]));
      });
    return () => {
      active = false;
    };
  }, [item]);

  useEffect(() => {
    let active = true;
    if (!item) return;
    void loadCredits(item)
      .then((rows) => {
        if (!active) return;
        setCredits(rows);
      })
      .catch(() => {
        if (!active) return;
        setCredits([]);
      });
    return () => {
      active = false;
    };
  }, [item]);

  useEffect(() => {
    let active = true;
    if (!item) return;
    const key = `${item.publicOrigin}::${item.contentId}`;
    void fetchContentContext({ origin: item.publicOrigin, contentId: item.contentId })
      .then((context) => {
        if (!active) return;
        setRelationshipContextState({ key, context });
      })
      .catch(() => {
        if (!active) return;
        setRelationshipContextState({ key, context: null });
      });
    return () => {
      active = false;
    };
  }, [item]);

  useEffect(() => {
    let active = true;
    if (!item) return;
    const key = `${item.publicOrigin}::${item.contentId}`;
    if (canonicalHydrationKeys.current.has(key)) return;
    canonicalHydrationKeys.current.add(key);
    void hydrateCanonicalOffer(item)
      .then((hydrated) => {
        if (!active || hydrated === item) return;
        setItem(hydrated);
        setDiscoveryItems((current) =>
          dedupeDiscoveryItems([hydrated, ...current.filter((row) => row.contentId !== hydrated.contentId || row.publicOrigin !== hydrated.publicOrigin)]),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [item]);

  const rehydrateCurrentItem = useCallback(async () => {
    if (!item) return;
    const hydrated = await hydrateCanonicalOffer(item);
    if (hydrated === item) return;
    setItem(hydrated);
    setDiscoveryItems((current) =>
      dedupeDiscoveryItems([hydrated, ...current.filter((row) => row.contentId !== hydrated.contentId || row.publicOrigin !== hydrated.publicOrigin)]),
    );
  }, [item]);

  useEffect(() => {
    if (!item) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void rehydrateCurrentItem().catch(() => undefined);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [item, rehydrateCurrentItem]);

  const explorationRails = useMemo(() => {
    if (!item) return [];
    return buildWatchDiscoveryRails(item, discoveryItems);
  }, [item, discoveryItems]);
  const activePlaybackSourceItem = activePlaybackItem?.sourceItem && isRenderableDiscoveryItem(activePlaybackItem.sourceItem)
    ? activePlaybackItem.sourceItem
    : null;
  const activePlaybackKey = discoveryItemKey(activePlaybackItem);
  const selectedContentKey = discoveryItemKey(item);
  const selectionIsDetachedFromPlayback = Boolean(item && activePlaybackItem && selectedContentKey !== activePlaybackKey);
  const returnToNowPlaying = useCallback(() => {
    if (!activePlaybackSourceItem) return;
    setItem(activePlaybackSourceItem);
    setDiscoveryItems((current) => dedupeDiscoveryItems([activePlaybackSourceItem, ...current]));
    navigate(watchHrefForItem(activePlaybackSourceItem), { state: { item: activePlaybackSourceItem } });
  }, [activePlaybackSourceItem, navigate]);
  const selectContentItem = useCallback((nextItem: DiscoverableItem) => {
    setItem(nextItem);
    setDiscoveryItems((current) => dedupeDiscoveryItems([nextItem, ...current]));
    navigate(watchHrefForItem(nextItem), { state: { item: nextItem } });
  }, [navigate]);
  const playContentItem = useCallback((nextItem: DiscoverableItem, queue: DiscoverableItem[]) => {
    const nextQueue = queue.length ? queue : [nextItem];
    selectContentItem(nextItem);
    void playItem(nextItem, { queue: nextQueue });
  }, [playItem, selectContentItem]);

  useEffect(() => {
    if (!activePlaybackSourceItem) return;
    const nextPlaybackKey = discoveryItemKey(activePlaybackSourceItem);
    if (!nextPlaybackKey || lastPlaybackSelectionKey.current === nextPlaybackKey) return;
    lastPlaybackSelectionKey.current = nextPlaybackKey;
    setItem(activePlaybackSourceItem);
    setDiscoveryItems((current) => dedupeDiscoveryItems([activePlaybackSourceItem, ...current]));
    navigate(watchHrefForItem(activePlaybackSourceItem), { state: { item: activePlaybackSourceItem } });
  }, [activePlaybackSourceItem, navigate]);
  const relationshipContext = item && relationshipContextState?.key === `${item.publicOrigin}::${item.contentId}`
    ? relationshipContextState.context
    : null;
  const themeVars = useMemo(() => getCardThemeVars(item?.profileTheme), [item?.profileTheme]);
  const creatorLabel = item?.creatorHandle ? item.creatorHandle.replace(/^@+/, '') : 'creator';
  const canRestoreAccess = Boolean(item && Number(item.priceSats || 0) > 0 && displayStateFromItem(item).state === 'preview');
  const buyWithReturnUrl = item ? buyUrlWithFanReturnUrl(item.buyUrl, item) : '#';
  const detailRows = useMemo(() => {
    if (!item) return [];
    const rows: WatchDetailRow[] = [];
    addWatchDetailRow(rows, 'Title', item.title || 'Untitled');
    addWatchDetailRow(rows, 'Creator', creatorLabel ? `@${creatorLabel}` : null);
    addWatchDetailRow(rows, 'Media', item.contentType);
    addWatchDetailRow(rows, 'State', priceLabel(item));
    addWatchDetailRow(rows, 'Type', item.contentType);
    addWatchDetailRow(rows, 'Topic', item.primaryTopic);
    if (Number(item.priceSats || 0) > 0) addWatchDetailRow(rows, 'Price', `${Number(item.priceSats || 0).toLocaleString()} sats`);
    addWatchDetailRow(rows, 'Access', item.accessMode);
    if (item.owned) addWatchDetailRow(rows, 'Ownership', 'owned');
    if (item.hasFullAccess) addWatchDetailRow(rows, 'Playback access', 'full access');
    if (item.isLocked) addWatchDetailRow(rows, 'Lock state', 'locked');
    if (Array.isArray(item.relationshipBadges)) item.relationshipBadges.forEach((badge) => addWatchDetailRow(rows, 'Signal', badge));

    if (relationshipContext) {
      rows.push({ label: 'Connections', value: '', kind: 'heading' });
      addWatchDetailRow(rows, 'Connected creators', relationshipContext.connectedCreators.length ? `${relationshipContext.connectedCreators.length} connected creators` : null);
      addWatchDetailRow(rows, 'Collaborators', credits.length ? `${credits.length} collaborators` : null);
      addWatchDetailRow(rows, 'Attribution', item.attributionLabel || item.relationshipSummary?.attributionLabel);
      addWatchDetailRow(rows, 'Lineage', item.lineageLabel || item.relationshipSummary?.lineageLabel);
      rows.push({ label: 'Attribution & lineage', value: '', kind: 'heading' });
      addWatchDetailRow(rows, 'Created by', relationshipContext.creator ? `${compactPersonLabel(relationshipContext.creator)}${relationshipContext.creator.handle ? ` @${String(relationshipContext.creator.handle).replace(/^@+/, '')}` : ''}` : null);
      filterDisplayPeople(dedupePeople([...(relationshipContext.peopleBehindThis || []), ...(relationshipContext.createdWith || [])]))
        .slice(0, 6)
        .forEach((person) => {
          const handle = person.handle ? ` @${String(person.handle).replace(/^@+/, '')}` : '';
          const role = person.relationshipLabel || person.role || '';
          addWatchDetailRow(rows, 'Person', `${compactPersonLabel(person)}${handle}${role ? ` · ${role}` : ''}`);
        });
    }

    rows.push({ label: 'Proofs & credits', value: '', kind: 'heading' });
    credits.slice(0, 8).forEach((credit) => {
      const name = credit.displayName || credit.participantName || credit.handle || 'Contributor';
      const handle = credit.handle ? ` @${String(credit.handle).replace(/^@+/, '')}` : '';
      const role = credit.role ? ` · ${credit.role}` : '';
      const percent = credit.sharePercent ?? credit.percent;
      addWatchDetailRow(rows, 'Credit', `${name}${handle}${role}${percent != null ? ` · ${percent}%` : ''}`);
    });
    addWatchDetailRow(rows, 'Payment state', item.paymentAccessProof?.paymentState);
    addWatchDetailRow(rows, 'Entitlement', item.paymentAccessProof?.entitlementState);
    addWatchDetailRow(rows, 'Payment receipt', item.paymentAccessProof?.paymentReceiptId);
    addWatchDetailRow(rows, 'Content ID', item.contentId);
    addWatchDetailRow(rows, 'Origin', item.publicOrigin);
    addWatchDetailRow(rows, 'Offer', item.offerUrl || `${item.publicOrigin}/buy/content/${encodeURIComponent(item.contentId)}/offer`);
    return rows;
  }, [credits, creatorLabel, item, relationshipContext]);
  const heroStyle = item?.coverUrl
    ? {
      ...themeVars,
      '--watch-cover-url': `url("${item.coverUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`,
    } as CSSProperties
    : themeVars;

  useEffect(() => {
    if (!item) return;
    const railItems = dedupeDiscoveryItems(explorationRails.flatMap((rail) => rail.items || []))
      .filter((row) => row.contentId !== item.contentId || row.publicOrigin !== item.publicOrigin);
    const creatorWorks = railItems
      .filter((row) => row.creatorHandle === item.creatorHandle)
      .slice(0, 12);
    const relatedWorks = railItems.slice(0, 12);
    const creditRows = credits.map((credit) => {
      const name = credit.displayName || credit.participantName || 'Contributor';
      const handle = credit.handle ? `@${String(credit.handle).replace(/^@+/, '')}` : '';
      const role = credit.role ? ` • ${credit.role}` : '';
      const pct = credit.sharePercent ?? credit.percent;
      return `${name}${handle ? ` (${handle})` : ''}${role}${pct != null ? ` • ${pct}%` : ''}`;
    });
    const connectionRows = relationshipContext
      ? [
        relationshipContext.creator ? 'Creator relationship context available.' : '',
        Array.isArray(relationshipContext.connectedCreators) && relationshipContext.connectedCreators.length ? `${relationshipContext.connectedCreators.length} connected creators` : '',
        Array.isArray(relationshipContext.relatedWorks) && relationshipContext.relatedWorks.length ? `${relationshipContext.relatedWorks.length} related works` : '',
        Array.isArray(relationshipContext.moreTheyWorkedOn) && relationshipContext.moreTheyWorkedOn.length ? `${relationshipContext.moreTheyWorkedOn.length} works they also worked on` : '',
      ].filter(Boolean)
      : [];
    const sourceWorks = relationshipContext ? dedupeWorks([...(relationshipContext.derivedFrom || []), ...(relationshipContext.builtFrom || [])]).slice(0, 3) : [];
    const peopleRows = relationshipContext
      ? filterDisplayPeople(dedupePeople([...(relationshipContext.peopleBehindThis || []), ...(relationshipContext.createdWith || [])]))
        .slice(0, 6)
        .map((person) => {
          const handle = person.handle ? ` @${String(person.handle).replace(/^@+/, '')}` : '';
          const role = person.relationshipLabel ? ` · ${person.relationshipLabel}` : '';
          return `Person: ${compactPersonLabel(person)}${handle}${role}`;
        })
      : [];
    const lineageRows = [
      relationshipContext?.creator ? `Created by: ${compactPersonLabel(relationshipContext.creator)}${relationshipContext.creator.handle ? ` @${String(relationshipContext.creator.handle).replace(/^@+/, '')}` : ''}` : '',
      ...sourceWorks.map((work) => `${work.relationshipLabel || 'Built from'}: ${work.title || 'Untitled work'}${work.creator ? ` · ${compactPersonLabel(work.creator)}` : ''}`),
      ...peopleRows,
      ...(creditRows.length ? ['Credits', ...creditRows] : []),
    ].filter(Boolean);
    setDrawerContent({
      moreFromCreator: creatorWorks.length ? creatorWorks : relatedWorks,
      moreTheyWorkedOn: relatedWorks,
      relatedWorks,
      connections: connectionRows,
      lineage: lineageRows.length ? lineageRows : connectionRows,
      credits: creditRows,
    });
    return () => setDrawerContent(null);
  }, [credits, explorationRails, item, relationshipContext, setDrawerContent]);

  return (
    <main className="watch-shell min-h-screen text-zinc-100" style={themeVars}>
      <div className="watch-page mx-auto max-w-7xl px-4 py-5 lg:px-6">
        <Link to="/" className="watch-back-link text-sm">← Back</Link>

        {loading ? <div className="watch-panel mt-4 rounded-xl border p-4">Loading…</div> : null}
        {error ? (
          <div className="watch-panel mt-4 rounded-xl border p-6 text-zinc-100">
            <div className="text-lg font-semibold">This creator’s node is temporarily offline.</div>
            <div className="mt-2 text-sm text-zinc-400">Try again shortly or return to discovery.</div>
            <Link
              to="/"
              className="watch-action-secondary mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-semibold"
            >
              Back to Discovery
            </Link>
          </div>
        ) : null}

        {item ? (
          <section className="watch-detail-space mt-4 space-y-5">
            {selectionIsDetachedFromPlayback ? (
              <div className="watch-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Now playing</div>
                  <div className="truncate text-sm font-bold text-zinc-100">{activePlaybackItem?.title || 'Current work'}</div>
                </div>
                {activePlaybackSourceItem ? (
                  <button type="button" className="watch-action-secondary rounded-xl px-3 py-2 text-sm font-bold" onClick={returnToNowPlaying}>
                    Return to Now Playing
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="watch-hero-card relative overflow-hidden rounded-[28px] border" style={heroStyle}>
              {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="watch-hero-backdrop" loading="eager" decoding="async" referrerPolicy="no-referrer" />
              ) : null}
              <div className="watch-hero-content relative z-10 grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.58fr)] lg:p-6">
                <div className="flex min-h-[300px] flex-col justify-end lg:min-h-[360px]">
                  <div className="max-w-3xl">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="watch-pill">{priceLabel(item)}</span>
                      {item.primaryTopic ? <span className="watch-topic">{item.primaryTopic}</span> : null}
                      {item.contentType ? <span className="watch-topic">{item.contentType}</span> : null}
                    </div>
                    <h1 className="watch-title text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">{item.title || 'Untitled'}</h1>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-lg font-semibold text-zinc-100">
                      <span>{creatorLabel}</span>
                      <span className="watch-verified-dot" aria-hidden="true">●</span>
                      <span className="watch-pill watch-pill-inline">{priceLabel(item)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" className="watch-pill watch-details-pill" onClick={() => setDetailsOpen(true)}>
                        Details
                      </button>
                    </div>
                    {item.description ? (
                      <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-zinc-100 sm:text-base">{item.description}</p>
                    ) : null}
                    <HeroAttributionLineage context={relationshipContext} credits={credits} />
                    {canRestoreAccess ? (
                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <a className="watch-action-primary rounded-xl px-4 py-2 text-sm font-bold" href={buyWithReturnUrl} target="_blank" rel="noreferrer">
                          {ctaLabel(item)}
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="watch-preview-stack self-start">
                  <button
                    type="button"
                    className="watch-preview-frame group overflow-hidden rounded-2xl border text-left"
                    onClick={() => void playItem(item, { queue: [item] })}
                    aria-label={`Play ${item.title || 'work'}`}
                  >
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover" loading="eager" decoding="async" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="flex aspect-video h-full w-full items-center justify-center bg-black text-xs uppercase tracking-[0.22em] text-zinc-500">
                        {item.contentType || 'Work'}
                      </div>
                    )}
                  </button>
                </div>
              </div>
              {detailsOpen ? (
                <div className="watch-details-modal" role="dialog" aria-modal="true" aria-label="Work details" onClick={() => setDetailsOpen(false)}>
                  <div className="watch-details-modal-panel" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="watch-hero-lineage-heading">Details</div>
                      <h2 className="mt-1 text-xl font-black text-white">{item.title || 'Untitled'}</h2>
                    </div>
                    <button type="button" className="watch-details-close" onClick={() => setDetailsOpen(false)} aria-label="Close details">×</button>
                  </div>
                  <div className="watch-details-list">
                    {detailRows.map((row, index) => row.kind === 'heading' ? (
                      <div key={`${row.label}:${index}`} className="watch-details-heading">{row.label}</div>
                    ) : (
                      <div key={`${row.label}:${row.value}:${index}`} className="watch-details-row">
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                      </div>
                    ))}
                  </div>
                  {item.description ? <p className="mt-4 text-sm leading-6 text-zinc-300">{item.description}</p> : null}
                  </div>
                </div>
              ) : null}

            </div>

            {explorationRails.length > 0 ? (
              <div className="watch-related-area space-y-6">
                {explorationRails.map((rail) => (
                  <ExplorationRail key={rail.key} rail={rail} onSelectItem={selectContentItem} onPlayItem={playContentItem} />
                ))}
              </div>
            ) : null}


          </section>
        ) : null}
      </div>
    </main>
  );
}

export function WatchPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const rawStateItem = (location.state as { item?: DiscoverableItem } | null)?.item || null;
  const contentId = String(params.contentId || '').trim();
  const originHint = normalizeCanonicalOrigin(search.get('origin')) || null;
  const stateItem = originHint && rawStateItem?.contentId === contentId
    ? {
      ...rawStateItem,
      publicOrigin: originHint,
      buyUrl: `${originHint}/buy/${encodeURIComponent(contentId)}`,
      offerUrl: `${originHint}/buy/content/${encodeURIComponent(contentId)}/offer`,
    }
    : rawStateItem;
  const mode = String(search.get('mode') || '').toLowerCase();
  const topic = normalizeTopic(search.get('topic') || 'all');
  const useMobileReels = useMobileReelsMode();

  if (mode === 'freebies' && useMobileReels) {
    return <FreebiesWatch contentId={contentId} originHint={originHint} topic={topic} stateItem={stateItem} />;
  }

  return <StandardWatch contentId={contentId} originHint={originHint} stateItem={stateItem} />;
}
