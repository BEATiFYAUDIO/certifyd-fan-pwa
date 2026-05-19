import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { FeedCard } from '../components/FeedCard';
import { fetchContentContext, fetchDiscoverablePage } from '../lib/api';
import { loadConfiguredOrigins } from '../lib/config';
import type { ContentContextCreator, ContentContextPerson, ContentContextWork, ContentRelationshipContext, DiscoverableItem, Topic } from '../lib/types';
import { canOpenCreator, isLockedOrPremium, isRenderableDiscoveryItem } from '../lib/discoveryGuard';
import { buildWatchDiscoveryRails, dedupeDiscoveryItems, sortNewestFirst, type DiscoveryRail } from '../lib/discoveryViewModel';

function ctaLabel(item: DiscoverableItem) {
  if (isLockedOrPremium(item)) return 'Unlock on Creator';
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

function RelationshipSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/35 p-4">
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
          <div className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-800 bg-black/25 p-3 transition hover:border-amber-300/40">
            {person.avatarUrl ? (
              <img src={person.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-zinc-700 object-cover" loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-xs font-bold text-amber-200">
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
  if (!works.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {works.map((work) => {
        const creator = work.creator?.displayName || work.creator?.handle || 'Creator';
        const body = (
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black/25 transition hover:border-amber-300/40">
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
              <div className="truncate text-xs font-semibold text-amber-200/90">{work.relationshipLabel || 'Related work'}</div>
            </div>
          </div>
        );
        return work.publicUrl ? (
          <a key={workKey(work)} href={work.publicUrl} target="_blank" rel="noreferrer" className="block">
            {body}
          </a>
        ) : (
          <div key={workKey(work)}>{body}</div>
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
          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-black/25 px-3 py-2 text-sm text-zinc-200 hover:border-amber-300/50">
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

function RelationshipContextSections({ context }: { context: ContentRelationshipContext | null }) {
  if (!context) return null;

  const peopleBehindThis = dedupePeople(context.peopleBehindThis || []).slice(0, 12);
  const featuring = dedupePeople(context.featuring || []).slice(0, 8);
  const createdWith = dedupePeople(context.createdWith || []).slice(0, 10);
  const builtFrom = dedupeWorks(context.builtFrom || []).slice(0, 12);
  const builtFromKeys = new Set(builtFrom.map(workKey));
  const derivedFrom = dedupeWorks(context.derivedFrom || [], builtFromKeys).slice(0, 12);
  const worksThatBuiltOnThis = dedupeWorks(context.worksThatBuiltOnThis || []).slice(0, 12);
  const moreTheyWorkedOn = dedupeWorks(context.moreTheyWorkedOn || []).slice(0, 8);
  const excludedRelated = new Set([...builtFrom, ...derivedFrom, ...worksThatBuiltOnThis, ...moreTheyWorkedOn].map(workKey));
  const relatedWorks = dedupeWorks(context.relatedWorks || [], excludedRelated).slice(0, 8);
  const connectedCreators = dedupePeople(context.connectedCreators || []).slice(0, 8);

  const hasAny =
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
    <div className="mt-8 space-y-6 border-t border-zinc-800 pt-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-100">Explore the connections</h2>
        <p className="mt-1 text-sm text-zinc-400">Creators, collaborators, and related works around this publication.</p>
      </div>

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

      {builtFrom.length ? (
        <RelationshipSection title="Built From" subtitle="Works explicitly connected as source or upstream material.">
          <WorksList works={builtFrom} />
        </RelationshipSection>
      ) : null}

      {derivedFrom.length ? (
        <RelationshipSection title="Derived From">
          <WorksList works={derivedFrom} />
        </RelationshipSection>
      ) : null}

      {worksThatBuiltOnThis.length ? (
        <RelationshipSection title="Works That Built On This">
          <WorksList works={worksThatBuiltOnThis} />
        </RelationshipSection>
      ) : null}

      {moreTheyWorkedOn.length ? (
        <RelationshipSection title="More They Worked On">
          <WorksList works={moreTheyWorkedOn} />
        </RelationshipSection>
      ) : null}

      {relatedWorks.length ? (
        <RelationshipSection title="Related Works">
          <WorksList works={relatedWorks} />
        </RelationshipSection>
      ) : null}

      {connectedCreators.length ? (
        <RelationshipSection title="Connected Creators">
          <ConnectedCreators creators={connectedCreators} />
        </RelationshipSection>
      ) : null}
    </div>
  );
}

function FreebiesRelationshipPanel({ context, open, onToggle }: { context: ContentRelationshipContext | null; open: boolean; onToggle: () => void }) {
  if (!context) return null;
  const peopleBehindThis = dedupePeople(context.peopleBehindThis || []).slice(0, 6);
  const moreTheyWorkedOn = dedupeWorks(context.moreTheyWorkedOn || []).slice(0, 4);
  const excludedRelated = new Set(moreTheyWorkedOn.map(workKey));
  const relatedWorks = dedupeWorks(context.relatedWorks || [], excludedRelated).slice(0, 4);
  const hasAny = peopleBehindThis.length || moreTheyWorkedOn.length || relatedWorks.length;
  if (!hasAny) return null;

  return (
    <div
      className="absolute inset-x-3 z-30 rounded-2xl border border-zinc-700/80 bg-black/80 p-3 shadow-2xl backdrop-blur-md md:left-auto md:right-4 md:w-[420px]"
      style={{ bottom: 'calc(7.25rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Explore this work</span>
          <span className="mt-1 block text-xs text-zinc-300">People and related works</span>
        </span>
        <span className="rounded-full border border-zinc-600 px-2 py-1 text-xs font-semibold text-zinc-200">
          {open ? 'Hide' : 'Open'}
        </span>
      </button>

      {open ? (
        <div className="mt-3 max-h-[48vh] space-y-4 overflow-y-auto pr-1">
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
  const [items, setItems] = useState<DiscoverableItem[]>(stateItem && isRenderableDiscoveryItem(stateItem) ? [stateItem] : []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [relationshipContextState, setRelationshipContextState] = useState<{ key: string; context: ContentRelationshipContext | null } | null>(null);
  const [relationshipOpenKey, setRelationshipOpenKey] = useState<string | null>(null);
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
            const lockedForFan = isLockedOrPremium(it);
            const isVideo = !lockedForFan && normalizedType === 'video' && Boolean(it.previewUrl);
            const isSong = !lockedForFan && (normalizedType === 'song' || normalizedType === 'audio') && Boolean(it.previewUrl);
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
                      className="h-full w-full object-cover md:object-contain"
                      controls
                      playsInline
                      autoPlay={index === activeIndex}
                      preload="metadata"
                    />
                  ) : (
                    <img src={visualSrc} alt={it.title || 'content'} className="h-full w-full object-cover md:object-contain" loading="lazy" referrerPolicy="no-referrer" />
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
                      className="shrink-0 rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-200"
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
  const [item, setItem] = useState<DiscoverableItem | null>(stateItem && isRenderableDiscoveryItem(stateItem) ? stateItem : null);
  const [loading, setLoading] = useState(!(stateItem && isRenderableDiscoveryItem(stateItem)));
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditItem[]>([]);
  const [discoveryItems, setDiscoveryItems] = useState<DiscoverableItem[]>(stateItem && isRenderableDiscoveryItem(stateItem) ? [stateItem] : []);
  const [relationshipContextState, setRelationshipContextState] = useState<{ key: string; context: ContentRelationshipContext | null } | null>(null);

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

  const shareUrl = useMemo(() => item?.buyUrl || window.location.href, [item]);
  const explorationRails = useMemo(() => {
    if (!item) return [];
    return buildWatchDiscoveryRails(item, discoveryItems);
  }, [item, discoveryItems]);
  const relationshipContext = item && relationshipContextState?.key === `${item.publicOrigin}::${item.contentId}`
    ? relationshipContextState.context
    : null;

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
                const lockedForFan = isLockedOrPremium(item);
                if (lockedForFan) {
                  return (
                    <div className="overflow-hidden rounded-2xl border border-amber-300/20 bg-zinc-900">
                      <div className="relative flex min-h-[45vh] items-center justify-center overflow-hidden bg-black">
                        {item.coverUrl ? (
                          <img src={item.coverUrl} alt={item.title} className="h-full w-full max-h-[70vh] object-contain opacity-90" />
                        ) : (
                          <div className="flex h-[50vh] w-full flex-col items-center justify-center px-4 text-center text-zinc-500">
                            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-200/80">Premium Work</div>
                            <div className="mt-2 max-w-sm text-sm text-zinc-400">Official playback is available on the creator page.</div>
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-5">
                          <div className="max-w-xl">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/90">Official access required</div>
                            <p className="mt-2 text-sm text-zinc-200">
                              Fan discovery can show context and artwork for this work. Unlock and protected playback stay on the official creator page.
                            </p>
                            {canOpenCreator(item) ? (
                              <a
                                href={item.buyUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-4 inline-flex rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-200"
                              >
                                Unlock on Creator
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
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
                    {item.previewUrl && isVideo ? (
                      <video
                        src={item.previewUrl}
                        className="h-full w-full max-h-[70vh] bg-black object-contain"
                        controls
                        playsInline
                        preload="metadata"
                      />
                    ) : item.previewUrl && isSong ? (
                      <audio
                        src={item.previewUrl}
                        className="w-full p-4"
                        controls
                        preload="metadata"
                      />
                    ) : item.coverUrl ? (
                      <img src={item.coverUrl} alt={item.title} className="h-full w-full max-h-[70vh] bg-black object-contain" />
                    ) : (
                      <div className="flex h-[50vh] flex-col items-center justify-center px-4 text-center text-zinc-500">
                        <div className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-400">{item.contentType || 'Work'}</div>
                        <div className="mt-2 max-w-sm text-sm text-zinc-500">Preview this work on the official creator page.</div>
                      </div>
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
              <RelationshipContextSections context={relationshipContext} />
            </section>

            <aside className="space-y-3">
              <a
                href={canOpenCreator(item) ? item.buyUrl : undefined}
                target={canOpenCreator(item) ? "_blank" : undefined}
                rel={canOpenCreator(item) ? "noreferrer" : undefined}
                className={`block w-full rounded-xl px-4 py-3 text-center text-sm font-bold ${
                  canOpenCreator(item)
                    ? "bg-amber-300 text-zinc-950 hover:bg-amber-200"
                    : "border border-zinc-700 bg-zinc-900 text-zinc-500 cursor-not-allowed"
                }`}
                onClick={(e) => {
                  if (!canOpenCreator(item)) e.preventDefault();
                }}
              >
                {ctaLabel(item)}
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

        {item && explorationRails.length > 0 ? (
          <div className="mt-8 space-y-8 border-t border-zinc-800 pt-6">
            {explorationRails.map((rail) => (
              <ExplorationRail key={rail.key} rail={rail} />
            ))}
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
