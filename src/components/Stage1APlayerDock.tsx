import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import type { DiscoverableItem } from '../lib/types';
import { Stage1APlayerContext } from './stage1APlayerContext';

type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
type PlaybackMode = 'full' | 'preview' | 'none';
type MediaKind = 'audio' | 'video';

type CanonicalPlayback = {
  mode: PlaybackMode;
  streamUrl: string | null;
  previewLimitSeconds: number | null;
  canPlayFull: boolean;
  reason?: string;
};

type CanonicalOffer = Record<string, unknown> & {
  playback?: Partial<CanonicalPlayback> | null;
};

type PlayerItem = {
  title: string;
  creator: string;
  artwork: string;
  buyUrl: string;
  supportLabel: string;
  mediaKind: MediaKind;
  playback: CanonicalPlayback;
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

async function fetchCanonicalOffer(item: DiscoverableItem): Promise<CanonicalOffer | null> {
  const offerUrl = canonicalOfferUrl(item);
  if (!offerUrl) return null;
  const response = await fetch(offerUrl);
  if (!response.ok) throw new Error('Offer unavailable');
  return normalizeOffer(await response.json());
}

function normalizePlayback(offer: CanonicalOffer | null): CanonicalPlayback | null {
  const playback = offer?.playback;
  if (!playback || typeof playback !== 'object') return null;
  const mode = playback.mode === 'full' || playback.mode === 'preview' || playback.mode === 'none' ? playback.mode : 'none';
  const streamUrl = typeof playback.streamUrl === 'string' && playback.streamUrl.trim() ? playback.streamUrl.trim() : null;
  const previewLimitSeconds = Number(playback.previewLimitSeconds);
  return {
    mode,
    streamUrl,
    previewLimitSeconds: Number.isFinite(previewLimitSeconds) && previewLimitSeconds > 0 ? previewLimitSeconds : null,
    canPlayFull: playback.canPlayFull === true,
    reason: typeof playback.reason === 'string' ? playback.reason : undefined,
  };
}

function mediaKind(offer: CanonicalOffer | null, item: DiscoverableItem, streamUrl: string): MediaKind {
  const type = String(offer?.type || offer?.contentType || item.contentType || '').toLowerCase();
  const mime = String(offer?.primaryFileMime || item.primaryFileMime || '').toLowerCase();
  const src = streamUrl.toLowerCase();
  if (type === 'video' || mime.startsWith('video/') || /\.(mp4|webm|mov|m4v)(?:$|[?&#])/.test(src)) return 'video';
  return 'audio';
}

function offerText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function offerSupportLabel(offer: CanonicalOffer | null): string {
  const price = Number(offer?.priceSats || offer?.price_sat || offer?.amountSats || 0);
  return Number.isFinite(price) && price > 0 ? 'Buy' : 'Support';
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

export function Stage1APlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlayerState>('idle');
  const [item, setItem] = useState<PlayerItem | null>(null);
  const [message, setMessage] = useState('Tap Play to start listening');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
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
  }, []);

  const playItem = useCallback(async (nextItem: DiscoverableItem) => {
    clearActiveMedia();
    setState('loading');
    setMessage('Loading');
    setItem({
      title: nextItem.title || 'Untitled',
      creator: nextItem.creatorHandle || 'Creator',
      artwork: nextItem.coverUrl || '',
      buyUrl: nextItem.buyUrl || '#',
      supportLabel: 'Support',
      mediaKind: 'audio',
      playback: { mode: 'none', streamUrl: null, previewLimitSeconds: null, canPlayFull: false },
    });

    try {
      const offer = await fetchCanonicalOffer(nextItem);
      const playback = normalizePlayback(offer);
      const origin = nextItem.publicOrigin;
      const streamUrl = resolveAbsoluteUrl(playback?.streamUrl, origin);
      const buyUrl = resolveAbsoluteUrl(offer?.buyUrl, origin) || nextItem.buyUrl || '#';
      const title = offerText(offer?.title, nextItem.title || 'Untitled');
      const creator = offerText(offer?.creatorHandle, nextItem.creatorHandle || 'Creator');
      const artwork = resolveAbsoluteUrl(offer?.coverUrl, origin) || nextItem.coverUrl || '';

      if (!playback || playback.mode === 'none' || !streamUrl) {
        setItem({
          title,
          creator,
          artwork,
          buyUrl,
          supportLabel: offerSupportLabel(offer),
          mediaKind: 'audio',
          playback: playback || { mode: 'none', streamUrl: null, previewLimitSeconds: null, canPlayFull: false },
        });
        setState('error');
        setMessage('Playback is not available for this item.');
        return;
      }

      setItem({
        title,
        creator,
        artwork,
        buyUrl,
        supportLabel: offerSupportLabel(offer),
        mediaKind: mediaKind(offer, nextItem, streamUrl),
        playback: { ...playback, streamUrl },
      });
      setState('loading');
      setMessage('Loading');
    } catch {
      setState('error');
      setMessage('Could not load playback. Open the support page.');
    }
  }, [clearActiveMedia]);

  useEffect(() => {
    if (!item?.playback.streamUrl || state !== 'loading') return;
    const media = item.mediaKind === 'video' ? videoRef.current : audioRef.current;
    if (!media) return;
    activeMediaRef.current = media;
    media.src = item.playback.streamUrl;
    media.preload = 'metadata';
    const promise = media.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        setState('paused');
        setMessage('Paused');
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

  const contextValue = useMemo(() => ({ playItem }), [playItem]);
  const isIdle = state === 'idle';
  const isPlaying = state === 'playing';
  const canControl = Boolean(item?.playback.streamUrl);
  const displayedTitle = item?.title || '🎵 Certifyd Player';
  const displayedMeta = isIdle ? 'Tap Play to start listening' : message === state ? item?.creator || 'Creator' : message;
  const dockStyle = {
    '--stage1a-video-display': item?.mediaKind === 'video' ? 'block' : 'none',
  } as CSSProperties;

  return (
    <Stage1APlayerContext.Provider value={contextValue}>
      {children}
      <div className={`stage1a-player-dock ${isIdle ? 'stage1a-player-dock-idle' : ''}`} data-state={state} role="region" aria-label="Certifyd player" style={dockStyle}>
        {item?.artwork ? (
          <img src={item.artwork} alt="" className="stage1a-player-art" referrerPolicy="no-referrer" />
        ) : !isIdle ? (
          <div className="stage1a-player-art stage1a-player-art-empty" aria-hidden="true">♪</div>
        ) : null}
        <video
          ref={videoRef}
          className="stage1a-player-video"
          playsInline
          onPlay={() => { endingRef.current = false; setState('playing'); setMessage('Playing'); }}
          onPause={() => { if (!endingRef.current && state !== 'ended' && activeMediaRef.current?.currentTime) { setState('paused'); setMessage('Paused'); } }}
          onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onTimeUpdate={onTimeUpdate}
          onEnded={() => { endingRef.current = true; setState('ended'); setMessage('Ended'); }}
          onError={() => { setState('error'); setMessage('Playback error.'); }}
        />
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
                max={Math.max(duration || 0, progress || 0, 1)}
                step="0.1"
                value={Math.min(progress, Math.max(duration || progress || 1, 1))}
                onChange={(event) => seek(Number(event.currentTarget.value))}
                disabled={!canControl || duration <= 0}
                aria-label="Playback progress"
              />
              <span className="stage1a-player-status">{state[0].toUpperCase()}{state.slice(1)}</span>
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
