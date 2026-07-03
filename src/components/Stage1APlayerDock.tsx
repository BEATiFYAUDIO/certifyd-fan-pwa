import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import type { DiscoverableItem } from '../lib/types';
import { displayStateFromItem, displayStateFromPlayback } from '../lib/playbackDisplay';
import { Stage1APlayerContext, type Stage1APlayerItem, type Stage1APlayerState, type Stage1APlaybackMode } from './stage1APlayerContext';

type MediaKind = 'audio' | 'video';
type MediaAspect = 'landscape' | 'portrait' | 'square' | 'unknown';

type CanonicalPlayback = {
  mode: Stage1APlaybackMode;
  streamUrl: string | null;
  previewLimitSeconds: number | null;
  canPlayFull: boolean;
  reason?: string;
};

type CanonicalOffer = Record<string, unknown> & {
  playback?: Partial<CanonicalPlayback> | null;
};

function normalizeOffer(payload: unknown): CanonicalOffer | null {
  if (!payload || typeof payload !== 'object') return null;
  const maybeOffer = (payload as { offer?: unknown }).offer;
  if (maybeOffer && typeof maybeOffer === 'object') return maybeOffer as CanonicalOffer;
  return payload as CanonicalOffer;
}

function resolveAbsoluteUrl(value: unknown, origin: string): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed, `${origin}/`).toString();
  } catch {
    return '';
  }
}

function canonicalOfferUrl(item: DiscoverableItem): string {
  const fallback = resolveAbsoluteUrl(`/buy/content/${encodeURIComponent(item.contentId)}/offer`, item.publicOrigin);
  return String(item.offerUrl || '').trim() || fallback;
}

function creatorProfileUrl(item: DiscoverableItem, offer: CanonicalOffer | null): string {
  const explicit = resolveAbsoluteUrl(offer?.creatorUrl || offer?.profileUrl, item.publicOrigin);
  if (explicit) return explicit;
  const handle = String(offer?.creatorHandle || item.creatorHandle || '').trim().replace(/^@+/, '');
  if (!handle || !item.publicOrigin) return '';
  return `${String(item.publicOrigin).replace(/\/+$/, '')}/u/${encodeURIComponent(handle)}`;
}

async function fetchCanonicalOffer(item: DiscoverableItem): Promise<CanonicalOffer | null> {
  const fallback = resolveAbsoluteUrl(`/buy/content/${encodeURIComponent(item.contentId)}/offer`, item.publicOrigin);
  const offerUrls = [...new Set([String(item.offerUrl || '').trim(), canonicalOfferUrl(item), fallback].filter(Boolean))];
  let lastError: unknown = null;
  for (const offerUrl of offerUrls) {
    try {
      const response = await fetch(offerUrl);
      if (!response.ok) {
        lastError = new Error(`Offer unavailable: ${response.status}`);
        continue;
      }
      const offer = normalizeOffer(await response.json());
      if (offer) return offer;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Offer unavailable');
}

function normalizePlayback(offer: CanonicalOffer | null): CanonicalPlayback | null {
  const playback = offer?.playback;
  if (playback && typeof playback === 'object') {
    const mode = playback.mode === 'full' || playback.mode === 'preview' || playback.mode === 'none' ? playback.mode : 'none';
    const streamUrl = typeof playback.streamUrl === 'string' && playback.streamUrl.trim() ? playback.streamUrl.trim() : null;
    const previewLimitSeconds = Number(playback.previewLimitSeconds);
    const normalizedPreviewLimitSeconds = Number.isFinite(previewLimitSeconds) && previewLimitSeconds > 0 ? previewLimitSeconds : null;
    return {
      mode,
      streamUrl,
      previewLimitSeconds: mode === 'preview' ? normalizedPreviewLimitSeconds || 20 : normalizedPreviewLimitSeconds,
      canPlayFull: playback.canPlayFull === true,
      reason: typeof playback.reason === 'string' ? playback.reason : undefined,
    };
  }

  if (!offer) return null;
  const fullStreamUrl = [offer.fullMediaUrl, offer.fullContentUrl, offer.mediaUrl, offer.contentUrl]
    .find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  const previewStreamUrl = typeof offer.previewUrl === 'string' && offer.previewUrl.trim() ? offer.previewUrl.trim() : null;
  const accessMode = String(offer.accessMode || '').trim().toLowerCase();
  const price = Number(offer.priceSats || offer.price_sat || offer.amountSats || offer.price || 0);
  const hasFullAccess =
    offer.hasFullAccess === true ||
    offer.owned === true ||
    offer.isFree === true ||
    accessMode === 'owned' ||
    accessMode === 'unlocked' ||
    (Number.isFinite(price) && price === 0);
  const isLocked =
    offer.isLocked === true ||
    accessMode === 'locked' ||
    (Number.isFinite(price) && price > 0 && !hasFullAccess);

  if (isLocked) {
    return {
      mode: previewStreamUrl ? 'preview' : 'none',
      streamUrl: previewStreamUrl,
      previewLimitSeconds: previewStreamUrl ? 20 : null,
      canPlayFull: false,
      reason: previewStreamUrl ? undefined : 'missing-preview-stream',
    };
  }

  if (hasFullAccess) {
    const streamUrl = fullStreamUrl || previewStreamUrl;
    return {
      mode: streamUrl ? 'full' : 'none',
      streamUrl: streamUrl || null,
      previewLimitSeconds: null,
      canPlayFull: Boolean(streamUrl),
      reason: streamUrl ? undefined : 'missing-full-stream',
    };
  }

  return null;
}

function mediaKind(offer: CanonicalOffer | null, item: DiscoverableItem, streamUrl: string): MediaKind {
  const type = String(offer?.type || offer?.contentType || item.contentType || '').toLowerCase();
  const mime = String(offer?.primaryFileMime || item.primaryFileMime || '').toLowerCase();
  const src = streamUrl.toLowerCase();
  if (type === 'video' || mime.startsWith('video/') || /\.(mp4|webm|mov|m4v)(?:$|[?&#])/.test(src)) return 'video';
  return 'audio';
}

function numberFromRecord(record: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function classifyAspect(width: number | null, height: number | null): MediaAspect {
  if (!width || !height) return 'unknown';
  const ratio = width / height;
  if (ratio > 1.18) return 'landscape';
  if (ratio < 0.84) return 'portrait';
  return 'square';
}

function inferMediaAspect(offer: CanonicalOffer | null, item: DiscoverableItem, kind: MediaKind): MediaAspect {
  const offerWidth = numberFromRecord(offer, ['width', 'mediaWidth', 'videoWidth', 'imageWidth', 'coverWidth']);
  const offerHeight = numberFromRecord(offer, ['height', 'mediaHeight', 'videoHeight', 'imageHeight', 'coverHeight']);
  const itemRecord = item as unknown as Record<string, unknown>;
  const itemWidth = numberFromRecord(itemRecord, ['width', 'mediaWidth', 'videoWidth', 'imageWidth', 'coverWidth']);
  const itemHeight = numberFromRecord(itemRecord, ['height', 'mediaHeight', 'videoHeight', 'imageHeight', 'coverHeight']);
  const fromDimensions = classifyAspect(offerWidth || itemWidth, offerHeight || itemHeight);
  if (fromDimensions !== 'unknown') return fromDimensions;
  if (kind === 'video') return 'unknown';
  return 'square';
}

function offerText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function PlayIcon({ playing }: { playing: boolean }) {
  return <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>;
}

function statusLabel(state: Stage1APlayerState): string {
  return state[0].toUpperCase() + state.slice(1);
}

export function Stage1APlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Stage1APlayerState>('idle');
  const [item, setItem] = useState<Stage1APlayerItem | null>(null);
  const [message, setMessage] = useState('Tap Play to start listening');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaAspect, setMediaAspect] = useState<MediaAspect>('square');
  const [freeDropQueue, setFreeDropQueueState] = useState<DiscoverableItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeMediaRef = useRef<HTMLMediaElement | null>(null);
  const endingRef = useRef(false);

  useEffect(() => {
    document.body.classList.add('has-stage1a-player');
    return () => document.body.classList.remove('has-stage1a-player');
  }, []);

  const clearActiveMedia = useCallback(() => {
    const current = activeMediaRef.current;
    if (current) {
      try { current.pause(); } catch { /* ignore */ }
      current.removeAttribute('src');
      try { current.load(); } catch { /* ignore */ }
    }
    activeMediaRef.current = null;
    endingRef.current = false;
    setProgress(0);
    setDuration(0);
    setMediaAspect('square');
  }, []);

  const playItem = useCallback(async (nextItem: DiscoverableItem) => {
    clearActiveMedia();
    setState('loading');
    setMessage('Loading');
    const initialDisplayState = displayStateFromItem(nextItem);
    setItem({
      contentId: nextItem.contentId,
      publicOrigin: nextItem.publicOrigin,
      title: nextItem.title || 'Untitled',
      creator: nextItem.creatorHandle || 'Creator',
      artwork: nextItem.coverUrl || '',
      buyUrl: nextItem.buyUrl || '#',
      creatorUrl: creatorProfileUrl(nextItem, null),
      supportLabel: initialDisplayState.ctaLabel,
      commerceState: initialDisplayState.state,
      playbackLabel: initialDisplayState.label,
      mediaKind: 'audio',
      playback: { mode: 'none', streamUrl: null, previewLimitSeconds: null, canPlayFull: false },
    });
    setMediaAspect('square');

    try {
      const offer = await fetchCanonicalOffer(nextItem);
      const playback = normalizePlayback(offer);
      const origin = nextItem.publicOrigin;
      const streamUrl = resolveAbsoluteUrl(playback?.streamUrl, origin);
      const buyUrl = resolveAbsoluteUrl(offer?.buyUrl, origin) || nextItem.buyUrl || '#';
      const title = offerText(offer?.title, nextItem.title || 'Untitled');
      const creator = offerText(offer?.creatorHandle, nextItem.creatorHandle || 'Creator');
      const artwork = resolveAbsoluteUrl(offer?.coverUrl, origin) || nextItem.coverUrl || '';
      const creatorUrl = creatorProfileUrl(nextItem, offer);
      const displayState = playback
        ? displayStateFromPlayback(playback, offer)
        : { state: 'unavailable' as const, label: 'UNAVAILABLE', ctaLabel: 'Support Creator' };

      if (!playback || playback.mode === 'none' || !streamUrl) {
        setItem({
          contentId: nextItem.contentId,
          publicOrigin: nextItem.publicOrigin,
          title,
          creator,
          artwork,
          buyUrl,
          creatorUrl,
          supportLabel: displayState.ctaLabel,
          commerceState: displayState.state,
          playbackLabel: displayState.label,
          mediaKind: 'audio',
          playback: playback || { mode: 'none', streamUrl: null, previewLimitSeconds: null, canPlayFull: false },
        });
        setState('error');
        setMessage('Playback is not available for this item.');
        return;
      }

      const nextMediaKind = mediaKind(offer, nextItem, streamUrl);
      setMediaAspect(inferMediaAspect(offer, nextItem, nextMediaKind));
      setItem({
        contentId: nextItem.contentId,
        publicOrigin: nextItem.publicOrigin,
        title,
        creator,
        artwork,
        buyUrl,
        creatorUrl,
        supportLabel: displayState.ctaLabel,
        commerceState: displayState.state,
        playbackLabel: displayState.label,
        mediaKind: nextMediaKind,
        playback: { ...playback, streamUrl },
      });
      setState('loading');
      setMessage('Loading');
    } catch {
      setState('error');
      setMessage('Could not load playback. Open the support page.');
    }
  }, [clearActiveMedia]);

  const setFreeDropQueue = useCallback((items: DiscoverableItem[]) => {
    const seen = new Set<string>();
    const nextQueue = items.filter((queueItem) => {
      const key = `${queueItem.publicOrigin}::${queueItem.contentId}`;
      if (!queueItem.contentId || !queueItem.publicOrigin || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setFreeDropQueueState(nextQueue);
  }, []);

  useLayoutEffect(() => {
    if (!item?.playback.streamUrl || state !== 'loading') return;
    const media = item.mediaKind === 'video' ? videoRef.current : audioRef.current;
    if (!media) return;
    activeMediaRef.current = media;
    media.src = item.playback.streamUrl;
    media.preload = 'metadata';
    try { media.load(); } catch { /* ignore */ }
    const promise = media.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        setState('paused');
        setMessage('Tap play to start. Your browser blocked automatic audio.');
      });
    }
  }, [item, state]);

  const onTimeUpdate = useCallback((event: SyntheticEvent<HTMLMediaElement>) => {
    const media = event.currentTarget;
    setProgress(media.currentTime || 0);
    setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    const limit = item?.playback.mode === 'preview' ? item.playback.previewLimitSeconds : null;
    if (!limit || media.currentTime < limit) return;
    endingRef.current = true;
    try { media.pause(); } catch { /* ignore */ }
    try { media.currentTime = Math.max(0, limit); } catch { /* ignore */ }
    setState('ended');
    setMessage('Preview ended. Support the creator for full access.');
  }, [item]);

  const togglePlay = useCallback(() => {
    const media = activeMediaRef.current;
    if (!media || !item?.playback.streamUrl) return;
    if (media.paused) {
      const promise = media.play();
      if (promise && typeof promise.catch === 'function') promise.catch(() => setState('paused'));
    } else {
      media.pause();
    }
  }, [item]);

  const seek = useCallback((value: number) => {
    const media = activeMediaRef.current;
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
    try { media.currentTime = value; } catch { /* ignore */ }
  }, []);

  const resetIdle = useCallback(() => {
    clearActiveMedia();
    setItem(null);
    setState('idle');
    setMessage('Tap Play to start listening');
  }, [clearActiveMedia]);

  const currentFreeDropIndex = useMemo(() => {
    if (!item) return -1;
    return freeDropQueue.findIndex((queueItem) => queueItem.contentId === item.contentId && queueItem.publicOrigin === item.publicOrigin);
  }, [freeDropQueue, item]);

  const playNextFreeDrop = useCallback(() => {
    if (currentFreeDropIndex < 0 || currentFreeDropIndex >= freeDropQueue.length - 1) return;
    void playItem(freeDropQueue[currentFreeDropIndex + 1]);
  }, [currentFreeDropIndex, freeDropQueue, playItem]);

  const playPreviousFreeDrop = useCallback(() => {
    if (currentFreeDropIndex <= 0) return;
    void playItem(freeDropQueue[currentFreeDropIndex - 1]);
  }, [currentFreeDropIndex, freeDropQueue, playItem]);

  const canPlayNextFreeDrop = currentFreeDropIndex >= 0 && currentFreeDropIndex < freeDropQueue.length - 1;
  const canPlayPreviousFreeDrop = currentFreeDropIndex > 0;

  const contextValue = useMemo(() => ({
    playItem,
    setFreeDropQueue,
    togglePlay,
    playNextFreeDrop,
    playPreviousFreeDrop,
    seek,
    resetIdle,
    state,
    item,
    message,
    progress,
    duration,
    canPlayNextFreeDrop,
    canPlayPreviousFreeDrop,
  }), [canPlayNextFreeDrop, canPlayPreviousFreeDrop, duration, item, message, playItem, playNextFreeDrop, playPreviousFreeDrop, progress, resetIdle, seek, setFreeDropQueue, state, togglePlay]);
  const isIdle = state === 'idle';
  const isPlaying = state === 'playing';
  const canControl = Boolean(item?.playback.streamUrl);
  const displayedTitle = item?.title || 'Certifyd Player';
  const displayedMeta = isIdle ? 'Tap Play to start listening' : `${item?.playbackLabel || 'READY'} · ${message === state ? item?.creator || 'Creator' : message}`;
  const progressMax = Math.max(duration || 0, progress || 0, 1);
  const progressValue = Math.min(progress, Math.max(duration || progress || 1, 1));
  const visualAspectClass = `stage1a-rich-visual-${mediaAspect}`;

  return (
    <Stage1APlayerContext.Provider value={contextValue}>
      {children}
      <aside className={`stage1a-rich-player ${isIdle ? 'stage1a-rich-player-idle' : ''}`} data-state={state} aria-label="Now Playing">
        <div className="stage1a-rich-kicker">Now Playing</div>
        <div className={`stage1a-rich-visual ${item?.mediaKind === 'video' ? 'stage1a-rich-visual-video' : 'stage1a-rich-visual-artwork'} ${visualAspectClass}`}>
          {item?.mediaKind === 'video' ? (
            <video
              ref={videoRef}
              className="stage1a-player-video"
              playsInline
              onPlay={() => { endingRef.current = false; setState('playing'); setMessage('Playing'); }}
              onPause={() => { if (!endingRef.current && state !== 'ended' && activeMediaRef.current?.currentTime) { setState('paused'); setMessage('Paused'); } }}
              onLoadedMetadata={(event) => {
                setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
                setMediaAspect(classifyAspect(event.currentTarget.videoWidth, event.currentTarget.videoHeight));
              }}
              onTimeUpdate={onTimeUpdate}
              onEnded={() => { endingRef.current = true; setState('ended'); setMessage('Ended'); }}
              onError={() => { setState('error'); setMessage('Playback error.'); }}
            />
          ) : item?.artwork ? (
            <img
              src={item.artwork}
              alt=""
              className="stage1a-rich-artwork"
              referrerPolicy="no-referrer"
              onLoad={(event) => setMediaAspect(classifyAspect(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight))}
            />
          ) : (
            <div className="stage1a-rich-empty" aria-hidden="true">CERTIFYD</div>
          )}
          {item?.mediaKind !== 'video' ? (
            <audio
              ref={audioRef}
              className="stage1a-player-audio"
              onPlay={() => { endingRef.current = false; setState('playing'); setMessage('Playing'); }}
              onPause={() => { if (!endingRef.current && state !== 'ended' && activeMediaRef.current?.currentTime) { setState('paused'); setMessage('Paused'); } }}
              onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
              onTimeUpdate={onTimeUpdate}
              onEnded={() => { endingRef.current = true; setState('ended'); setMessage('Ended'); }}
              onError={() => { setState('error'); setMessage('Playback error.'); }}
            />
          ) : null}
        </div>
        <div className="stage1a-rich-copy">
          <div className="stage1a-rich-title">{item?.title || 'Certifyd Player'}</div>
          <div className="stage1a-rich-creator">{isIdle ? 'Choose a work to start playback.' : `@${item?.creator || 'creator'}`}</div>
          <div className="stage1a-rich-state">
            <span>{item?.playbackLabel || 'READY'}</span>
            <span>{statusLabel(state)}</span>
          </div>
        </div>
        {!isIdle ? (
          <>
            <div className="stage1a-rich-controls">
              <button type="button" className="stage1a-rich-nav" onClick={playPreviousFreeDrop} disabled={!canPlayPreviousFreeDrop} aria-label="Previous Free Drop">‹</button>
              <button type="button" className="stage1a-rich-play" onClick={togglePlay} disabled={!canControl} aria-label="Play or pause">
                <PlayIcon playing={isPlaying} />
              </button>
              <button type="button" className="stage1a-rich-nav" onClick={playNextFreeDrop} disabled={!canPlayNextFreeDrop} aria-label="Next Free Drop">›</button>
            </div>
            <div className="stage1a-rich-progress-row">
              <span>{formatTime(progress)}</span>
              <input
                className="stage1a-rich-progress"
                type="range"
                min={0}
                max={progressMax}
                step="0.1"
                value={progressValue}
                onChange={(event) => seek(Number(event.currentTarget.value))}
                disabled={!canControl || duration <= 0}
                aria-label="Playback progress"
              />
              <span>{formatTime(duration)}</span>
            </div>
            {message ? <p className="stage1a-rich-message">{message}</p> : null}
            <div className="stage1a-rich-actions">
              <a className="stage1a-rich-support" href={item?.buyUrl || '#'} target="_blank" rel="noreferrer">
                {item?.supportLabel || 'Support Creator'}
              </a>
              {item?.creatorUrl ? (
                <a className="stage1a-rich-creator-link" href={item.creatorUrl} target="_blank" rel="noreferrer">
                  Visit Creator
                </a>
              ) : null}
            </div>
            <div className="stage1a-rich-links" aria-label="Work details">
              <a href={item?.buyUrl || '#'} target="_blank" rel="noreferrer">Credits & Contributors</a>
              <a href={item?.buyUrl || '#'} target="_blank" rel="noreferrer">Proofs & Receipts</a>
              <a href={item?.buyUrl || '#'} target="_blank" rel="noreferrer">About This Work</a>
            </div>
          </>
        ) : null}
      </aside>
      <div className={`stage1a-player-dock ${isIdle ? 'stage1a-player-dock-idle' : ''}`} data-state={state} role="region" aria-label="Certifyd transport">
        {item?.artwork ? (
          <img src={item.artwork} alt="" className="stage1a-player-art" referrerPolicy="no-referrer" />
        ) : !isIdle ? (
          <div className="stage1a-player-art stage1a-player-art-empty" aria-hidden="true">♪</div>
        ) : null}
        <div className="stage1a-player-main">
          <div className="stage1a-player-title">{displayedTitle}</div>
          <div className="stage1a-player-meta">{displayedMeta}</div>
          {!isIdle ? (
            <div className="stage1a-player-controls">
              <button type="button" className="stage1a-player-button" onClick={togglePlay} disabled={!canControl} aria-label="Play or pause">
                <PlayIcon playing={isPlaying} />
              </button>
              <input
                className="stage1a-player-progress"
                type="range"
                min={0}
                max={progressMax}
                step="0.1"
                value={progressValue}
                onChange={(event) => seek(Number(event.currentTarget.value))}
                disabled={!canControl || duration <= 0}
                aria-label="Playback progress"
              />
              <span className="stage1a-player-status">{statusLabel(state)}</span>
              <span className="stage1a-player-time">{formatTime(progress)} / {formatTime(duration)}</span>
              <a className="stage1a-player-support" href={item?.buyUrl || '#'} target="_blank" rel="noreferrer">
                {item?.supportLabel || 'Support'}
              </a>
            </div>
          ) : null}
        </div>
        {!isIdle ? (
          <button type="button" className="stage1a-player-clear" onClick={resetIdle} aria-label="Clear player">×</button>
        ) : null}
      </div>
    </Stage1APlayerContext.Provider>
  );
}
