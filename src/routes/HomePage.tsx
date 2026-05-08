import { useEffect, useMemo, useState } from 'react';
import { FeedCard } from '../components/FeedCard';
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

function accessPriority(mode: DiscoverableItem['accessMode']) {
  if (mode === 'unlocked') return 0;
  if (mode === 'owned') return 1;
  return 2;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Failed to load feed';
}

export function HomePage() {
  const [origins, setOrigins] = useState<string[]>([]);
  const [originsLoaded, setOriginsLoaded] = useState(false);
  const [topic, setTopic] = useState<Topic>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DiscoverableItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeds, setFeeds] = useState<OriginFeedState[]>([]);

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
    setItems([]);
    setError(null);
    setFeeds(origins.map((origin) => ({ origin, cursor: null, done: false, loading: false, error: null })));
  }

  async function loadMore(currentFeeds: OriginFeedState[] = feeds, currentItems: DiscoverableItem[] = items) {
    if (origins.length === 0) return;
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

    setFeeds(nextFeeds);
    const nextItems = dedupe([...currentItems, ...updates]);
    setItems(nextItems);

    const errors = nextFeeds.map((f) => f.error).filter(Boolean) as string[];
    if (errors.length && updates.length === 0 && currentItems.length === 0) {
      setError(errors[0]);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (origins.length === 0 || items.length > 0 || loading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMore(feeds, items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origins, items.length, loading, feeds]);

  const allDone = feeds.length > 0 && feeds.every((f) => f.done);
  const filtered: DiscoverableItem[] = useMemo(() => {
    const ranked = items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const byAccess = accessPriority(a.item.accessMode) - accessPriority(b.item.accessMode);
        if (byAccess !== 0) return byAccess;
        return a.index - b.index;
      })
      .map((row) => row.item);
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter((it) => {
      const hay = `${it.title || ''} ${it.creatorHandle || ''} ${it.primaryTopic || ''} ${it.contentType || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <img
            src="/header-logo.png"
            alt="Certifyd"
            className="h-10 w-auto object-contain sm:h-11"
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

        <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <FeedCard key={`${item.publicOrigin}:${item.contentId}`} item={item} />
          ))}
        </div>

        {origins.length > 0 && !allDone ? (
          <button
            onClick={() => void loadMore()}
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
