import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { fetchDiscoverablePage } from '../lib/api';
import { loadConfiguredOrigins } from '../lib/config';
import type { DiscoverableItem, Topic } from '../lib/types';
import { canOpenCreator, isRenderableDiscoveryItem } from '../lib/discoveryGuard';

function ctaLabel(mode: DiscoverableItem['accessMode']) {
  if (mode === 'locked') return 'Unlock on Creator';
  return 'Open on Creator';
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
    if (!(it.accessMode === 'unlocked' || it.accessMode === 'owned')) continue;
    const key = `${it.publicOrigin}::${it.contentId}`;
    if (!seen.has(key)) seen.set(key, it);
  }
  return sortNewestFirst([...seen.values()]);
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
  const [items, setItems] = useState<DiscoverableItem[]>(stateItem && isRenderableDiscoveryItem(stateItem) ? [stateItem] : []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);

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

  useEffect(() => {
    sectionRefs.current.forEach((section, index) => {
      if (!section) return;
      const mediaEls = section.querySelectorAll<HTMLMediaElement>('video, audio');
      mediaEls.forEach((mediaEl) => {
        if (index !== activeIndex) {
          mediaEl.pause();
          return;
        }
        if (mediaEl.tagName.toLowerCase() === 'video' && mediaEl.paused) {
          void mediaEl.play().catch(() => {
            // autoplay can be blocked by browser policy
          });
        }
      });
    });
  }, [activeIndex, items]);

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
            const normalizedType = String(it.contentType || '').toLowerCase();
            const isVideo = normalizedType === 'video' && Boolean(it.previewUrl);
            const isSong = (normalizedType === 'song' || normalizedType === 'audio') && Boolean(it.previewUrl);
            const visualSrc = isVideo ? (it.previewUrl || it.coverUrl || '') : (it.coverUrl || '');
            return (
              <section
                key={`${it.publicOrigin}:${it.contentId}:${index}`}
                className="relative h-[100dvh] snap-start bg-black"
                data-index={index}
                ref={(el) => {
                  sectionRefs.current[index] = el;
                }}
              >
                {visualSrc ? (
                  isVideo ? (
                    <video
                      src={visualSrc}
                      className="h-full w-full object-cover"
                      controls
                      playsInline
                      autoPlay={index === activeIndex}
                      preload="metadata"
                    />
                  ) : (
                    <img src={visualSrc} alt={it.title || 'content'} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-zinc-500">No media</div>
                )}

                {isSong ? (
                  <div className="absolute inset-x-4 z-20 rounded-xl bg-black/60 p-3 backdrop-blur" style={{ bottom: 'calc(9rem + env(safe-area-inset-bottom, 0px))' }}>
                    <audio
                      src={it.previewUrl}
                      className="w-full"
                      controls
                      preload="metadata"
                    />
                  </div>
                ) : null}

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
                      className="shrink-0 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-cyan-400"
                    >
                      {ctaLabel(it.accessMode)}
                    </a>
                  ) : null}
                </div>
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
  const [item, setItem] = useState<DiscoverableItem | null>(stateItem && isRenderableDiscoveryItem(stateItem) ? stateItem : null);
  const [loading, setLoading] = useState(!(stateItem && isRenderableDiscoveryItem(stateItem)));
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditItem[]>([]);

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
        {error ? (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-zinc-100">
            <div className="text-lg font-semibold">This creator’s node is temporarily offline.</div>
            <div className="mt-2 text-sm text-zinc-400">Try again shortly or return to discovery.</div>
            <Link
              to="/"
              className="mt-4 inline-flex rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold hover:bg-zinc-800"
            >
              Back to Discovery
            </Link>
          </div>
        ) : null}

        {item ? (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_280px]">
            <section className="space-y-4">
              {(() => {
                const normalizedType = String(item.contentType || '').toLowerCase();
                const isSong = normalizedType === 'song' || normalizedType === 'audio';
                const isVideo = normalizedType === 'video';
                if (isSong) {
                  return (
                    <div className="space-y-3 overflow-hidden rounded-2xl bg-zinc-900 p-4">
                      <div className="overflow-hidden rounded-xl bg-black">
                        {item.coverUrl ? (
                          <img src={item.coverUrl} alt={item.title} className="h-full w-full max-h-[60vh] object-contain" />
                        ) : (
                          <div className="flex h-[42vh] items-center justify-center text-zinc-500">No cover art</div>
                        )}
                      </div>
                      {item.previewUrl ? (
                        <audio
                          src={item.previewUrl}
                          className="w-full"
                          controls
                          preload="metadata"
                        />
                      ) : null}
                    </div>
                  );
                }
                return (
                  <div className="overflow-hidden rounded-2xl bg-zinc-900">
                    {item.previewUrl ? (
                      isVideo ? (
                        <video
                          src={item.previewUrl}
                          className="h-full w-full max-h-[70vh] bg-black object-contain"
                          controls
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <audio
                          src={item.previewUrl}
                          className="w-full p-4"
                          controls
                          preload="metadata"
                        />
                      )
                    ) : item.coverUrl ? (
                      <img src={item.coverUrl} alt={item.title} className="h-full w-full max-h-[70vh] bg-black object-contain" />
                    ) : (
                      <div className="flex h-[50vh] items-center justify-center text-zinc-500">No media preview</div>
                    )}
                  </div>
                );
              })()}

              <h1 className="text-2xl font-bold">{item.title || 'Untitled'}</h1>
              <p className="text-sm text-zinc-400">
                @{item.creatorHandle || 'creator'} • {item.primaryTopic || 'topic'} • {item.contentType}
              </p>
              {item.description ? <p className="text-sm text-zinc-300">{item.description}</p> : null}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Credits</h2>
                <div className="mt-2 space-y-1">
                  {credits.map((credit, idx) => {
                    const name = credit.displayName || credit.participantName || 'Contributor';
                    const handle = credit.handle ? `@${String(credit.handle).replace(/^@+/, '')}` : null;
                    const role = credit.role || null;
                    const pct = credit.sharePercent ?? credit.percent ?? null;
                    return (
                      <p key={`${name}-${idx}`} className="text-sm text-zinc-300">
                        {name}{handle ? ` (${handle})` : ''}{role ? ` • ${role}` : ''}{pct != null ? ` • ${pct}%` : ''}
                      </p>
                    );
                  })}
                </div>
              </section>
            </section>

            <aside className="space-y-3">
              <a
                href={canOpenCreator(item) ? item.buyUrl : undefined}
                target={canOpenCreator(item) ? "_blank" : undefined}
                rel={canOpenCreator(item) ? "noreferrer" : undefined}
                className={`block w-full rounded-xl px-4 py-3 text-center text-sm font-bold ${
                  canOpenCreator(item)
                    ? "bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
                    : "border border-zinc-700 bg-zinc-900 text-zinc-500 cursor-not-allowed"
                }`}
                onClick={(e) => {
                  if (!canOpenCreator(item)) e.preventDefault();
                }}
              >
                {ctaLabel(item.accessMode)}
              </a>
              <button
                onClick={() => {
                  if (!canOpenCreator(item)) return;
                  window.open(item.buyUrl, '_blank', 'noopener,noreferrer');
                }}
                disabled={!canOpenCreator(item)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
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

export function WatchPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const stateItem = (location.state as { item?: DiscoverableItem } | null)?.item || null;
  const contentId = String(params.contentId || '').trim();
  const originHint = search.get('origin');
  const mode = String(search.get('mode') || '').toLowerCase();
  const topic = normalizeTopic(search.get('topic') || 'all');

  if (mode === 'freebies') {
    return <FreebiesWatch contentId={contentId} originHint={originHint} topic={topic} stateItem={stateItem} />;
  }

  return <StandardWatch contentId={contentId} originHint={originHint} stateItem={stateItem} />;
}
