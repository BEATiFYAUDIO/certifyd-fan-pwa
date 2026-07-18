import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStage1APlayer } from '../components/stage1APlayerContext';
import {
  createBundle,
  decodeSharedBundle,
  deleteBundle,
  encodeSharedBundle,
  getBundle,
  updateBundle,
  type Bundle,
  type BundleVisibility,
  type SharedBundleManifest,
} from '../lib/bundleStore';
import { loadDiscoverableById } from '../lib/contentRuntime/discovery';
import { displayStateFromItem } from '../lib/playbackDisplay';
import { itemIdFromDiscoverable, libraryRepository, parseItemId } from '../lib/libraryStore';
import type { DiscoverableItem } from '../lib/types';

type ResolvedBundleRow = {
  itemId: string;
  item: DiscoverableItem | null;
};

function useResolvedBundleItems(itemIds: string[]) {
  const [rows, setRows] = useState<ResolvedBundleRow[]>([]);
  const key = itemIds.join('|');

  useEffect(() => {
    let active = true;
    const resolve = async () => {
      const nextRows: ResolvedBundleRow[] = [];
      for (const itemId of itemIds) {
        const parsed = parseItemId(itemId);
        if (!parsed) {
          nextRows.push({ itemId, item: null });
          continue;
        }
        try {
          const item = await loadDiscoverableById(parsed.contentId, parsed.publicOrigin);
          if (!active) return;
          nextRows.push({ itemId, item });
        } catch {
          if (!active) return;
          nextRows.push({ itemId, item: null });
        }
      }
      if (active) setRows(nextRows);
    };
    void resolve();
    return () => {
      active = false;
    };
  }, [key, itemIds]);

  return rows;
}

function shuffled<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function formatDate(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Recently updated';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time));
}

function visibilityLabel(value: BundleVisibility): string {
  return value[0].toUpperCase() + value.slice(1);
}

function hasPlaybackCandidate(item: DiscoverableItem): boolean {
  return Boolean(item.previewUrl || item.fullMediaUrl || item.fullContentUrl || item.mediaUrl || item.contentUrl || item.offerUrl);
}

function playableItems(rows: ResolvedBundleRow[]): DiscoverableItem[] {
  return rows.map((row) => row.item).filter((item): item is DiscoverableItem => Boolean(item && hasPlaybackCandidate(item)));
}

function BundleWorkRow({
  row,
  index,
  total,
  local,
  inLibrary,
  onPlay,
  onAddToLibrary,
  onRemove,
  onMove,
}: {
  row: ResolvedBundleRow;
  index: number;
  total: number;
  local: boolean;
  inLibrary: boolean;
  onPlay: (item: DiscoverableItem) => void;
  onAddToLibrary: (item: DiscoverableItem) => void;
  onRemove?: () => void;
  onMove?: (direction: -1 | 1) => void;
}) {
  const item = row.item;
  const playback = item ? displayStateFromItem(item) : null;
  return (
    <article className="rounded-2xl border border-zinc-800/90 bg-black/35 p-3">
      <div className="flex min-w-0 gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-300/25 bg-amber-300/10 text-xs font-bold text-amber-100">
          {index + 1}
        </div>
        {item?.coverUrl ? (
          <img src={item.coverUrl} alt="" className="h-16 w-24 shrink-0 rounded-xl object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-[10px] uppercase tracking-wide text-zinc-500">
            {item?.contentType || 'Unavailable'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-base font-bold text-zinc-50">{item?.title || 'Unavailable work'}</h2>
          <p className="mt-1 truncate text-sm text-zinc-400">{item ? `@${item.creatorHandle || 'creator'}` : row.itemId}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-wide">
            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-300">{playback?.label || 'Unavailable'}</span>
            {item?.primaryTopic ? <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-300">{item.primaryTopic}</span> : null}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {item ? (
          <>
            <button type="button" className="rounded-full bg-white px-4 py-2 text-xs font-black text-black" onClick={() => onPlay(item)}>Play</button>
            <button type="button" className="rounded-full border border-zinc-700 px-4 py-2 text-xs font-bold text-zinc-100" onClick={() => onAddToLibrary(item)}>
              {inLibrary ? 'In Library' : 'Add to Library'}
            </button>
          </>
        ) : null}
        {local && onMove ? (
          <>
            <button type="button" className="rounded-full border border-zinc-700 px-4 py-2 text-xs font-bold text-zinc-100 disabled:opacity-40" disabled={index === 0} onClick={() => onMove(-1)}>Move Up</button>
            <button type="button" className="rounded-full border border-zinc-700 px-4 py-2 text-xs font-bold text-zinc-100 disabled:opacity-40" disabled={index >= total - 1} onClick={() => onMove(1)}>Move Down</button>
          </>
        ) : null}
        {local && onRemove ? (
          <button type="button" className="rounded-full border border-red-400/40 px-4 py-2 text-xs font-bold text-red-100" onClick={onRemove}>Remove item</button>
        ) : null}
      </div>
    </article>
  );
}

function BundleDetail({ bundle, shared = false }: { bundle: Bundle | SharedBundleManifest; shared?: boolean }) {
  const navigate = useNavigate();
  const { playItem } = useStage1APlayer();
  const [localBundle, setLocalBundle] = useState<Bundle | null>(shared ? null : bundle as Bundle);
  const currentBundle = localBundle || bundle;
  const rows = useResolvedBundleItems(currentBundle.itemIds);
  const [title, setTitle] = useState(currentBundle.title);
  const [description, setDescription] = useState(currentBundle.description || '');
  const [visibility, setVisibility] = useState<BundleVisibility>('visibility' in currentBundle ? currentBundle.visibility : 'private');
  const [message, setMessage] = useState(shared ? 'This link contains a snapshot of the Bundle.' : '');
  const [copying, setCopying] = useState(false);
  const libraryKeys = useMemo(() => new Set(libraryRepository.getItems().map((record) => record.itemId)), [message]);
  const resolvedPlayable = useMemo(() => playableItems(rows), [rows]);
  const local = Boolean(localBundle);

  useEffect(() => {
    setTitle(currentBundle.title);
    setDescription(currentBundle.description || '');
    setVisibility('visibility' in currentBundle ? currentBundle.visibility : 'private');
  }, [currentBundle]);

  const startQueue = useCallback((queue: DiscoverableItem[], startItem = queue[0]) => {
    if (!startItem || !queue.length) {
      setMessage('No playable works are available in this Bundle yet.');
      return;
    }
    void playItem(startItem, {
      queue,
      queueSource: localBundle ? 'bundle' : 'manual',
      queueSourceId: localBundle?.id || null,
    });
  }, [localBundle, playItem]);

  const persistLocal = useCallback((updates: Parameters<typeof updateBundle>[1]) => {
    if (!localBundle) return;
    const updated = updateBundle(localBundle.id, updates);
    if (updated) {
      setLocalBundle(updated);
      setMessage('Bundle updated.');
    }
  }, [localBundle]);

  const shareBundle = useCallback(async () => {
    if ('visibility' in currentBundle && currentBundle.visibility === 'private') {
      setMessage('Private Bundles cannot be shared. Change visibility to Unlisted or Public first.');
      return;
    }
    const data = encodeSharedBundle(currentBundle);
    const url = `${window.location.origin}/bundles/shared?data=${data}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: currentBundle.title, url });
        setMessage(`Share URL: ${url}`);
      } else {
        await navigator.clipboard.writeText(url);
        setMessage(`Share URL copied: ${url}`);
      }
    } catch {
      setMessage(`Share URL: ${url}`);
    }
  }, [currentBundle]);

  const saveCopy = useCallback(() => {
    if (copying) return;
    setCopying(true);
    try {
      const created = createBundle({
        title: currentBundle.title,
        description: currentBundle.description,
        itemIds: currentBundle.itemIds,
        visibility: 'private',
      });
      navigate(`/bundles/${encodeURIComponent(created.id)}`, { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save a copy.');
      setCopying(false);
    }
  }, [copying, currentBundle, navigate]);

  const removeItem = useCallback((itemId: string) => {
    if (!localBundle) return;
    persistLocal({ itemIds: localBundle.itemIds.filter((id) => id !== itemId) });
  }, [localBundle, persistLocal]);

  const moveItem = useCallback((index: number, direction: -1 | 1) => {
    if (!localBundle) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= localBundle.itemIds.length) return;
    const itemIds = [...localBundle.itemIds];
    [itemIds[index], itemIds[nextIndex]] = [itemIds[nextIndex], itemIds[index]];
    persistLocal({ itemIds });
  }, [localBundle, persistLocal]);

  const deleteCurrentBundle = useCallback(() => {
    if (!localBundle) return;
    if (!window.confirm('Delete this Bundle from this device?')) return;
    deleteBundle(localBundle.id);
    navigate('/#saved');
  }, [localBundle, navigate]);

  return (
    <main className="min-h-screen space-y-5 px-3 pb-36 pt-4 text-zinc-100 sm:px-6 lg:px-8">
      <Link to="/#saved" className="text-sm font-semibold text-zinc-400 hover:text-white">← My Library</Link>
      <section className="rounded-3xl border border-zinc-800/90 bg-zinc-950/80 p-4 shadow-2xl shadow-black/30 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-amber-200/80">{shared ? 'Shared Bundle Snapshot' : 'Bundle'}</p>
        {local ? (
          <div className="mt-4 grid gap-3">
            <input className="rounded-2xl border border-zinc-700 bg-black/40 px-4 py-3 text-2xl font-black text-white outline-none focus:border-amber-300 sm:text-4xl" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => persistLocal({ title, description, visibility })} />
            <textarea className="min-h-24 rounded-2xl border border-zinc-700 bg-black/40 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-amber-300" value={description} onChange={(event) => setDescription(event.target.value)} onBlur={() => persistLocal({ title, description, visibility })} placeholder="Description" />
            <select className="rounded-2xl border border-zinc-700 bg-black/40 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-amber-300" value={visibility} onChange={(event) => { const next = event.target.value as BundleVisibility; setVisibility(next); persistLocal({ title, description, visibility: next }); }}>
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </select>
          </div>
        ) : (
          <>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-5xl">{currentBundle.title}</h1>
            {currentBundle.description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">{currentBundle.description}</p> : null}
          </>
        )}
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-wide">
          <span className="rounded-full border border-zinc-700 bg-black/35 px-3 py-1.5">{currentBundle.itemIds.length} items</span>
          <span className="rounded-full border border-zinc-700 bg-black/35 px-3 py-1.5">{'visibility' in currentBundle ? visibilityLabel(currentBundle.visibility) : 'Snapshot'}</span>
          <span className="rounded-full border border-zinc-700 bg-black/35 px-3 py-1.5">Updated {formatDate('updatedAt' in currentBundle ? currentBundle.updatedAt : currentBundle.createdAt)}</span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="rounded-full bg-amber-300 px-5 py-3 text-sm font-black text-black shadow-lg shadow-amber-300/20 transition hover:-translate-y-0.5 hover:bg-amber-200 hover:shadow-amber-300/30 active:translate-y-0" onClick={() => startQueue(resolvedPlayable)}>Play Bundle</button>
          <button type="button" className="rounded-full border border-zinc-700 px-5 py-3 text-sm font-bold text-zinc-100 transition hover:-translate-y-0.5 hover:border-amber-300/70 hover:bg-amber-300/10 hover:text-amber-100 active:translate-y-0" onClick={() => startQueue(shuffled(resolvedPlayable))}>Shuffle</button>
          <button type="button" className="rounded-full border border-zinc-700 px-5 py-3 text-sm font-bold text-zinc-100 transition hover:-translate-y-0.5 hover:border-amber-300/70 hover:bg-amber-300/10 hover:text-amber-100 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:border-zinc-700 disabled:hover:bg-transparent disabled:hover:text-zinc-100" disabled={'visibility' in currentBundle && currentBundle.visibility === 'private'} title={'visibility' in currentBundle && currentBundle.visibility === 'private' ? 'Change visibility to Unlisted or Public to share' : 'Copy share URL'} onClick={shareBundle}>Share Bundle</button>
          {shared ? <button type="button" className="rounded-full border border-emerald-400/50 px-5 py-3 text-sm font-bold text-emerald-100" onClick={saveCopy} disabled={copying}>Save a Copy</button> : null}
          {local ? <button type="button" className="rounded-full border border-red-400/50 px-5 py-3 text-sm font-bold text-red-100" onClick={deleteCurrentBundle}>Delete</button> : null}
        </div>
        {message ? <p className="mt-4 rounded-2xl border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-300">{message}</p> : null}
      </section>
      <section className="space-y-3">
        {rows.map((row, index) => (
          <BundleWorkRow
            key={`${row.itemId}:${index}`}
            row={row}
            index={index}
            total={rows.length}
            local={local}
            inLibrary={row.item ? libraryKeys.has(itemIdFromDiscoverable(row.item)) : false}
            onPlay={(item) => startQueue(resolvedPlayable, item)}
            onAddToLibrary={(item) => {
              libraryRepository.addItem(itemIdFromDiscoverable(item));
              setMessage('Added to Library.');
            }}
            onRemove={() => removeItem(row.itemId)}
            onMove={(direction) => moveItem(index, direction)}
          />
        ))}
        {!rows.length ? <p className="rounded-2xl border border-zinc-800 bg-black/30 p-4 text-sm text-zinc-400">Resolving Bundle works…</p> : null}
      </section>
    </main>
  );
}

export function BundlePage() {
  const { bundleId } = useParams();
  const [bundle, setBundle] = useState<Bundle | null | undefined>(undefined);

  useEffect(() => {
    setBundle(bundleId ? getBundle(bundleId) : null);
  }, [bundleId]);

  if (bundle === undefined) return null;
  if (!bundle) return <Navigate to="/#saved" replace />;
  return <BundleDetail bundle={bundle} />;
}

export function SharedBundlePage() {
  const [params] = useSearchParams();
  const manifest = useMemo(() => decodeSharedBundle(params.get('data') || ''), [params]);

  if (!manifest) {
    return (
      <main className="min-h-screen px-3 pb-36 pt-4 text-zinc-100 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-red-200/80">Bundle unavailable</p>
          <h1 className="mt-2 text-3xl font-black text-white">This shared Bundle link is invalid.</h1>
          <p className="mt-3 text-sm text-zinc-400">The link may be malformed or too large to open safely.</p>
          <Link to="/" className="mt-5 inline-flex rounded-full bg-white px-5 py-3 text-sm font-black text-black">Go Home</Link>
        </section>
      </main>
    );
  }

  return <BundleDetail bundle={manifest} shared />;
}
