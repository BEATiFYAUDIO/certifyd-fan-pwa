import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FeedCard } from '../components/FeedCard';
import { ShortsCard } from '../components/ShortsCard';
import { TopicRail } from '../components/TopicRail';
import { fetchDiscoverablePage } from '../lib/api';
import { loadConfiguredOrigins } from '../lib/config';
import type { DiscoverableItem, OriginFeedState, Topic } from '../lib/types';

function dedupe(items: DiscoverableItem[]) {
  const seen = new Map<string, DiscoverableItem>();
  for (const it of items) {
    const key = `${it.publicOrigin}::${it.contentId}`;
    if (!seen.has(key)) seen.set(key, it);
  }
  return [...seen.values()];
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
    const nextItems = dedupe([...currentItems, ...updates]);
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
      ? items
      : items.filter((it) => {
      const hay = `${it.title || ''} ${it.creatorHandle || ''} ${it.primaryTopic || ''} ${it.contentType || ''}`.toLowerCase();
      return hay.includes(q);
    });
    const freeLane = searched.filter((it) => it.accessMode === 'unlocked' || it.accessMode === 'owned');
    const lockedLane = searched.filter((it) => it.accessMode === 'locked');
    return [...freeLane, ...lockedLane];
  }, [items, query]);
  const freeItems = useMemo(
    () => filtered.filter((it) => it.accessMode === 'unlocked' || it.accessMode === 'owned'),
    [filtered]
  );
  const lockedItems = useMemo(
    () => filtered.filter((it) => it.accessMode === 'locked'),
    [filtered]
  );

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4">
          <img
            src={logoSrc}
            alt="Certifyd Fan"
            className="h-24 w-auto object-contain sm:h-28"
            loading="eager"
          />
          <div className="ml-auto w-full max-w-xl">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-zinc-500"
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

        <div className="space-y-6">
          {freeItems.length > 0 ? (
            <section className="space-y-3">
              <div className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-300">Freebies</div>
              <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
                {freeItems.map((item) => (
                  <ShortsCard key={`shorts:${item.publicOrigin}:${item.contentId}`} item={item} />
                ))}
              </div>
            </section>
          ) : null}

          {lockedItems.length > 0 ? (
            <section className="space-y-3">
              <div className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-300">More to unlock</div>
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
