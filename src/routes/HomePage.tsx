import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FeedCard } from '../components/FeedCard';
import { ShortsCard } from '../components/ShortsCard';
import { TopicRail } from '../components/TopicRail';
import { fetchDiscoverablePage } from '../lib/api';
import { loadConfiguredOrigins } from '../lib/config';
import type { DiscoverableItem, OriginFeedState, Topic } from '../lib/types';
import { isRenderableDiscoveryItem } from '../lib/discoveryGuard';

function dedupe(items: DiscoverableItem[]) {
  const seen = new Map<string, DiscoverableItem>();
  for (const it of items) {
    if (!isRenderableDiscoveryItem(it)) continue;
    const key = `${it.publicOrigin}::${it.contentId}`;
    if (!seen.has(key)) seen.set(key, it);
  }
  return [...seen.values()];
}

function itemSortKey(item: DiscoverableItem): { time: number; id: string } {
  const maybeTime = Number(
    Date.parse(String((item as any)?.publishedAt || (item as any)?.createdAt || (item as any)?.updatedAt || ''))
  );
  return {
    time: Number.isFinite(maybeTime) ? maybeTime : 0,
    id: String(item.contentId || ''),
  };
}

function sortNewestFirst(items: DiscoverableItem[]): DiscoverableItem[] {
  return [...items].sort((a, b) => {
    const ka = itemSortKey(a);
    const kb = itemSortKey(b);
    if (ka.time !== kb.time) return kb.time - ka.time;
    return kb.id.localeCompare(ka.id);
  });
}

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

  const loadMore = useCallback(async (currentFeeds: OriginFeedState[], currentItems: DiscoverableItem[]) => {
    if (origins.length === 0 || loadingRef.current) return;
    const requestId = ++requestIdRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    const nextFeeds = currentFeeds.map((f) => ({ ...f }));
    const updates: DiscoverableItem[] = [];

    for (let i = 0; i < nextFeeds.length; i += 1) {
      const feed = nextFeeds[i];
      if (feed.done || feed.loading) continue;
      feed.loading = true;
      try {
        const data = await fetchDiscoverablePage({
          origin: feed.origin,
          topic,
          limit: 18,
          cursor: feed.cursor,
        });
        updates.push(...data.items);
        feed.cursor = data.cursor;
        feed.done = !data.cursor || data.items.length === 0;
        feed.error = null;
      } catch (e: unknown) {
        feed.error = toErrorMessage(e);
      } finally {
        feed.loading = false;
      }
    }

    if (requestId !== requestIdRef.current) {
      loadingRef.current = false;
      setLoading(false);
      return;
    }
    setFeeds(nextFeeds);
    const nextItems = sortNewestFirst(dedupe([...updates, ...currentItems]));
    setItems(nextItems);

    const errors = nextFeeds.map((f) => f.error).filter(Boolean) as string[];
    if (errors.length && updates.length === 0 && currentItems.length === 0) {
      setError(errors[0]);
    }
    setLoading(false);
    loadingRef.current = false;
  }, [origins.length, topic]);

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
  const filtered: DiscoverableItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const searched = !q
      ? items.filter((it) => isRenderableDiscoveryItem(it))
      : items.filter((it) => {
      if (!isRenderableDiscoveryItem(it)) return false;
      const hay = `${it.title || ''} ${it.creatorHandle || ''} ${it.primaryTopic || ''} ${it.contentType || ''}`.toLowerCase();
      return hay.includes(q);
    });
    const freeLaneBase = searched.filter((it) => it.accessMode === 'unlocked' || it.accessMode === 'owned');
    const lockedLaneBase = searched.filter((it) => it.accessMode === 'locked');
    const freeLane = topic === 'all' ? sortStableRandom(freeLaneBase, `${randomSeed}:free`) : freeLaneBase;
    const lockedLane = topic === 'all' ? sortStableRandom(lockedLaneBase, `${randomSeed}:locked`) : lockedLaneBase;
    return [...freeLane, ...lockedLane];
  }, [items, query, topic, randomSeed]);
  const freeItems = useMemo(
    () => filtered.filter((it) => it.accessMode === 'unlocked' || it.accessMode === 'owned'),
    [filtered]
  );
  const lockedItems = useMemo(
    () => filtered.filter((it) => it.accessMode === 'locked'),
    [filtered]
  );

  return (
    <main className="app-shell min-h-screen text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-800/70 bg-zinc-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4">
          <div className="shrink-0">
            <img
              src={logoSrc}
              alt="Certifyd Discovery"
              className="h-24 w-auto object-contain sm:h-28"
              loading="eager"
            />
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Discover on Certifyd</p>
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
        <div className="mx-auto max-w-7xl px-4 pb-2">
          <p className="network-microcopy text-xs text-zinc-300/90">
            Creators publishing across the Certifyd network. Free drops, premium unlocks, sovereign creator nodes.
          </p>
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

        <div className="space-y-6">
          {freeItems.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div>
                  <h2 className="section-title text-sm font-semibold uppercase tracking-[0.2em] text-zinc-100">Freebies</h2>
                  <p className="section-subtitle mt-1 text-xs text-zinc-400">Open and playable drops from across the network</p>
                </div>
                <span className="rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                  Open
                </span>
              </div>
              <div className="rail-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
                {freeItems.map((item) => {
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
              <div className="flex items-center justify-between px-1">
                <div>
                  <h2 className="section-title text-sm font-semibold uppercase tracking-[0.2em] text-zinc-100">Premium</h2>
                  <p className="section-subtitle mt-1 text-xs text-zinc-400">Unlock paid releases and premium creator access</p>
                </div>
                <span className="rounded-full border border-amber-300/35 bg-amber-300/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
                  Lightning
                </span>
              </div>
              <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {lockedItems.map((item) => (
                  <FeedCard key={`${item.publicOrigin}:${item.contentId}`} item={item} />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {origins.length > 0 && !allDone ? (
          <button
            onClick={() => void loadMore(feeds, items)}
            disabled={loading}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </section>
    </main>
  );
}
