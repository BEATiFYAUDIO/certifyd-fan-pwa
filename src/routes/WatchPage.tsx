import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { FeedCard } from '../components/FeedCard';
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
    previewUrl: resolveAbsoluteUrl(offer.previewUrl, origin) || item.previewUrl,
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

function ExplorationRail({ rail }: { rail: DiscoveryRail }) {
  if (rail.items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-100">{rail.title}</h2>
        <p className="mt-1 text-xs text-zinc-400">{rail.subtitle}</p>
      </div>
      <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {rail.items.map((related) => (
          <FeedCard key={`${rail.key}:${related.publicOrigin}:${related.contentId}`} item={related} />
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

function excludePeople<T extends ContentContextPerson | ContentContextCreator>(rows: T[], exclude: Set<string>): T[] {
  return rows.filter((row) => !exclude.has(personKey(row)));
}

function RelationshipSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="watch-panel rounded-2xl border p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-100">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-zinc-400">{subtitle}</p> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
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

function WorksList({ works }: { works: ContentContextWork[] }) {
  const { playItem } = useStage1APlayer();
  if (!works.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {works.map((work) => {
        const creator = work.creator?.displayName || work.creator?.handle || 'Creator';
        const playableWork = workToDiscoverableItem(work);
        const card = (
          <div className="watch-card watch-card-hover overflow-hidden rounded-xl border text-left transition">
            <div className="aspect-video bg-zinc-950">
              {work.coverUrl ? (
                <img src={work.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex h-full items-center justify-center px-3 text-center text-xs uppercase tracking-[0.18em] text-zinc-500">
                  {work.contentType || 'Work'}
                </div>
              )}
            </div>
            <div className="space-y-1 p-3">
              <div className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100">{work.title || 'Untitled work'}</div>
              <div className="truncate text-xs text-zinc-400">{creator} • {work.contentType || 'work'}</div>
              <div className="watch-accent-text truncate text-xs font-semibold">{work.relationshipLabel || 'Related work'}</div>
            </div>
          </div>
        );
        return playableWork ? (
          <button
            key={workKey(work)}
            type="button"
            className="block w-full text-left"
            onClick={() => void playItem(playableWork)}
          >
            {card}
          </button>
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

function AttributionLineageSummary({
  creator,
  sourceWorks,
  upstreamCreators,
  contributors,
}: {
  creator: ContentContextCreator | null;
  sourceWorks: ContentContextWork[];
  upstreamCreators: ContentContextCreator[];
  contributors: ContentContextPerson[];
}) {
  const hasSource = sourceWorks.length > 0;
  const people = dedupePeople([...contributors, ...upstreamCreators]).slice(0, 5);
  if (!creator && !hasSource && people.length === 0) return null;

  const source = sourceWorks[0] || null;
  const creatorLabel = compactPersonLabel(creator);
  const sourceCreatorLabel = compactPersonLabel(source?.creator);

  return (
    <section className="watch-panel rounded-2xl border p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="watch-accent-text text-sm font-semibold uppercase tracking-[0.18em]">Attribution & lineage</h2>
          <p className="mt-1 text-sm text-zinc-400">Where this work comes from and who is publicly connected to it.</p>
        </div>
        {creator?.profileUrl ? (
          <a
            href={creator.profileUrl}
            target="_blank"
            rel="noreferrer"
            className="watch-action-secondary inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
          >
            Open creator
          </a>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {creator ? (
          <div className="watch-card rounded-xl border p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Created by</div>
            <div className="mt-2 flex min-w-0 items-center gap-3">
              {creator.avatarUrl ? (
                <img src={creator.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-zinc-700 object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              ) : null}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-100">{creatorLabel}</div>
                {creator.handle ? <div className="truncate text-xs text-zinc-500">@{String(creator.handle).replace(/^@+/, '')}</div> : null}
              </div>
            </div>
          </div>
        ) : null}

        {source ? (
          <a
            href={source.publicUrl || undefined}
            target={source.publicUrl ? '_blank' : undefined}
            rel={source.publicUrl ? 'noreferrer' : undefined}
            className="watch-card watch-card-hover rounded-xl border p-3 transition"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              {source.relationshipLabel || 'Built from'}
            </div>
            <div className="mt-2 flex min-w-0 gap-3">
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-950">
                {source.coverUrl ? (
                  <img src={source.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-wide text-zinc-500">{source.contentType || 'Work'}</div>
                )}
              </div>
              <div className="min-w-0">
                <div className="line-clamp-1 text-sm font-semibold text-zinc-100">{source.title || 'Untitled work'}</div>
                <div className="truncate text-xs text-zinc-500">{sourceCreatorLabel}</div>
              </div>
            </div>
          </a>
        ) : null}

        {people.length ? (
          <div className="watch-card rounded-xl border p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">People involved</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {people.map((person) => {
                const label = compactPersonLabel(person);
                const handle = person.handle ? `@${String(person.handle).replace(/^@+/, '')}` : '';
                const chip = (
                  <span className="watch-card inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs text-zinc-200">
                    {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
                    <span className="truncate">{label}</span>
                    {handle ? <span className="hidden text-zinc-500 sm:inline">{handle}</span> : null}
                  </span>
                );
                return person.profileUrl ? (
                  <a key={`summary:${personKey(person)}`} href={person.profileUrl} target="_blank" rel="noreferrer">
                    {chip}
                  </a>
                ) : (
                  <span key={`summary:${personKey(person)}`}>{chip}</span>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
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

function RelationshipContextSections({ context }: { context: ContentRelationshipContext | null }) {
  if (!context) return null;

  const allPeopleBehindThis = filterDisplayPeople(
    dedupePeople(context.peopleBehindThis || []).filter((person) => !isUpstreamPerson(person)),
  );
  const featuring = filterDisplayPeople(dedupePeople(context.featuring || [])).slice(0, 8);
  const allCreatedWith = filterDisplayPeople(
    dedupePeople(context.createdWith || []).filter((person) => !isUpstreamPerson(person) && person.relationshipLabel !== 'Creator'),
  );
  const derivedFrom = dedupeWorks(context.derivedFrom || []).slice(0, 12);
  const derivedFromKeys = new Set(derivedFrom.map(workKey));
  const builtFrom = dedupeWorks(context.builtFrom || [], derivedFromKeys).slice(0, 12);
  const worksThatBuiltOnThis = dedupeWorks(context.worksThatBuiltOnThis || []).slice(0, 12);
  const moreTheyWorkedOn = dedupeWorks(context.moreTheyWorkedOn || []).slice(0, 8);
  const excludedRelated = new Set([...derivedFrom, ...builtFrom, ...worksThatBuiltOnThis, ...moreTheyWorkedOn].map(workKey));
  const relatedWorks = dedupeWorks(context.relatedWorks || [], excludedRelated).slice(0, 8);
  const connectedCreators = filterDisplayCreators(dedupePeople(context.connectedCreators || [])).slice(0, 8);
  const summarySourceWorks = dedupeWorks([...derivedFrom, ...builtFrom]).slice(0, 3);
  const summaryPeople = dedupePeople([...allPeopleBehindThis, ...allCreatedWith]).slice(0, 6);
  const summaryPersonKeys = new Set(summaryPeople.map(personKey));
  const sourceWorkKeys = new Set(summarySourceWorks.map(workKey));
  const sourceCreatorKeys = new Set(
    summarySourceWorks
      .map((work) => work.creator)
      .filter((creator): creator is ContentContextCreator => Boolean(creator))
      .map(personKey),
  );
  const upstreamCreators = connectedCreators.filter((creator) => sourceCreatorKeys.has(personKey(creator))).slice(0, 4);
  const peopleBehindThis = excludePeople(allPeopleBehindThis, summaryPersonKeys).slice(0, 12);
  const peopleBehindKeys = new Set(allPeopleBehindThis.map(personKey));
  const createdWith = excludePeople(allCreatedWith, new Set([...summaryPersonKeys, ...peopleBehindThis.map(personKey)]))
    .filter((person) => !peopleBehindKeys.has(personKey(person)))
    .slice(0, 10);
  const repeatedConnectedCreators = connectedCreators
    .filter((creator) => !summaryPersonKeys.has(personKey(creator)) && !sourceCreatorKeys.has(personKey(creator)))
    .slice(0, 8);
  const derivedFromSecondary = derivedFrom.filter((work) => !sourceWorkKeys.has(workKey(work)));
  const builtFromSecondary = builtFrom.filter((work) => !sourceWorkKeys.has(workKey(work)));

  const hasAny =
    context.creator ||
    peopleBehindThis.length ||
    featuring.length ||
    createdWith.length ||
    builtFrom.length ||
    derivedFrom.length ||
    worksThatBuiltOnThis.length ||
    moreTheyWorkedOn.length ||
    relatedWorks.length ||
    connectedCreators.length;

  if (!hasAny) return null;

  return (
    <div className="watch-relationship-flow space-y-5">
      <div>
        <h2 className="text-base font-semibold text-zinc-100">Explore the connections</h2>
        <p className="mt-1 text-sm text-zinc-400">Creators, collaborators, and related works around this publication.</p>
      </div>

      {moreTheyWorkedOn.length ? (
        <RelationshipSection title="More They Worked On">
          <WorksList works={moreTheyWorkedOn} />
        </RelationshipSection>
      ) : null}

      <AttributionLineageSummary
        creator={context.creator}
        sourceWorks={summarySourceWorks}
        upstreamCreators={upstreamCreators}
        contributors={summaryPeople}
      />

      {derivedFromSecondary.length ? (
        <RelationshipSection title="Derived From" subtitle="Original or upstream works this publication is connected to.">
          <WorksList works={derivedFromSecondary} />
        </RelationshipSection>
      ) : null}

      {builtFromSecondary.length ? (
        <RelationshipSection title="Built From" subtitle="Additional source material connected to this work.">
          <WorksList works={builtFromSecondary} />
        </RelationshipSection>
      ) : null}

      {repeatedConnectedCreators.length ? (
        <RelationshipSection title="Connected Creators">
          <ConnectedCreators creators={repeatedConnectedCreators} />
        </RelationshipSection>
      ) : null}

      {worksThatBuiltOnThis.length ? (
        <RelationshipSection title="Works That Built On This">
          <WorksList works={worksThatBuiltOnThis} />
        </RelationshipSection>
      ) : null}

      {relatedWorks.length ? (
        <RelationshipSection title="Related Works">
          <WorksList works={relatedWorks} />
        </RelationshipSection>
      ) : null}

      {peopleBehindThis.length ? (
        <RelationshipSection title="People Behind This">
          <PeopleList people={peopleBehindThis} />
        </RelationshipSection>
      ) : null}

      {featuring.length ? (
        <RelationshipSection title="Featuring">
          <PeopleList people={featuring} />
        </RelationshipSection>
      ) : null}

      {createdWith.length ? (
        <RelationshipSection title="Created With">
          <PeopleList people={createdWith} />
        </RelationshipSection>
      ) : null}
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
  const { item: playerItem, playItem, setFreeDropQueue, setMobilePlayerOpen, setDrawerContent } = useStage1APlayer();
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

  const activeItem = items[activeIndex] || null;
  const activeItemKey = activeItem ? `${activeItem.publicOrigin}::${activeItem.contentId}` : null;

  useEffect(() => {
    let active = true;
    if (!activeItem || !activeItemKey) return;
    void fetchContentContext({ origin: activeItem.publicOrigin, contentId: activeItem.contentId })
      .then((context) => {
        if (!active) return;
        setRelationshipContextState({ key: activeItemKey, context });
      })
      .catch(() => {
        if (!active) return;
        setRelationshipContextState({ key: activeItemKey, context: null });
      });
    return () => {
      active = false;
    };
  }, [activeItem, activeItemKey]);

	  const activeRelationshipContext =
	    activeItemKey && relationshipContextState?.key === activeItemKey ? relationshipContextState.context : null;

  useEffect(() => {
    setFreeDropQueue(items);
  }, [items, setFreeDropQueue]);

  useEffect(() => {
    if (!activeItem) return;
    setDrawerContent({
      moreFromCreator: items.filter((row) => row.creatorHandle === activeItem.creatorHandle && row.contentId !== activeItem.contentId).slice(0, 12),
      moreTheyWorkedOn: [],
      relatedWorks: items.filter((row) => row.contentId !== activeItem.contentId).slice(0, 12),
      connections: activeRelationshipContext ? ['Connected relationship data is available for this work.'] : [],
      lineage: activeRelationshipContext ? ['Attribution and lineage context is available for this work.'] : [],
    });
    return () => setDrawerContent(null);
  }, [activeItem, activeRelationshipContext, items, setDrawerContent]);

  useEffect(() => {
    if (!activeItem || !activeItemKey) return;
    if (playerItem?.contentId === activeItem.contentId && playerItem.publicOrigin === activeItem.publicOrigin) return;
    void playItem(activeItem, { muted: true, mediaAspect: 'portrait' });
  }, [activeItem, activeItemKey, playItem, playerItem]);

  useEffect(() => {
    let active = true;
    if (!activeItem || !activeItemKey || canonicalHydrationKeys.current.has(activeItemKey)) return;
    canonicalHydrationKeys.current.add(activeItemKey);
    void hydrateCanonicalOffer(activeItem)
      .then((hydrated) => {
        if (!active || hydrated === activeItem) return;
        setItems((current) =>
          current.map((row) => (`${row.publicOrigin}::${row.contentId}` === activeItemKey ? hydrated : row)),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeItem, activeItemKey]);

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
        <div ref={scrollerRef} className="h-[100dvh] snap-y snap-mandatory overflow-y-auto overscroll-y-contain">
          {items.map((it, index) => {
            const visualSrc = it.coverUrl || '';
            const themeVars = getCardThemeVars(it.profileTheme);
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
	                <button
	                  type="button"
	                  className="block h-full w-full bg-black text-left"
		                  onClick={() => {
                        setMobilePlayerOpen(true);
                        void playItem(it, { mediaAspect: 'portrait' });
                      }}
                  aria-label={`Play ${it.title || 'Free Drop'}`}
                >
                  {visualSrc ? (
                    <img src={visualSrc} alt={it.title || 'content'} className="h-full w-full object-cover md:object-contain" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-zinc-500">No media</div>
                  )}
                </button>

                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/90 via-black/55 to-transparent" />
                <div
                  className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 p-4"
                  style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
                >
                  <div className="min-w-0">
                    <h1 className="line-clamp-2 text-2xl font-bold">{it.title || 'Untitled'}</h1>
                    <p className="mt-1 text-sm text-zinc-200">@{it.creatorHandle || 'creator'} • {it.primaryTopic || 'topic'} • {it.contentType}</p>
                  </div>
                  {canOpenCreator(it) ? (
                    <a
                      href={it.buyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="watch-action-primary shrink-0 rounded-xl px-4 py-2 text-sm font-bold"
                    >
                      {ctaLabel(it)}
                    </a>
                  ) : null}
                </div>

                {index === activeIndex ? (
                  <FreebiesRelationshipPanel
                    context={activeRelationshipContext}
                    open={relationshipOpenKey === activeItemKey}
                    onToggle={() => {
                      setRelationshipOpenKey((current) => (current === activeItemKey ? null : activeItemKey));
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
  const { item: playerItem, playItem, setDrawerContent } = useStage1APlayer();
  const [item, setItem] = useState<DiscoverableItem | null>(stateItem && isRenderableDiscoveryItem(stateItem) ? stateItem : null);
  const [loading, setLoading] = useState(!(stateItem && isRenderableDiscoveryItem(stateItem)));
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditItem[]>([]);
  const [discoveryItems, setDiscoveryItems] = useState<DiscoverableItem[]>(stateItem && isRenderableDiscoveryItem(stateItem) ? [stateItem] : []);
  const [relationshipContextState, setRelationshipContextState] = useState<{ key: string; context: ContentRelationshipContext | null } | null>(null);
  const canonicalHydrationKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    if (!contentId || item) return;

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
  }, [contentId, item, originHint]);

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
    if (playerItem?.contentId === hydrated.contentId && playerItem.publicOrigin === hydrated.publicOrigin) {
      void playItem(hydrated, { openPlayer: false });
    }
  }, [item, playItem, playerItem]);

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
  const relationshipContext = item && relationshipContextState?.key === `${item.publicOrigin}::${item.contentId}`
    ? relationshipContextState.context
    : null;
  const themeVars = useMemo(() => getCardThemeVars(item?.profileTheme), [item?.profileTheme]);
  const creatorLabel = item?.creatorHandle ? item.creatorHandle.replace(/^@+/, '') : 'creator';
  const canRestoreAccess = Boolean(item && Number(item.priceSats || 0) > 0 && displayStateFromItem(item).state === 'preview');
  const buyWithReturnUrl = item ? buyUrlWithFanReturnUrl(item.buyUrl, item) : '#';
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

                <div className="watch-preview-stack self-end">
                  <button
                    type="button"
                    className="watch-preview-frame group overflow-hidden rounded-2xl border text-left"
                    onClick={() => void playItem(item)}
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

            </div>

            {explorationRails.length > 0 ? (
              <div className="watch-related-area space-y-6">
                {explorationRails.map((rail) => (
                  <ExplorationRail key={rail.key} rail={rail} />
                ))}
              </div>
            ) : null}

            <RelationshipContextSections context={relationshipContext} />

            <section className="watch-context-block">
              <div>
                <h2 className="watch-section-title">Credits</h2>
                <div className="mt-3 space-y-1">
                  {credits.length ? credits.map((credit, idx) => {
                    const name = credit.displayName || credit.participantName || 'Contributor';
                    const handle = credit.handle ? `@${String(credit.handle).replace(/^@+/, '')}` : null;
                    const role = credit.role || null;
                    const pct = credit.sharePercent ?? credit.percent ?? null;
                    return (
                      <p key={`${name}-${idx}`} className="text-sm text-zinc-300">
                        {name}{handle ? ` (${handle})` : ''}{role ? ` • ${role}` : ''}{pct != null ? ` • ${pct}%` : ''}
                      </p>
                    );
                  }) : (
                    <p className="text-sm text-zinc-400">Credits and contributor details appear here when the creator publishes them.</p>
                  )}
                </div>
              </div>
            </section>

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
