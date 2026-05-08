import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { fetchDiscoverablePage } from '../lib/api';
import { loadConfiguredOrigins } from '../lib/config';
import type { DiscoverableItem } from '../lib/types';

function ctaLabel(mode: DiscoverableItem['accessMode']) {
  if (mode === 'locked') return 'Unlock on Creator';
  return 'Open on Creator';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Failed to load content';
}

async function loadById(contentId: string, originHint: string | null): Promise<DiscoverableItem | null> {
  const origins = await loadConfiguredOrigins();
  const ordered = originHint ? [originHint, ...origins.filter((o) => o !== originHint)] : origins;

  for (const origin of ordered) {
    let cursor: string | null = null;
    for (let page = 0; page < 6; page += 1) {
      const response = await fetchDiscoverablePage({ origin, topic: 'all', limit: 24, cursor });
      const hit = response.items.find((i) => i.contentId === contentId);
      if (hit) return hit;
      if (!response.cursor) break;
      cursor = response.cursor;
    }
  }
  return null;
}

export function WatchPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const stateItem = (location.state as { item?: DiscoverableItem } | null)?.item;
  const contentId = String(params.contentId || '').trim();
  const originHint = search.get('origin');

  const [item, setItem] = useState<DiscoverableItem | null>(stateItem || null);
  const [loading, setLoading] = useState(!stateItem);
  const [error, setError] = useState<string | null>(null);

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
        setItem(res);
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

  const shareUrl = useMemo(() => item?.buyUrl || window.location.href, [item]);

  async function onShare() {
    if (!item) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      alert('Link copied');
    } catch {
      // no-op
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-4">
        <Link to="/" className="text-sm text-zinc-400 hover:text-zinc-200">← Back</Link>

        {loading ? <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">Loading…</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-red-800 bg-red-950/30 p-4 text-red-200">{error}</div> : null}

        {item ? (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_280px]">
            <section className="space-y-4">
              <div className="overflow-hidden rounded-2xl bg-zinc-900">
                {item.previewUrl ? (
                  <video
                    src={item.previewUrl}
                    className="h-full w-full max-h-[70vh] bg-black object-contain"
                    controls
                    playsInline
                    preload="metadata"
                  />
                ) : item.coverUrl ? (
                  <img src={item.coverUrl} alt={item.title} className="h-full w-full max-h-[70vh] bg-black object-contain" />
                ) : (
                  <div className="flex h-[50vh] items-center justify-center text-zinc-500">No media preview</div>
                )}
              </div>

              <h1 className="text-2xl font-bold">{item.title || 'Untitled'}</h1>
              <p className="text-sm text-zinc-400">
                @{item.creatorHandle || 'creator'} • {item.primaryTopic || 'topic'} • {item.contentType}
              </p>
              {item.description ? <p className="text-sm text-zinc-300">{item.description}</p> : null}
            </section>

            <aside className="space-y-3">
              <a
                href={item.buyUrl}
                target="_blank"
                rel="noreferrer"
                className="block w-full rounded-xl bg-cyan-500 px-4 py-3 text-center text-sm font-bold text-zinc-950 hover:bg-cyan-400"
              >
                {ctaLabel(item.accessMode)}
              </a>
              <button
                onClick={() => window.open(item.buyUrl, '_blank', 'noopener,noreferrer')}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold hover:bg-zinc-800"
              >
                Open
              </button>
              <button
                onClick={onShare}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold hover:bg-zinc-800"
              >
                Share
              </button>
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}
