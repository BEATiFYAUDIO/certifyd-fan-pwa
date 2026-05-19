import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FeedCard } from '../components/FeedCard';
import { ShortsCard } from '../components/ShortsCard';
import { TopicRail } from '../components/TopicRail';
import { fetchDiscoverablePage } from '../lib/api';
import { loadConfiguredOrigins } from '../lib/config';
import type { DiscoverableItem, OriginFeedState, Topic } from '../lib/types';
import { isLockedOrPremium, isRenderableDiscoveryItem } from '../lib/discoveryGuard';
import {
  buildHomeDiscoveryViewModel,
  dedupeDiscoveryItems,
  publicRelationshipScore,
  publicSupportScore,
  searchableText,
  sortNewestFirst,
  type CreatorSpotlight,
  type DiscoveryRail,
} from '../lib/discoveryViewModel';

const INITIAL_PAGE_LIMIT = 8;
const NEXT_PAGE_LIMIT = 18;
const ORIGIN_TIMEOUT_MS = 3000;
const RETRY_BASE_MS = 4000;
const RETRY_MAX_MS = 60000;
const ORIGIN_SOFT_DISABLE_AFTER_FAILS = 3;
const ORIGIN_SOFT_DISABLE_MS = 5 * 60 * 1000;
const MAX_ORIGINS_PER_PASS = 6;

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function sortStableRandom(items: DiscoverableItem[], seed: string): DiscoverableItem[] {
  return [...items].sort((a, b) => {
    const ak = `${a.publicOrigin}::${a.contentId}`;
    const bk = `${b.publicOrigin}::${b.contentId}`;
    const ah = hashString(`${seed}:${ak}`);
    const bh = hashString(`${seed}:${bk}`);
    if (ah !== bh) return ah - bh;
    return ak.localeCompare(bk);
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Failed to load feed';
}

function RailHeader({ title, subtitle, badge }: { title: string; subtitle: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-1">
      <div>
        <h2 className="section-title text-sm font-semibold uppercase tracking-[0.2em] text-zinc-100">{title}</h2>
        <p className="section-subtitle mt-1 text-xs text-zinc-400">{subtitle}</p>
      </div>
      {badge ? (
        <span className="shrink-0 rounded-full border border-amber-300/35 bg-amber-300/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function itemKey(item: DiscoverableItem): string {
  return `${item.publicOrigin}::${item.contentId}`;
}

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return String(value);
}

function ContentRail({ rail }: { rail: DiscoveryRail }) {
  if (rail.items.length === 0) return null;
  return (
    <section className="space-y-3">
      <RailHeader title={rail.title} subtitle={rail.subtitle} />
      <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rail.items.map((item) => (
          <FeedCard key={`${rail.key}:${item.publicOrigin}:${item.contentId}`} item={item} />
        ))}
      </div>
    </section>
  );
}

function CreatorSpotlightCard({ creator }: { creator: CreatorSpotlight }) {
  const fallbackLogo = `${import.meta.env.BASE_URL}header-logo.png`;
  const topicText = [...creator.topics, ...creator.types].slice(0, 3).join(' / ') || 'published works';
  const displayName = creator.handle.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <article className="min-w-[310px] max-w-[380px] shrink-0 snap-start rounded-2xl border border-zinc-800/90 bg-zinc-900/70 p-4 shadow-xl shadow-black/20">
      <div className="flex gap-4">
        <a
          href={creator.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-zinc-800 transition hover:border-amber-300/60"
        >
          {creator.avatarUrl ? (
            <img src={creator.avatarUrl} alt={`@${creator.handle}`} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <img src={fallbackLogo} alt="" className="h-full w-full object-contain p-2 opacity-70" loading="lazy" />
          )}
        </a>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-zinc-100">{displayName}</div>
          <div className="mt-0.5 truncate text-xs text-zinc-400">@{creator.handle}</div>
          <div className="mt-1 text-xs text-zinc-400">
            {creator.itemCount} {creator.itemCount === 1 ? 'publication' : 'publications'} · {topicText}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {creator.supportScore > 0 ? (
              <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
                Supported {formatCount(creator.supportScore)}
              </span>
            ) : null}
            {creator.relationshipScore > 0 ? (
              <span className="rounded-full border border-zinc-600 bg-black/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
                {formatCount(creator.relationshipScore)} connections
              </span>
            ) : null}
            {creator.itemCount > 1 ? (
              <span className="rounded-full border border-zinc-700 bg-black/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Active catalog
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {creator.works.slice(0, 3).map((work) => (
          <Link
            key={itemKey(work)}
            to={`/watch/${encodeURIComponent(work.contentId)}?origin=${encodeURIComponent(work.publicOrigin)}`}
            state={{ item: work }}
            className="group flex items-center gap-3 rounded-xl border border-zinc-800 bg-black/20 p-2 transition hover:border-amber-300/40"
          >
            <div className="h-11 w-14 shrink-0 overflow-hidden rounded-lg bg-zinc-950">
              {work.coverUrl ? (
                <img src={work.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-wide text-zinc-500">
                  {work.contentType || 'Work'}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="line-clamp-1 text-sm font-semibold text-zinc-100 group-hover:text-amber-100">{work.title || 'Untitled'}</div>
              <div className="mt-0.5 truncate text-xs text-zinc-500">{work.primaryTopic || 'publication'} · {work.contentType || 'work'}</div>
            </div>
          </Link>
        ))}
      </div>

      <a
        href={creator.profileUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex text-[11px] font-semibold uppercase tracking-wide text-amber-200/85 hover:text-amber-100"
      >
        Explore creator →
      </a>
    </article>
  );
}

function HeroConnectionCard({ item }: { item: DiscoverableItem }) {
  const creator = String(item.creatorHandle || 'creator').replace(/^@+/, '');
  const supportScore = publicSupportScore(item);
  const relationshipScore = publicRelationshipScore(item);
  return (
    <Link
      to={`/watch/${encodeURIComponent(item.contentId)}?origin=${encodeURIComponent(item.publicOrigin)}`}
      state={{ item }}
      className="group overflow-hidden rounded-2xl border border-zinc-800/90 bg-black/35 transition hover:-translate-y-0.5 hover:border-amber-300/45"
    >
      <div className="aspect-video bg-zinc-950">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt="" className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.02]" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-xs uppercase tracking-[0.18em] text-zinc-500">
            {item.contentType || 'Work'}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100">{item.title || 'Untitled'}</div>
        <div className="mt-1 text-xs text-zinc-400">by @{creator}</div>
        {supportScore > 0 || relationshipScore > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {supportScore > 0 ? (
              <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
                Supported {formatCount(supportScore)}
              </span>
            ) : null}
            {relationshipScore > 0 ? (
              <span className="rounded-full border border-zinc-700 bg-black/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
                {formatCount(relationshipScore)} links
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-amber-200/85">Explore connections →</div>
      </div>
    </Link>
  );
}

function HeroActivityPanel({
  activeCreators,
  ecosystemCount,
  supportedWorks,
  supportSignals,
  collaborativeWorks,
  recentWorks,
  premiumWorks,
}: {
  activeCreators: number;
  ecosystemCount: number;
  supportedWorks: number;
  supportSignals: number;
  collaborativeWorks: number;
  recentWorks: number;
  premiumWorks: number;
}) {
  const stats = [
    supportSignals > 0
      ? { label: 'public support signals', value: formatCount(supportSignals), tone: 'gold' }
      : null,
    supportedWorks > 0
      ? { label: 'supported works', value: formatCount(supportedWorks), tone: 'gold' }
      : null,
    collaborativeWorks > 0
      ? { label: 'connected works', value: formatCount(collaborativeWorks), tone: 'neutral' }
      : null,
    { label: 'active creators', value: formatCount(activeCreators), tone: 'neutral' },
    { label: 'creator ecosystems', value: formatCount(ecosystemCount), tone: 'neutral' },
    { label: 'recent works', value: formatCount(recentWorks), tone: 'neutral' },
    premiumWorks > 0
      ? { label: 'unlockable works', value: formatCount(premiumWorks), tone: 'neutral' }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string; tone: 'gold' | 'neutral' }>;

  return (
    <div className="rounded-2xl border border-zinc-800/90 bg-black/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200/80">Live discovery pulse</p>
          <p className="mt-1 text-xs text-zinc-400">Public activity signals from connected creator origins.</p>
        </div>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.55)]" aria-hidden="true" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {stats.slice(0, 6).map((stat) => (
          <div
            key={stat.label}
            className={`rounded-xl border px-3 py-2 ${
              stat.tone === 'gold'
                ? 'border-amber-300/25 bg-amber-300/10'
                : 'border-zinc-800 bg-zinc-950/60'
            }`}
          >
            <div className={stat.tone === 'gold' ? 'text-lg font-semibold text-amber-100' : 'text-lg font-semibold text-zinc-100'}>
              {stat.value}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomePage() {
  const logoSrc = `${import.meta.env.BASE_URL}header-logo.png`;
  const [origins, setOrigins] = useState<string[]>([]);
  const [originsLoaded, setOriginsLoaded] = useState(false);
  const [topic, setTopic] = useState<Topic>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DiscoverableItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeds, setFeeds] = useState<OriginFeedState[]>([]);
  const randomSeed = useMemo(
    () => `all:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
    []
  );
  const requestIdRef = useRef(0);
  const loadingRef = useRef(false);
  const originPassOffsetRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const sentinelWasVisibleRef = useRef(false);
  const retryMetaRef = useRef<Map<string, { failCount: number; retryAfter: number; disabledUntil: number }>>(new Map());
  const cacheKey = useMemo(
    () => `fanfeed:v1:${topic}:${origins.slice().sort().join(',') || 'none'}`,
    [origins, topic]
  );

  useEffect(() => {
    let mounted = true;
    void loadConfiguredOrigins()
      .then((nextOrigins) => {
        if (!mounted) return;
        setOrigins(nextOrigins);
        setFeeds(nextOrigins.map((origin) => ({ origin, cursor: null, done: false, loading: false, error: null })));
      })
      .finally(() => {
        if (mounted) setOriginsLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  function onTopicChange(next: Topic) {
    setTopic(next);
  }

  useEffect(() => {
    if (origins.length === 0) return;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { items?: DiscoverableItem[] };
      if (!Array.isArray(parsed?.items)) return;
      const warm = sortNewestFirst(dedupeDiscoveryItems(parsed.items));
      if (warm.length > 0) setItems(warm);
    } catch {
      // ignore cache parse failures
    }
  }, [cacheKey, origins.length]);

  const loadMore = useCallback(async (currentFeeds: OriginFeedState[], currentItems: DiscoverableItem[]) => {
    if (origins.length === 0 || loadingRef.current) return;
    const now = Date.now();
    const nextFeeds = currentFeeds.map((f) => ({ ...f }));
    const updates: DiscoverableItem[] = [];

    const pendingIndexes: number[] = [];
    for (let i = 0; i < nextFeeds.length; i += 1) {
      const feed = nextFeeds[i];
      if (feed.done || feed.loading) continue;
      const retryMeta = retryMetaRef.current.get(feed.origin);
      if (retryMeta && (retryMeta.retryAfter > now || retryMeta.disabledUntil > now)) continue;
      feed.loading = true;
      pendingIndexes.push(i);
    }
    if (pendingIndexes.length === 0) return;
    const isInitialLoadPass = currentItems.length === 0;
    const startOffset = pendingIndexes.length > 0 ? originPassOffsetRef.current % pendingIndexes.length : 0;
    const rotated = pendingIndexes.slice(startOffset).concat(pendingIndexes.slice(0, startOffset));
    const selectedIndexes = isInitialLoadPass ? rotated : rotated.slice(0, MAX_ORIGINS_PER_PASS);
    originPassOffsetRef.current += 1;

    const requestId = ++requestIdRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    await Promise.all(
      selectedIndexes.map(async (index) => {
        const feed = nextFeeds[index];
        try {
          const data = await fetchDiscoverablePage({
            origin: feed.origin,
            topic,
            limit: currentItems.length === 0 ? INITIAL_PAGE_LIMIT : NEXT_PAGE_LIMIT,
            cursor: feed.cursor,
            timeoutMs: ORIGIN_TIMEOUT_MS,
          });
          updates.push(...data.items);
          feed.cursor = data.cursor;
          feed.done = !data.cursor || data.items.length === 0;
          feed.error = null;
          retryMetaRef.current.delete(feed.origin);
        } catch (e: unknown) {
          feed.error = toErrorMessage(e);
          const prev = retryMetaRef.current.get(feed.origin) || { failCount: 0, retryAfter: 0, disabledUntil: 0 };
          const failCount = prev.failCount + 1;
          const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failCount - 1));
          const disabledUntil = failCount >= ORIGIN_SOFT_DISABLE_AFTER_FAILS ? Date.now() + ORIGIN_SOFT_DISABLE_MS : 0;
          retryMetaRef.current.set(feed.origin, {
            failCount,
            retryAfter: Date.now() + backoff,
            disabledUntil,
          });
        } finally {
          feed.loading = false;
        }
      })
    );

    if (requestId !== requestIdRef.current) {
      loadingRef.current = false;
      setLoading(false);
      return;
    }
    setFeeds(nextFeeds);
    const nextItems = sortNewestFirst(dedupeDiscoveryItems([...updates, ...currentItems]));
    setItems(nextItems);
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ items: nextItems }));
    } catch {
      // ignore storage quota/unavailable errors
    }

    const errors = nextFeeds.map((f) => f.error).filter(Boolean) as string[];
    if (errors.length && updates.length === 0 && currentItems.length === 0) {
      setError(errors[0]);
    }
    setLoading(false);
    loadingRef.current = false;
  }, [cacheKey, origins.length, topic]);

  useEffect(() => {
    if (origins.length === 0) return;
    const initialFeeds = origins.map((origin) => ({ origin, cursor: null, done: false, loading: false, error: null }));
    setFeeds(initialFeeds);
    setItems([]);
    setError(null);
    void loadMore(initialFeeds, []);
  }, [loadMore, origins, topic]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || loading) return;
      if (items.length === 0 && feeds.length > 0) {
        void loadMore(feeds, items);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [feeds, items, loadMore, loading]);

  const allDone = feeds.length > 0 && feeds.every((f) => f.done);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || origins.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) {
          sentinelWasVisibleRef.current = false;
          return;
        }
        if (sentinelWasVisibleRef.current) return;
        sentinelWasVisibleRef.current = true;
        if (loadingRef.current || loading || allDone) return;
        void loadMore(feeds, items);
      },
      { root: null, rootMargin: '320px 0px', threshold: 0.01 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [allDone, feeds, items, loadMore, loading, origins.length]);

  const filtered: DiscoverableItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const searched = !q
      ? items.filter((it) => isRenderableDiscoveryItem(it))
      : items.filter((it) => {
      if (!isRenderableDiscoveryItem(it)) return false;
      return searchableText(it).includes(q);
    });
    const freeLaneBase = searched.filter((it) => !isLockedOrPremium(it) && (it.accessMode === 'unlocked' || it.accessMode === 'owned'));
    const lockedLaneBase = searched.filter((it) => isLockedOrPremium(it));
    const freeLane = topic === 'all' ? sortStableRandom(freeLaneBase, `${randomSeed}:free`) : freeLaneBase;
    const lockedLane = topic === 'all' ? sortStableRandom(lockedLaneBase, `${randomSeed}:locked`) : lockedLaneBase;
    return [...freeLane, ...lockedLane];
  }, [items, query, topic, randomSeed]);
  const discoveryView = useMemo(() => buildHomeDiscoveryViewModel(filtered), [filtered]);
  const freeItems = useMemo(
    () => (topic === 'all' ? sortStableRandom(discoveryView.freeItems, `${randomSeed}:free:view`) : discoveryView.freeItems),
    [discoveryView.freeItems, topic, randomSeed]
  );
  const lockedItems = useMemo(
    () => (topic === 'all' ? sortStableRandom(discoveryView.lockedItems, `${randomSeed}:locked:view`) : discoveryView.lockedItems),
    [discoveryView.lockedItems, topic, randomSeed]
  );
  const secondaryRails = useMemo(() => {
    const primaryKeys = new Set<string>();
    [
      ...freeItems.slice(0, 8),
      ...lockedItems.slice(0, 8),
      ...(discoveryView.supportedRail?.items || []),
      ...(discoveryView.recentRail?.items || []),
    ]
      .forEach((item) => primaryKeys.add(itemKey(item)));

    const rails: DiscoveryRail[] = [];
    rails.push(...discoveryView.dynamicRails);
    const seen = new Set<string>();
    return rails.map((rail) => ({
      ...rail,
      items: rail.items.filter((item) => !primaryKeys.has(itemKey(item))),
    })).filter((rail) => {
      if (rail.items.length < 3) return false;
      const signature = rail.items.map((item) => `${item.publicOrigin}:${item.contentId}`).join('|');
      if (!signature || seen.has(signature)) return false;
      seen.add(signature);
      return true;
    }).slice(0, 3);
  }, [discoveryView, freeItems, lockedItems]);
  const creatorCount = useMemo(() => {
    const keys = new Set(filtered.map((item) => `${item.publicOrigin}::${String(item.creatorHandle || '').replace(/^@+/, '').toLowerCase()}`));
    return keys.size;
  }, [filtered]);
  const supportSignals = useMemo(
    () => filtered.reduce((sum, item) => sum + publicSupportScore(item), 0),
    [filtered]
  );
  const supportedWorks = useMemo(
    () => filtered.filter((item) => publicSupportScore(item) > 0).length,
    [filtered]
  );
  const collaborativeWorks = useMemo(
    () => filtered.filter((item) => publicRelationshipScore(item) > 0).length,
    [filtered]
  );
  const ecosystemCount = useMemo(
    () => discoveryView.creatorSpotlights.filter((creator) => creator.itemCount > 1 || creator.supportScore > 0 || creator.relationshipScore > 0).length,
    [discoveryView.creatorSpotlights]
  );
  const heroWorks = useMemo(() => {
    const supported = discoveryView.supportedRail?.items || [];
    const fromCreators = discoveryView.creatorSpotlights.flatMap((creator) => creator.works);
    return dedupeDiscoveryItems([...supported, ...fromCreators, ...filtered]).slice(0, 3);
  }, [discoveryView.creatorSpotlights, discoveryView.supportedRail, filtered]);

  return (
    <main className="app-shell min-h-screen text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-800/70 bg-zinc-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
          <div className="relative shrink-0">
            <img
              src={logoSrc}
              alt="Certifyd Discovery"
              className="h-24 w-auto object-contain sm:h-28"
              style={{ filter: "brightness(1.14) saturate(1.16) sepia(0.14)" }}
              loading="eager"
            />
            <a
              href="https://certifyd.me"
              target="_blank"
              rel="noreferrer"
              className="absolute left-[84px] top-[61px] text-[10px] font-medium uppercase tracking-[0.14em] text-amber-200/85 transition hover:text-amber-100 hover:underline hover:decoration-amber-200/60 hover:underline-offset-2 sm:left-[98px] sm:top-[72px]"
            >
              Mission
            </a>
          </div>
          <div className="ml-auto w-full max-w-xl">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search creators, drops, music, stories..."
              className="search-input w-full rounded-full border border-zinc-700/80 bg-zinc-900/80 px-5 py-2.5 text-sm outline-none placeholder:text-zinc-500 focus:border-amber-300/70"
            />
          </div>
        </div>
        <TopicRail active={topic} onChange={onTopicChange} />
      </header>

      <section className="mx-auto max-w-7xl space-y-3 px-4 py-4">
        {originsLoaded && origins.length === 0 ? (
          <div className="rounded-xl border border-amber-700 bg-amber-950/30 p-4 text-sm text-amber-200">
            No valid origins found. Add <code>public/origins.json</code> and/or <code>VITE_CERTIFYD_ORIGINS</code>.
          </div>
        ) : null}

        {error ? <div className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-200">{error}</div> : null}

        {!error && items.length === 0 && loading ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-300">Loading feed…</div>
        ) : null}

        {!loading && filtered.length === 0 && !error ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-300">
            No discoverable content yet.
          </div>
        ) : null}

        {filtered.length > 0 ? (
          <section className="overflow-hidden rounded-3xl border border-zinc-800/90 bg-[radial-gradient(circle_at_12%_10%,rgba(210,166,83,0.2),transparent_32%),radial-gradient(circle_at_84%_18%,rgba(56,49,38,0.4),transparent_34%),linear-gradient(135deg,rgba(24,24,27,0.94),rgba(5,5,6,0.98))] p-4 shadow-2xl shadow-black/40 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(480px,1.1fr)] lg:items-stretch">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200/80">Live creator ecosystems</p>
                <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
                  Follow what creators are publishing, supporting, and building around.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
                  Start with a work, then move through the people, creator homes, topics, and public support signals around it.
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-xs text-zinc-300">
                  <span className="rounded-full border border-zinc-700/80 bg-black/25 px-3 py-1.5">{filtered.length} works</span>
                  <span className="rounded-full border border-zinc-700/80 bg-black/25 px-3 py-1.5">{creatorCount} creators</span>
                  {supportSignals > 0 ? (
                    <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-amber-100">
                      {formatCount(supportSignals)} public support signals
                    </span>
                  ) : null}
                  {collaborativeWorks > 0 ? (
                    <span className="rounded-full border border-zinc-700/80 bg-black/25 px-3 py-1.5">
                      {formatCount(collaborativeWorks)} connected works
                    </span>
                  ) : null}
                </div>
                <a
                  href="#creator-ecosystems"
                  className="mt-6 inline-flex rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-200"
                >
                  Explore creators
                </a>
              </div>
              <div className="grid gap-3 xl:grid-cols-[0.85fr_1.15fr]">
                <HeroActivityPanel
                  activeCreators={creatorCount}
                  ecosystemCount={ecosystemCount || creatorCount}
                  supportedWorks={supportedWorks}
                  supportSignals={supportSignals}
                  collaborativeWorks={collaborativeWorks}
                  recentWorks={discoveryView.recentRail?.items.length || 0}
                  premiumWorks={lockedItems.length}
                />
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  {heroWorks.map((item) => (
                    <HeroConnectionCard key={`hero:${itemKey(item)}`} item={item} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <div className="space-y-6">
          {discoveryView.creatorSpotlights.length > 0 ? (
            <section id="creator-ecosystems" className="space-y-3 scroll-mt-40">
              <RailHeader title="Creator Ecosystems" subtitle="Creators with public works, drops, and publications to explore" />
              <div className="rail-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
                {discoveryView.creatorSpotlights.map((creator) => (
                  <CreatorSpotlightCard key={creator.key} creator={creator} />
                ))}
              </div>
            </section>
          ) : null}

          {freeItems.length > 0 ? (
            <section className="space-y-3">
              <RailHeader title="Free Drops" subtitle="Open works fans can play while exploring creators" badge="Open" />
              <div className="rail-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
                {freeItems.slice(0, 12).map((item) => {
                  const watchParams = new URLSearchParams({
                    origin: item.publicOrigin,
                    mode: 'freebies',
                    topic,
                  }).toString();
                  return (
                    <ShortsCard key={`shorts:${item.publicOrigin}:${item.contentId}`} item={item} watchParams={watchParams} />
                  );
                })}
              </div>
            </section>
          ) : null}

          {lockedItems.length > 0 ? (
            <section className="space-y-3">
              <RailHeader title="Premium Works" subtitle="Explore context here, unlock on the official creator page" badge="Lightning" />
              <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {lockedItems.slice(0, 8).map((item) => (
                  <FeedCard key={`${item.publicOrigin}:${item.contentId}`} item={item} />
                ))}
              </div>
            </section>
          ) : null}

          {discoveryView.supportedRail ? <ContentRail rail={discoveryView.supportedRail} /> : null}

          {discoveryView.recentRail ? <ContentRail rail={discoveryView.recentRail} /> : null}

          {secondaryRails.map((rail) => (
            <ContentRail key={rail.key} rail={rail} />
          ))}
        </div>

        {origins.length > 0 && !allDone ? <div ref={sentinelRef} className="h-8 w-full" aria-hidden="true" /> : null}
        {loading && items.length > 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center text-xs text-zinc-300">Loading more…</div>
        ) : null}
      </section>
    </main>
  );
}
