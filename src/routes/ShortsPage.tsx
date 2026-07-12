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
  activeGeneration,
  muted,
  onMutedChange,
  onExplore,
  onBack,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  slideRef,
  index,
}: {
  item: DiscoverableItem;
  active: boolean;
  topic: Topic;
  activeGeneration: number;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onExplore: (item: DiscoverableItem) => void;
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  slideRef: (node: HTMLElement | null) => void;
  index: number;
}) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const playAttemptRef = useRef(0);
  const [paused, setPaused] = useState(true);
  const [ended, setEnded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaAspectState, setMediaAspectState] = useState<{
    sourceKey: string;
    aspect: 'portrait' | 'landscape' | 'square' | 'unknown';
  }>({ sourceKey: '', aspect: 'unknown' });
  const [posterAspectState, setPosterAspectState] = useState<{
    sourceKey: string;
    aspect: 'portrait' | 'landscape' | 'square' | 'unknown';
  }>({ sourceKey: '', aspect: 'unknown' });
  const playbackState = useMemo(() => resolveRuntimePlayback(item), [item]);
  const activeMediaSrc = active ? playbackState.streamUrl : '';
  const mediaSourceKey = activeMediaSrc || item.coverUrl || '';
  const mediaAspect = mediaAspectState.sourceKey === mediaSourceKey ? mediaAspectState.aspect : 'unknown';
  const posterAspect = posterAspectState.sourceKey === item.coverUrl ? posterAspectState.aspect : 'unknown';
  const videoPosterUrl = posterAspect === 'portrait' ? undefined : item.coverUrl || undefined;
  const creatorProfileUrl = canonicalCreatorProfileUrlForItem(item);
  const buyUrl = buyUrlWithFanReturnUrl(item.buyUrl, item);
  const themeVars = useMemo(() => getCardThemeVars(item.profileTheme), [item.profileTheme]);
  const isMediaPlayable = Boolean(playbackState.streamUrl && (playbackState.renderKind === 'video' || playbackState.renderKind === 'audio'));

  const classifyAspect = (width: number, height: number): 'portrait' | 'landscape' | 'square' | 'unknown' => {
    if (!width || !height) return 'unknown';
    const ratio = width / height;
    if (ratio < 0.8) return 'portrait';
    if (ratio > 1.2) return 'landscape';
    return 'square';
  };

  const setIntrinsicAspect = (width: number, height: number) => {
    setMediaAspectState({
      sourceKey: mediaSourceKey,
      aspect: classifyAspect(width, height),
    });
  };

  useEffect(() => {
    if (!item.coverUrl) return undefined;
    let cancelled = false;
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if (cancelled) return;
      setPosterAspectState({
        sourceKey: item.coverUrl,
        aspect: classifyAspect(image.naturalWidth, image.naturalHeight),
      });
    };
    image.src = item.coverUrl;
    return () => {
      cancelled = true;
    };
  }, [item.coverUrl]);

  const isCurrentGeneration = useCallback(() => activeRef.current && generationRef.current === activeGeneration, [activeGeneration]);

  useEffect(() => {
    activeRef.current = active;
    if (active) generationRef.current = activeGeneration;
  }, [active, activeGeneration]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.muted = muted;
  }, [muted]);

  useEffect(() => {
    const media = mediaRef.current;
    const generation = activeGeneration;
    if (!media) return undefined;
    media.muted = muted;
    media.volume = 1;
    if (!active || !playbackState.streamUrl) {
      try { media.pause(); } catch { /* ignore */ }
      queueMicrotask(() => {
        if (!activeRef.current) {
          setPaused(true);
          setEnded(false);
          setProgress(0);
        }
      });
      return undefined;
    }
    media.setAttribute('playsinline', 'true');
    media.preload = 'auto';
    queueMicrotask(() => {
      if (generationRef.current === generation) setEnded(false);
    });
    const playAttempt = playAttemptRef.current + 1;
    playAttemptRef.current = playAttempt;
    const playPromise = media.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          if (generationRef.current !== generation || playAttemptRef.current !== playAttempt) return;
          setPaused(false);
        })
        .catch(() => {
          if (generationRef.current !== generation || playAttemptRef.current !== playAttempt) return;
          setPaused(true);
        });
    }
    return () => {
      if (generationRef.current === generation) playAttemptRef.current += 1;
      try { media.pause(); } catch { /* ignore */ }
    };
  }, [active, activeGeneration, muted, playbackState.streamUrl]);

  const togglePlayback = () => {
    const media = mediaRef.current;
    if (!media || !isMediaPlayable || !active) return;
    if (media.paused) {
      const playAttempt = playAttemptRef.current + 1;
      playAttemptRef.current = playAttempt;
      const generation = activeGeneration;
      const playPromise = media.play();
      setPaused(false);
      setEnded(false);
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          if (generationRef.current === generation && playAttemptRef.current === playAttempt) setPaused(true);
        });
      }
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

  const effectiveDuration = playbackState.playback.mode === 'preview' && playbackState.playback.previewLimitSeconds
    ? Math.min(duration || playbackState.playback.previewLimitSeconds, playbackState.playback.previewLimitSeconds)
    : duration;

  const onLoadedMetadata = (media: HTMLMediaElement) => {
    if (!isCurrentGeneration()) return;
    const limit = playbackState.playback.mode === 'preview' ? playbackState.playback.previewLimitSeconds : null;
    const mediaDuration = Number.isFinite(media.duration) ? media.duration : 0;
    setDuration(limit && mediaDuration ? Math.min(mediaDuration, limit) : limit || mediaDuration || 0);
  };

  const onTimeUpdate = () => {
    const media = mediaRef.current;
    if (!media || !isCurrentGeneration()) return;
    const limit = playbackState.playback.mode === 'preview' ? playbackState.playback.previewLimitSeconds : null;
    setProgress(limit ? Math.min(media.currentTime, limit) : media.currentTime);
    if (!limit || media.currentTime < limit) return;
    try { media.pause(); } catch { /* ignore */ }
    try { media.currentTime = Math.max(0, limit); } catch { /* ignore */ }
    setPaused(true);
    setEnded(true);
  };

  const seekTo = (value: number) => {
    const media = mediaRef.current;
    if (!media || !isMediaPlayable || !active) return;
    const max = effectiveDuration || duration || 0;
    const nextTime = max > 0 ? Math.min(Math.max(0, value), max) : 0;
    try { media.currentTime = nextTime; } catch { /* ignore */ }
    setProgress(nextTime);
    setEnded(false);
  };

  const formatTime = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return '0:00';
    const total = Math.floor(value);
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  const mediaSurface = (() => {
    if (playbackState.renderKind === 'video' && playbackState.streamUrl) {
      return (
        <video
          ref={(node) => { mediaRef.current = node; }}
          className={`shorts-media shorts-media-${mediaAspect}`}
          src={activeMediaSrc || undefined}
          poster={videoPosterUrl}
          muted={muted}
          autoPlay={active}
          playsInline
          preload={active ? 'auto' : 'metadata'}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            onLoadedMetadata(video);
            setIntrinsicAspect(video.videoWidth, video.videoHeight);
          }}
          onPlay={() => { if (isCurrentGeneration()) { setPaused(false); setEnded(false); } }}
          onPause={() => { if (isCurrentGeneration()) setPaused(true); }}
          onEnded={() => { if (isCurrentGeneration()) { setPaused(true); setEnded(true); } }}
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
            src={activeMediaSrc || undefined}
            muted={muted}
            autoPlay={active}
            preload={active ? 'auto' : 'metadata'}
            onLoadedMetadata={(event) => onLoadedMetadata(event.currentTarget)}
            onPlay={() => { if (isCurrentGeneration()) { setPaused(false); setEnded(false); } }}
            onPause={() => { if (isCurrentGeneration()) setPaused(true); }}
            onEnded={() => { if (isCurrentGeneration()) { setPaused(true); setEnded(true); } }}
            onTimeUpdate={onTimeUpdate}
          />
        </div>
      );
    }
    if (item.coverUrl) {
      return (
        <img
          className={`shorts-media shorts-media-${mediaAspect}`}
          src={item.coverUrl}
          alt={item.title || 'Short'}
          loading={active ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(event) => setIntrinsicAspect(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
        />
      );
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
    <section ref={slideRef} className="watch-shell shorts-slide" style={themeVars as CSSProperties} data-index={index} data-active={active ? 'true' : 'false'} data-short-id={item.contentId}>
      <div className="shorts-slide-surface">
        <div
          className="shorts-media-surface"
          onClick={togglePlayback}
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
        <div className="shorts-desktop-transport" aria-label="Shorts transport controls">
          <button type="button" onClick={(event) => { event.stopPropagation(); onPrevious(); }} disabled={!canPrevious} aria-label="Previous Short">‹</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); togglePlayback(); }} disabled={!isMediaPlayable} aria-label={paused ? 'Play Short' : 'Pause Short'}>{paused ? '▶' : 'Ⅱ'}</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onNext(); }} disabled={!canNext} aria-label="Next Short">›</button>
        </div>
        <div className="shorts-actions" aria-label="Short actions">
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
        <div className="shorts-scrubber" onClick={(event) => event.stopPropagation()}>
          <span>{formatTime(progress)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(0, effectiveDuration || 0)}
            step="0.1"
            value={Math.min(progress, effectiveDuration || progress || 0)}
            disabled={!isMediaPlayable || !effectiveDuration}
            onChange={(event) => seekTo(Number(event.currentTarget.value))}
            aria-label="Shorts playback progress"
          />
          <span>{formatTime(effectiveDuration || 0)}</span>
        </div>
        <button type="button" className="shorts-back" onClick={onBack} aria-label="Leave Shorts">
          <span aria-hidden="true">←</span>
          <span>Back</span>
        </button>
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
  const freeOnly = search.get('free') === '1';
  const [items, setItems] = useState<DiscoverableItem[]>(stateItem && isRenderableDiscoveryItem(stateItem) ? [stateItem] : []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [activeGeneration, setActiveGeneration] = useState(1);
  const activeIndexRef = useRef(0);
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
        const queue = await loadShortsRuntimeQueue(topic, contentId || null, originHint, stateItem, { freeOnly });
        if (!active) return;
        const selectedIndex = contentId ? queue.findIndex((item) => item.contentId === contentId && (!originHint || normalizeCanonicalOrigin(item.publicOrigin) === originHint)) : 0;
        const nextIndex = selectedIndex > 0 ? selectedIndex : 0;
        setItems(queue);
        activeIndexRef.current = nextIndex;
        setActiveGeneration((current) => current + 1);
        setActiveIndex(nextIndex);
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
  }, [contentId, freeOnly, originHint, stateItem, topic]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.75)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!best) return;
        const nextIndex = Number((best.target as HTMLElement).dataset.index || 0);
        if (Number.isNaN(nextIndex) || nextIndex === activeIndexRef.current) return;
        activeIndexRef.current = nextIndex;
        setActiveGeneration((current) => current + 1);
        setActiveIndex(nextIndex);
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
    if (freeOnly) params.set('free', '1');
    window.history.replaceState(window.history.state, '', `/shorts/${encodeURIComponent(activeItem.contentId)}?${params.toString()}`);
  }, [activeItem, freeOnly, topic]);

  useEffect(() => {
    let active = true;
    if (!activeItem || !activeKey || hydratedKeys.current.has(activeKey)) return;
    hydratedKeys.current.add(activeKey);
    void hydrateCanonicalOfferForItem(activeItem)
      .then((hydrated) => {
        if (!active) return;
        setItems((current) => current.map((item) => (contentRuntimeItemKey(item) === activeKey ? hydrated : item)));
      })
      .catch(() => undefined)
    return () => {
      active = false;
    };
  }, [activeItem, activeKey]);

  const exploreWork = useCallback((item: DiscoverableItem) => {
    navigate(watchHrefForItem(item), { state: { item } });
  }, [navigate]);
  const leaveShorts = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/');
  }, [navigate]);

  const activateIndex = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= items.length || nextIndex === activeIndexRef.current) return;
    activeIndexRef.current = nextIndex;
    setActiveGeneration((current) => current + 1);
    setActiveIndex(nextIndex);
    sectionRefs.current[nextIndex]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [items.length]);

  const playPreviousShort = useCallback(() => activateIndex(activeIndexRef.current - 1), [activateIndex]);
  const playNextShort = useCallback(() => activateIndex(activeIndexRef.current + 1), [activateIndex]);

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
              activeGeneration={index === activeIndex ? activeGeneration : 0}
              muted={muted}
              onMutedChange={setMuted}
              onExplore={exploreWork}
              onBack={leaveShorts}
              onPrevious={playPreviousShort}
              onNext={playNextShort}
              canPrevious={activeIndex > 0}
              canNext={activeIndex < items.length - 1}
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
