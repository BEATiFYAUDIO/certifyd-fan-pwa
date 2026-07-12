import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStage1APlayer, type Stage1APlayerSnapshot } from '../components/stage1APlayerContext';
import { canonicalCreatorProfileUrlForItem } from '../lib/destinations';
import { canOpenCreator, isRenderableDiscoveryItem } from '../lib/discoveryGuard';
import { buyUrlWithFanReturnUrl } from '../lib/fanReturnUrl';
import { contentRuntimeItemKey, hydrateCanonicalOfferForItem, loadShortsRuntimeQueue, normalizeTopic, resolveRuntimePlayback } from '../lib/contentRuntime';
import { normalizeCanonicalOrigin } from '../lib/origin';
import { getCardThemeVars } from '../lib/profileTheme';
import type { DiscoverableItem, Topic } from '../lib/types';

function watchHrefForItem(item: DiscoverableItem): string {
  return `/watch/${encodeURIComponent(item.contentId)}?origin=${encodeURIComponent(item.publicOrigin)}`;
}

function shortsHrefForItem(item: DiscoverableItem, topic: Topic): string {
  const params = new URLSearchParams({ origin: item.publicOrigin, topic });
  return `/shorts/${encodeURIComponent(item.contentId)}?${params.toString()}`;
}

function useShortsSession() {
  const { getPlayerSnapshot, pausePlayback, restorePlayerSnapshot, setPlayerChromeHidden } = useStage1APlayer();
  const snapshotRef = useRef<Stage1APlayerSnapshot | null>(null);
  useEffect(() => {
    snapshotRef.current = getPlayerSnapshot();
    setPlayerChromeHidden(true);
    pausePlayback();
    document.body.classList.add('has-shorts-mode');
    return () => {
      setPlayerChromeHidden(false);
      document.body.classList.remove('has-shorts-mode');
      void restorePlayerSnapshot(snapshotRef.current);
    };
  }, [getPlayerSnapshot, pausePlayback, restorePlayerSnapshot, setPlayerChromeHidden]);
}

function ShortsSlide({
  item,
  active,
  topic,
  muted,
  volume,
  onMutedChange,
  onVolumeChange,
  onExplore,
  slideRef,
  index,
}: {
  item: DiscoverableItem;
  active: boolean;
  topic: Topic;
  muted: boolean;
  volume: number;
  onMutedChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onExplore: (item: DiscoverableItem) => void;
  slideRef: (node: HTMLElement | null) => void;
  index: number;
}) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [paused, setPaused] = useState(true);
  const [ended, setEnded] = useState(false);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const playbackState = useMemo(() => resolveRuntimePlayback(item), [item]);
  const creatorProfileUrl = canonicalCreatorProfileUrlForItem(item);
  const buyUrl = buyUrlWithFanReturnUrl(item.buyUrl, item);
  const themeVars = useMemo(() => getCardThemeVars(item.profileTheme), [item.profileTheme]);
  const isMediaPlayable = Boolean(playbackState.streamUrl && (playbackState.renderKind === 'video' || playbackState.renderKind === 'audio'));

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return undefined;
    media.muted = muted;
    media.volume = Math.min(1, Math.max(0, volume));
    if (!active || !playbackState.streamUrl) {
      try { media.pause(); } catch { /* ignore */ }
      try { media.currentTime = 0; } catch { /* ignore */ }
      return undefined;
    }
    media.setAttribute('playsinline', 'true');
    media.preload = 'auto';
    const playPromise = media.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        media.muted = true;
        onMutedChange(true);
        const mutedPromise = media.play();
        if (mutedPromise && typeof mutedPromise.catch === 'function') mutedPromise.catch(() => setPaused(true));
      });
    }
    return () => {
      try { media.pause(); } catch { /* ignore */ }
    };
  }, [active, muted, onMutedChange, playbackState.streamUrl, volume]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.muted = muted;
    media.volume = Math.min(1, Math.max(0, volume));
  }, [muted, volume]);

  const togglePlayback = () => {
    const media = mediaRef.current;
    if (!media || !isMediaPlayable) return;
    if (media.paused) {
      const playPromise = media.play();
      setPaused(false);
      setEnded(false);
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => setPaused(true));
      return;
    }
    media.pause();
    setPaused(true);
  };

  const toggleMute = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const nextMuted = !muted;
    onMutedChange(nextMuted);
    const media = mediaRef.current;
    if (media) media.muted = nextMuted;
  };

  const onTimeUpdate = () => {
    const media = mediaRef.current;
    const limit = playbackState.playback.mode === 'preview' ? playbackState.playback.previewLimitSeconds : null;
    if (!media || !limit || media.currentTime < limit) return;
    try { media.pause(); } catch { /* ignore */ }
    try { media.currentTime = Math.max(0, limit); } catch { /* ignore */ }
    setPaused(true);
    setEnded(true);
  };

  const mediaSurface = (() => {
    if (playbackState.renderKind === 'video' && playbackState.streamUrl) {
      return (
        <video
          ref={(node) => { mediaRef.current = node; }}
          className={`shorts-media shorts-media-${fit}`}
          src={active ? playbackState.streamUrl : undefined}
          poster={item.coverUrl || undefined}
          muted={muted}
          playsInline
          preload={active ? 'auto' : 'metadata'}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            setFit(video.videoHeight > video.videoWidth ? 'cover' : 'contain');
          }}
          onPlay={() => { setPaused(false); setEnded(false); }}
          onPause={() => setPaused(true)}
          onEnded={() => { setPaused(true); setEnded(true); }}
          onTimeUpdate={onTimeUpdate}
        />
      );
    }
    if (playbackState.renderKind === 'audio' && playbackState.streamUrl) {
      return (
        <div className="shorts-audio-artwork">
          {item.coverUrl ? <img src={item.coverUrl} alt={item.title || 'Artwork'} referrerPolicy="no-referrer" /> : <div>CERTIFYD</div>}
          <audio
            ref={(node) => { mediaRef.current = node; }}
            src={active ? playbackState.streamUrl : undefined}
            muted={muted}
            preload={active ? 'auto' : 'metadata'}
            onPlay={() => { setPaused(false); setEnded(false); }}
            onPause={() => setPaused(true)}
            onEnded={() => { setPaused(true); setEnded(true); }}
            onTimeUpdate={onTimeUpdate}
          />
        </div>
      );
    }
    if (item.coverUrl) {
      return <img className="shorts-media shorts-media-contain" src={item.coverUrl} alt={item.title || 'Short'} loading={active ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" />;
    }
    return (
      <div className="shorts-fallback-card">
        <span>{playbackState.renderKind === 'document' ? 'Document' : 'Work'}</span>
        <strong>{item.title || 'Untitled'}</strong>
        <small>@{item.creatorHandle || 'creator'}</small>
      </div>
    );
  })();

  return (
    <section ref={slideRef} className="watch-shell shorts-slide" style={themeVars as CSSProperties} data-index={index} data-short-id={item.contentId}>
      <div className="shorts-slide-surface">
        <div
          className="shorts-media-surface"
          role="button"
          tabIndex={0}
          onClick={togglePlayback}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              togglePlayback();
            }
          }}
          aria-label={`${paused ? 'Play' : 'Pause'} ${item.title || 'Short'}`}
        >
          {item.coverUrl ? <img className="shorts-backdrop" src={item.coverUrl} alt="" aria-hidden="true" referrerPolicy="no-referrer" /> : null}
          {mediaSurface}
        </div>
        <div className="shorts-gradient" aria-hidden="true" />
        <div className="shorts-meta">
          <div className="mb-2 flex flex-wrap gap-2">
            <span className="watch-pill watch-pill-inline">{playbackState.label}</span>
            {paused ? <span className="watch-pill watch-pill-inline">Paused</span> : null}
            {ended && playbackState.playback.mode === 'preview' ? <span className="watch-pill watch-pill-inline">Preview ended</span> : null}
          </div>
          <h1 className="line-clamp-2 text-2xl font-bold">{item.title || 'Untitled'}</h1>
          <p className="mt-1 text-sm text-zinc-200">@{item.creatorHandle || 'creator'} • {item.contentType || 'work'}</p>
        </div>
        <div className="shorts-actions" aria-label="Short actions">
          <button type="button" onClick={(event) => { event.stopPropagation(); togglePlayback(); }} aria-label={paused ? 'Play Short' : 'Pause Short'}>
            {paused ? '▶' : 'Ⅱ'}
          </button>
          {isMediaPlayable ? (
            <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute Short' : 'Mute Short'}>
              {muted ? '🔇' : '🔊'}
            </button>
          ) : null}
          {creatorProfileUrl ? (
            <a href={creatorProfileUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} aria-label="Open creator profile">
              @
            </a>
          ) : null}
          <button type="button" onClick={(event) => { event.stopPropagation(); onExplore(item); }} aria-label="Explore Work">
            ↗
          </button>
          {canOpenCreator(item) && (playbackState.commerceState === 'preview' || playbackState.playback.mode === 'preview' || playbackState.playback.mode === 'none') ? (
            <a href={buyUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} aria-label={playbackState.ctaLabel}>
              $
            </a>
          ) : null}
        </div>
        <input
          className="shorts-volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const nextVolume = Number(event.currentTarget.value);
            onVolumeChange(nextVolume);
            if (nextVolume > 0) onMutedChange(false);
          }}
          aria-label="Shorts volume"
        />
        <Link className="shorts-back" to="/" aria-label="Leave Shorts">←</Link>
        <Link className="shorts-deep-link" to={shortsHrefForItem(item, topic)} state={{ item }} aria-label="Current Short permalink" />
      </div>
    </section>
  );
}

export function ShortsPage() {
  const { contentId = '' } = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const stateItem = (location.state as { item?: DiscoverableItem } | null)?.item || null;
  const originHint = normalizeCanonicalOrigin(search.get('origin')) || null;
  const topic = normalizeTopic(search.get('topic'));
  const [items, setItems] = useState<DiscoverableItem[]>(stateItem && isRenderableDiscoveryItem(stateItem) ? [stateItem] : []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const hydratedKeys = useRef<Set<string>>(new Set());

  useShortsSession();

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const queue = await loadShortsRuntimeQueue(topic, contentId || null, originHint, stateItem);
        if (!active) return;
        setItems(queue);
        const selectedIndex = contentId ? queue.findIndex((item) => item.contentId === contentId && (!originHint || normalizeCanonicalOrigin(item.publicOrigin) === originHint)) : 0;
        setActiveIndex(selectedIndex > 0 ? selectedIndex : 0);
        window.requestAnimationFrame(() => {
          const target = sectionRefs.current[selectedIndex > 0 ? selectedIndex : 0];
          target?.scrollIntoView({ block: 'start' });
        });
      } catch (err: unknown) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load Shorts');
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
          .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.75)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!best) return;
        setActiveIndex(Number((best.target as HTMLElement).dataset.index || 0));
      },
      { root, threshold: [0.25, 0.5, 0.75, 0.9] },
    );
    sectionRefs.current.forEach((section) => {
      if (section) observer.observe(section);
    });
    return () => observer.disconnect();
  }, [items]);

  const activeItem = items[activeIndex] || null;
  const activeKey = activeItem ? contentRuntimeItemKey(activeItem) : '';

  useEffect(() => {
    if (!activeItem) return;
    const params = new URLSearchParams({ origin: activeItem.publicOrigin, topic });
    window.history.replaceState(window.history.state, '', `/shorts/${encodeURIComponent(activeItem.contentId)}?${params.toString()}`);
  }, [activeItem, topic]);

  useEffect(() => {
    let active = true;
    if (!activeItem || !activeKey || hydratedKeys.current.has(activeKey)) return;
    hydratedKeys.current.add(activeKey);
    void hydrateCanonicalOfferForItem(activeItem)
      .then((hydrated) => {
        if (!active) return;
        setItems((current) => current.map((item) => (contentRuntimeItemKey(item) === activeKey ? hydrated : item)));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeItem, activeKey]);

  const exploreWork = useCallback((item: DiscoverableItem) => {
    navigate(watchHrefForItem(item), { state: { item } });
  }, [navigate]);

  return (
    <main className="shorts-page bg-black text-white">
      {loading ? <div className="grid h-[100dvh] place-items-center text-zinc-300">Loading Shorts…</div> : null}
      {error ? <div className="grid h-[100dvh] place-items-center p-4 text-red-300">{error}</div> : null}
      {!loading && !error ? (
        <div ref={scrollerRef} className="shorts-scroller" aria-label="Certifyd Shorts">
          {items.map((item, index) => (
            <ShortsSlide
              key={`${item.publicOrigin}:${item.contentId}:${index}`}
              item={item}
              active={index === activeIndex}
              topic={topic}
              muted={muted}
              volume={volume}
              onMutedChange={setMuted}
              onVolumeChange={setVolume}
              onExplore={exploreWork}
              index={index}
              slideRef={(node) => {
                sectionRefs.current[index] = node;
              }}
            />
          ))}
        </div>
      ) : null}
    </main>
  );
}
