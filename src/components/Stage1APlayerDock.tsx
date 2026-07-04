import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent, type TouchEvent } from 'react';
import { fetchContentContext } from '../lib/api';
import type { ContentContextWork, DiscoverableItem } from '../lib/types';
import { fetchCanonicalOfferPayload } from '../lib/offerFetch';
import { creatorFromItem, useLocalLibrary } from '../lib/localLibrary';
import { displayStateFromItem, displayStateFromPlayback } from '../lib/playbackDisplay';
import { rememberReceiptProofForItem, withReceiptProofs } from '../lib/receiptProofs';
import { Stage1APlayerContext, type Stage1APlayerDrawerContent, type Stage1APlayerDrawerPanel, type Stage1APlayerItem, type Stage1APlayerMediaAspect, type Stage1APlayerState, type Stage1APlaybackMode } from './stage1APlayerContext';

type MediaKind = 'audio' | 'video';
type MediaAspect = Stage1APlayerMediaAspect;
type DetailPanel = Stage1APlayerDrawerPanel;

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

const RECENT_ITEMS_STORAGE_KEY = 'certifyd-player:recent-items:v1';
const AUTOPLAY_STORAGE_KEY = 'certifyd-player:autoplay-next:v1';
const MAX_RECENT_ITEMS = 24;

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
  const baseOfferUrls = [...new Set([String(item.offerUrl || '').trim(), canonicalOfferUrl(item), fallback].filter(Boolean))];
  const offerUrls = baseOfferUrls.flatMap((offerUrl) => withReceiptProofs(offerUrl, item));
  return normalizeOffer(await fetchCanonicalOfferPayload(offerUrls));
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

function firstText(record: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function mediaKind(offer: CanonicalOffer | null, item: DiscoverableItem, streamUrl: string): MediaKind {
  const itemRecord = item as unknown as Record<string, unknown>;
  const playbackRecord = offer?.playback && typeof offer.playback === 'object' ? offer.playback as Record<string, unknown> : null;
  const type = [
    firstText(playbackRecord, ['mediaKind', 'mediaType', 'type', 'contentType', 'kind']),
    firstText(offer, ['mediaKind', 'mediaType', 'type', 'contentType', 'kind', 'fileType']),
    item.contentType,
  ].join(' ').toLowerCase();
  const mime = [
    firstText(playbackRecord, ['mime', 'mimeType', 'contentType', 'streamMimeType']),
    firstText(offer, ['mime', 'mimeType', 'primaryFileMime', 'fileMime', 'streamMimeType']),
    item.primaryFileMime || '',
  ].join(' ').toLowerCase();
  const urlHints = [
    streamUrl,
    firstText(playbackRecord, ['streamUrl', 'url']),
    firstText(offer, ['previewUrl', 'fullMediaUrl', 'fullContentUrl', 'mediaUrl', 'contentUrl', 'coverUrl']),
    firstText(itemRecord, ['previewUrl', 'fullMediaUrl', 'fullContentUrl', 'mediaUrl', 'contentUrl', 'coverUrl']),
  ].join(' ').toLowerCase();
  if (
    /\b(video|movie|film|short|reel|visualizer|mp4|webm|mov|m4v)\b/.test(type) ||
    mime.includes('video/') ||
    /\.(mp4|webm|mov|m4v)(?:$|[?&#\s])/.test(urlHints) ||
    /(?:format|mime|type)=video/.test(urlHints)
  ) {
    return 'video';
  }
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

function connectedLabelsFromItem(item: DiscoverableItem): string[] {
  const labels = new Set<string>();
  for (const badge of item.relationshipBadges || []) {
    const value = String(badge || '').trim();
    if (value) labels.add(value);
  }
  if (item.relationshipReason) labels.add(item.relationshipReason);
  const summary = item.relationshipSummary || {};
  if (summary.relatedWorkCount) labels.add(`${summary.relatedWorkCount} related works`);
  if (summary.connectedCreatorCount) labels.add(`${summary.connectedCreatorCount} connected creators`);
  if (summary.splitParticipantCount) labels.add(`${summary.splitParticipantCount} collaborators`);
  if (summary.derivedFromCount) labels.add(`${summary.derivedFromCount} source works`);
  if (summary.attributionLabel && summary.attributionLabel !== 'unknown') labels.add(String(summary.attributionLabel));
  if (summary.lineageLabel && summary.lineageLabel !== 'unknown') labels.add(String(summary.lineageLabel).replace(/_/g, ' '));
  return [...labels].slice(0, 4);
}

function detailLabelsFromItem(item: DiscoverableItem, offer: CanonicalOffer | null, playback: CanonicalPlayback | null): string[] {
  const labels = new Set<string>();
  const contentType = offerText(offer?.contentType || offer?.type, item.contentType || '').replace(/_/g, ' ');
  const topic = offerText(offer?.primaryTopic, item.primaryTopic || '').replace(/_/g, ' ');
  const priceSats = Number(offer?.priceSats || offer?.price_sat || offer?.amountSats || item.priceSats || 0);
  const accessMode = offerText(offer?.accessMode, item.accessMode || '').replace(/_/g, ' ');
  const proof = item.paymentAccessProof;

  if (contentType) labels.add(contentType);
  if (topic) labels.add(topic);
  if (Number.isFinite(priceSats) && priceSats > 0) labels.add(`${Math.round(priceSats).toLocaleString()} sats`);
  if (accessMode && accessMode !== 'unlocked') labels.add(accessMode);
  if (playback?.mode === 'preview' && playback.previewLimitSeconds) labels.add(`${playback.previewLimitSeconds} sec preview`);
  if (proof?.paymentState) labels.add(`payment ${proof.paymentState}`);
  if (proof?.entitlementState) labels.add(`entitlement ${proof.entitlementState}`);
  if (item.hasLockedSplitSnapshot) labels.add('receipt protected');
  if (item.attributionLabel && item.attributionLabel !== 'unknown') labels.add(String(item.attributionLabel).replace(/_/g, ' '));
  if (item.lineageLabel && item.lineageLabel !== 'unknown') labels.add(String(item.lineageLabel).replace(/_/g, ' '));
  return [...labels].slice(0, 6);
}

function creditLabelsFromItem(item: DiscoverableItem): string[] {
  const labels = new Set<string>();
  const creator = String(item.creatorHandle || '').trim().replace(/^@+/, '');
  if (creator) labels.add(`Creator: @${creator}`);
  for (const contributor of item.contributors || []) {
    const name = contributor.displayName || contributor.handle || 'Contributor';
    const handle = contributor.handle ? `@${String(contributor.handle).replace(/^@+/, '')}` : '';
    const role = contributor.role || 'contributor';
    const sharePercent = (contributor as Record<string, unknown>).sharePercent;
    const share = sharePercent != null ? ` · ${sharePercent}%` : '';
    labels.add(`${name}${handle ? ` ${handle}` : ''} · ${role}${share}`);
  }
  if (item.attributionLabel && item.attributionLabel !== 'unknown') labels.add(`Attribution: ${String(item.attributionLabel).replace(/_/g, ' ')}`);
  if (item.lineageLabel && item.lineageLabel !== 'unknown') labels.add(`Lineage: ${String(item.lineageLabel).replace(/_/g, ' ')}`);
  return [...labels].slice(0, 8);
}

function proofLabelsFromItem(item: DiscoverableItem, offer: CanonicalOffer | null): string[] {
  const labels = new Set<string>();
  labels.add(`Content ID: ${item.contentId}`);
  if (item.publicOrigin) labels.add(`Origin: ${item.publicOrigin}`);
  if (item.offerUrl) labels.add(`Offer: ${item.offerUrl}`);
  if (item.buyUrl) labels.add(`Buy page: ${item.buyUrl}`);
  if (item.paymentAccessProof?.paymentState) labels.add(`Payment: ${item.paymentAccessProof.paymentState}`);
  if (item.paymentAccessProof?.entitlementState) labels.add(`Entitlement: ${item.paymentAccessProof.entitlementState}`);
  if (item.paymentAccessProof?.paymentReceiptId) labels.add(`Receipt: ${item.paymentAccessProof.paymentReceiptId}`);
  const offerRecord = offer || {};
  for (const key of [
    'accessMode',
    'entitlementState',
    'paymentState',
    'receiptId',
    'paymentReceiptId',
    'receiptCode',
    'creatorNodeId',
    'creatorNode',
    'manifestHash',
    'manifest_hash',
    'proofVersion',
    'proof_version',
    'provenanceHash',
    'provenance_hash',
    'publishedAt',
    'published_at',
    'invoiceProviderNodeId',
    'invoice_provider_node_id',
  ]) {
    const value = offerRecord[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      labels.add(`${key.replace(/_/g, ' ')}: ${String(value).trim()}`);
    }
  }
  return [...labels].slice(0, 10);
}

function safeRecentItemsFromStorage(): DiscoverableItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_ITEMS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is DiscoverableItem => Boolean(row?.contentId && row?.publicOrigin)).slice(0, MAX_RECENT_ITEMS);
  } catch {
    return [];
  }
}

function writeRecentItemsToStorage(items: DiscoverableItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_ITEMS_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT_ITEMS)));
  } catch {
    /* ignore storage failures */
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function PlayIcon({ playing }: { playing: boolean }) {
  return <span className={`stage1a-play-icon ${playing ? 'stage1a-play-icon-pause' : 'stage1a-play-icon-play'}`} aria-hidden="true" />;
}

function statusLabel(state: Stage1APlayerState): string {
  return state[0].toUpperCase() + state.slice(1);
}

function contextWorkToDiscoverable(work: ContentContextWork, fallbackOrigin: string): DiscoverableItem | null {
  const publicOrigin = work.creator?.publicOrigin || fallbackOrigin;
  if (!work.contentId || !publicOrigin) return null;
  return {
    contentId: work.contentId,
    title: work.title || 'Untitled',
    description: null,
    contentType: work.contentType || 'other',
    primaryTopic: work.primaryTopic === 'all' ? null : work.primaryTopic as DiscoverableItem['primaryTopic'],
    creatorHandle: work.creator?.handle || 'creator',
    creatorDisplayName: work.creator?.displayName || work.creator?.handle || 'Creator',
    creatorAvatarUrl: work.creator?.avatarUrl || '',
    coverUrl: work.coverUrl || '',
    previewUrl: work.previewUrl || '',
    buyUrl: work.publicUrl || '',
    offerUrl: resolveAbsoluteUrl(`/buy/content/${encodeURIComponent(work.contentId)}/offer`, publicOrigin),
    priceSats: 0,
    accessMode: 'unlocked',
    publicOrigin,
    profileTheme: work.profileTheme || work.creator?.profileTheme || null,
    relationshipBadges: work.relationshipLabel ? [work.relationshipLabel] : [],
  } as DiscoverableItem;
}

function dedupeDrawerItems(items: DiscoverableItem[]): DiscoverableItem[] {
  const seen = new Set<string>();
  return items.filter((row) => {
    const key = `${row.publicOrigin}::${row.contentId}`;
    if (!row.contentId || !row.publicOrigin || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function Stage1APlayerProvider({ children }: { children: ReactNode }) {
  const {
    savedWorkKeys,
    followedCreatorKeys,
    toggleSavedWork,
    toggleFollowedCreator,
  } = useLocalLibrary();
  const [state, setState] = useState<Stage1APlayerState>('idle');
  const [item, setItem] = useState<Stage1APlayerItem | null>(null);
  const [message, setMessage] = useState('Tap Play to start listening');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaAspect, setMediaAspect] = useState<MediaAspect>('square');
  const [freeDropQueue, setFreeDropQueueState] = useState<DiscoverableItem[]>([]);
  const [recentItems, setRecentItems] = useState<DiscoverableItem[]>(() => safeRecentItemsFromStorage());
  const [detailPanel, setDetailPanel] = useState<DetailPanel>(null);
  const [drawerContent, setDrawerContent] = useState<Stage1APlayerDrawerContent | null>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [mediaMuted, setMediaMuted] = useState(false);
  const [autoplayNext, setAutoplayNext] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(AUTOPLAY_STORAGE_KEY) === 'true';
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const visualRef = useRef<HTMLDivElement | null>(null);
  const activeMediaRef = useRef<HTMLMediaElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const mediaAspectHintRef = useRef<MediaAspect | null>(null);
  const mutedAutoplayRef = useRef(false);
  const endingRef = useRef(false);

  useEffect(() => {
    document.body.classList.add('has-stage1a-player');
    return () => document.body.classList.remove('has-stage1a-player');
  }, []);

  useEffect(() => {
    let active = true;
    if (!item?.artwork || item.mediaKind !== 'video') return () => {
      active = false;
    };
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if (!active) return;
      const posterAspect = classifyAspect(image.naturalWidth, image.naturalHeight);
      if (posterAspect === 'portrait' || posterAspect === 'square') {
        mediaAspectHintRef.current = posterAspect;
        setMediaAspect(posterAspect);
      }
    };
    image.src = item.artwork;
    return () => {
      active = false;
    };
  }, [item?.artwork, item?.mediaKind]);

  const clearActiveMedia = useCallback(() => {
    const current = activeMediaRef.current;
    if (current) {
      try { current.pause(); } catch { /* ignore */ }
      current.muted = false;
      current.removeAttribute('src');
      try { current.load(); } catch { /* ignore */ }
    }
    activeMediaRef.current = null;
    endingRef.current = false;
    mediaAspectHintRef.current = null;
    setProgress(0);
    setDuration(0);
    setMediaAspect('square');
    setMediaMuted(false);
  }, []);

  const playItem = useCallback(async (nextItem: DiscoverableItem, options?: { muted?: boolean; openPlayer?: boolean; drawer?: Stage1APlayerDrawerPanel; mediaAspect?: MediaAspect }) => {
    setDetailPanel(options?.drawer ?? null);
    setDrawerContent({
      moreFromCreator: [],
      moreTheyWorkedOn: [],
      relatedWorks: [],
      connections: connectedLabelsFromItem(nextItem),
      lineage: connectedLabelsFromItem(nextItem),
      credits: creditLabelsFromItem(nextItem),
    });
    mutedAutoplayRef.current = options?.muted === true;
    mediaAspectHintRef.current = options?.mediaAspect && options.mediaAspect !== 'unknown' ? options.mediaAspect : null;
    setMediaMuted(options?.muted === true);
    if (options?.openPlayer !== false) setMobileSheetOpen(true);
    setRecentItems((current) => {
      const next = [nextItem, ...current.filter((row) => row.contentId !== nextItem.contentId || row.publicOrigin !== nextItem.publicOrigin)].slice(0, MAX_RECENT_ITEMS);
      writeRecentItemsToStorage(next);
      return next;
    });
    clearActiveMedia();
    setState('loading');
    setMessage('Loading');
    const initialDisplayState = displayStateFromItem(nextItem);
    setItem({
      sourceItem: nextItem,
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
      connectedLabels: connectedLabelsFromItem(nextItem),
      detailLabels: detailLabelsFromItem(nextItem, null, null),
      creditLabels: creditLabelsFromItem(nextItem),
      proofLabels: proofLabelsFromItem(nextItem, null),
      description: nextItem.description || '',
      mediaKind: 'audio',
      playback: { mode: 'none', streamUrl: null, previewLimitSeconds: null, canPlayFull: false },
    });
    setMediaAspect(mediaAspectHintRef.current || 'square');

    try {
      const offer = await fetchCanonicalOffer(nextItem);
      const paymentAccessProof = offer?.paymentAccessProof && typeof offer.paymentAccessProof === 'object'
        ? offer.paymentAccessProof as Record<string, unknown>
        : null;
      rememberReceiptProofForItem(nextItem, {
        receiptId: typeof paymentAccessProof?.paymentReceiptId === 'string' ? paymentAccessProof.paymentReceiptId : undefined,
      });
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
          sourceItem: nextItem,
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
          connectedLabels: connectedLabelsFromItem(nextItem),
          detailLabels: detailLabelsFromItem(nextItem, offer, playback),
          creditLabels: creditLabelsFromItem(nextItem),
          proofLabels: proofLabelsFromItem(nextItem, offer),
          description: offerText(offer?.description, nextItem.description || ''),
          mediaKind: 'audio',
          playback: playback || { mode: 'none', streamUrl: null, previewLimitSeconds: null, canPlayFull: false },
        });
        setState('error');
        setMessage('Playback is not available for this item.');
        return;
      }

      const nextMediaKind = mediaKind(offer, nextItem, streamUrl);
      setMediaAspect(mediaAspectHintRef.current || inferMediaAspect(offer, nextItem, nextMediaKind));
      setItem({
        sourceItem: nextItem,
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
        connectedLabels: connectedLabelsFromItem(nextItem),
        detailLabels: detailLabelsFromItem(nextItem, offer, playback),
        creditLabels: creditLabelsFromItem(nextItem),
        proofLabels: proofLabelsFromItem(nextItem, offer),
        description: offerText(offer?.description, nextItem.description || ''),
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
    media.muted = mutedAutoplayRef.current;
    setMediaMuted(media.muted);
    try { media.load(); } catch { /* ignore */ }
    const promise = media.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        if (item.mediaKind === 'video' && !media.muted) {
          media.muted = true;
          setMediaMuted(true);
          const mutedPromise = media.play();
          if (mutedPromise && typeof mutedPromise.catch === 'function') {
            mutedPromise.catch(() => {
              setState('paused');
              setMessage('Tap play to start. Your browser blocked automatic playback.');
            });
          }
          setMessage('Playing muted. Tap unmute for sound.');
          return;
        }
        setState('paused');
        setMessage('Tap play to start. Your browser blocked automatic playback.');
      });
    }
  }, [item, state]);

  const playNextQueuedItem = useCallback((fromItem: Stage1APlayerItem | null = item) => {
    if (!fromItem) return false;
    const currentIndex = freeDropQueue.findIndex((queueItem) =>
      queueItem.contentId === fromItem.contentId && queueItem.publicOrigin === fromItem.publicOrigin
    );
    if (currentIndex < 0 || currentIndex >= freeDropQueue.length - 1) return false;
    void playItem(freeDropQueue[currentIndex + 1]);
    return true;
  }, [freeDropQueue, item, playItem]);

  const playPreviousQueuedItem = useCallback((fromItem: Stage1APlayerItem | null = item) => {
    if (!fromItem) return false;
    const currentIndex = freeDropQueue.findIndex((queueItem) =>
      queueItem.contentId === fromItem.contentId && queueItem.publicOrigin === fromItem.publicOrigin
    );
    if (currentIndex <= 0) return false;
    void playItem(freeDropQueue[currentIndex - 1]);
    return true;
  }, [freeDropQueue, item, playItem]);

  const onTimeUpdate = useCallback((event: SyntheticEvent<HTMLMediaElement>) => {
    const media = event.currentTarget;
    setProgress(media.currentTime || 0);
    setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    const limit = item?.playback.mode === 'preview' ? item.playback.previewLimitSeconds : null;
    if (!limit || media.currentTime < limit || endingRef.current) return;
    endingRef.current = true;
    try { media.pause(); } catch { /* ignore */ }
    try { media.currentTime = Math.max(0, limit); } catch { /* ignore */ }
    setState('ended');
    setMessage('Preview ended. Support the creator for full access.');
    if (autoplayNext && playNextQueuedItem(item)) {
      setMessage('Preview ended. Playing next.');
    }
  }, [autoplayNext, item, playNextQueuedItem]);

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

  const toggleMute = useCallback(() => {
    const media = activeMediaRef.current;
    if (!media) return;
    const nextMuted = !media.muted;
    media.muted = nextMuted;
    setMediaMuted(nextMuted);
    if (!nextMuted && media.paused && item?.playback.streamUrl) {
      const promise = media.play();
      if (promise && typeof promise.catch === 'function') promise.catch(() => setState('paused'));
    }
  }, [item]);

  const toggleFullscreen = useCallback(() => {
    const target = visualRef.current;
    if (!target) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
      return;
    }
    void target.requestFullscreen?.();
  }, []);

  const seek = useCallback((value: number) => {
    const media = activeMediaRef.current;
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
    try { media.currentTime = value; } catch { /* ignore */ }
  }, []);

  const resetIdle = useCallback(() => {
    clearActiveMedia();
    setDetailPanel(null);
    setMobileSheetOpen(false);
    setItem(null);
    setState('idle');
    setMessage('Tap Play to start listening');
  }, [clearActiveMedia]);

  const currentFreeDropIndex = useMemo(() => {
    if (!item) return -1;
    return freeDropQueue.findIndex((queueItem) => queueItem.contentId === item.contentId && queueItem.publicOrigin === item.publicOrigin);
  }, [freeDropQueue, item]);

  const playNextFreeDrop = useCallback(() => {
    playNextQueuedItem();
  }, [playNextQueuedItem]);

  const playPreviousFreeDrop = useCallback(() => {
    playPreviousQueuedItem();
  }, [playPreviousQueuedItem]);

  const canPlayNextFreeDrop = currentFreeDropIndex >= 0 && currentFreeDropIndex < freeDropQueue.length - 1;
  const canPlayPreviousFreeDrop = currentFreeDropIndex > 0;

  const currentSourceItem = item?.sourceItem || null;
  const currentWorkKey = currentSourceItem ? `${currentSourceItem.publicOrigin}::${currentSourceItem.contentId}` : '';
  const currentCreator = currentSourceItem ? creatorFromItem(currentSourceItem) : null;
  const currentCreatorKey = currentCreator?.key || '';
  const isCurrentSaved = Boolean(currentWorkKey && savedWorkKeys.has(currentWorkKey));
  const isCurrentFollowed = Boolean(currentCreatorKey && followedCreatorKeys.has(currentCreatorKey));

  const toggleCurrentSaved = useCallback(() => {
    if (!currentSourceItem) return;
    toggleSavedWork(currentSourceItem);
  }, [currentSourceItem, toggleSavedWork]);

  const toggleCurrentFollowed = useCallback(() => {
    toggleFollowedCreator(currentCreator);
  }, [currentCreator, toggleFollowedCreator]);

  const shareCurrent = useCallback(async () => {
    if (!item) return;
    const url = item.buyUrl && item.buyUrl !== '#' ? item.buyUrl : item.creatorUrl || window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage('Link copied.');
    } catch {
      setMessage('Share unavailable.');
    }
  }, [item]);

  const handleVisualTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const handleVisualTouchEnd = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const startY = touchStartYRef.current;
    touchStartYRef.current = null;
    if (startY === null || currentFreeDropIndex < 0) return;
    const endY = event.changedTouches[0]?.clientY ?? startY;
    const delta = endY - startY;
    if (Math.abs(delta) < 56) return;
    if (delta < 0) playNextFreeDrop();
    else playPreviousFreeDrop();
  }, [currentFreeDropIndex, playNextFreeDrop, playPreviousFreeDrop]);

  useEffect(() => {
    let active = true;
    if (!currentSourceItem?.contentId || !currentSourceItem.publicOrigin) {
      return () => {
        active = false;
      };
    }
    const fallbackContent: Stage1APlayerDrawerContent = {
      moreFromCreator: [],
      moreTheyWorkedOn: [],
      relatedWorks: [],
      connections: connectedLabelsFromItem(currentSourceItem),
      lineage: connectedLabelsFromItem(currentSourceItem),
      credits: creditLabelsFromItem(currentSourceItem),
    };
    void fetchContentContext({ origin: currentSourceItem.publicOrigin, contentId: currentSourceItem.contentId })
      .then((context) => {
        if (!active || !context) return;
        const contextWorks = dedupeDrawerItems([
          ...context.moreTheyWorkedOn,
          ...context.relatedWorks,
          ...context.worksThatBuiltOnThis,
          ...context.builtFrom,
          ...context.derivedFrom,
        ].map((work) => contextWorkToDiscoverable(work, currentSourceItem.publicOrigin)).filter((row): row is DiscoverableItem => Boolean(row)));
        const workedOn = dedupeDrawerItems(context.moreTheyWorkedOn
          .map((work) => contextWorkToDiscoverable(work, currentSourceItem.publicOrigin))
          .filter((row): row is DiscoverableItem => Boolean(row)));
        const creatorWorks = contextWorks
          .filter((row) => row.creatorHandle === currentSourceItem.creatorHandle)
          .slice(0, 12);
        const people = [
          ...context.peopleBehindThis,
          ...context.featuring,
          ...context.createdWith,
          ...context.connectedCreators,
        ]
          .map((person) => {
            const handle = person.handle ? `@${String(person.handle).replace(/^@+/, '')}` : '';
            const role = 'relationshipLabel' in person && person.relationshipLabel ? ` • ${person.relationshipLabel}` : '';
            return `${person.displayName || person.handle || 'Creator'}${handle ? ` (${handle})` : ''}${role}`;
          })
          .filter(Boolean);
        setDrawerContent({
          moreFromCreator: creatorWorks.length ? creatorWorks : contextWorks.slice(0, 12),
          moreTheyWorkedOn: workedOn.slice(0, 16),
          relatedWorks: contextWorks.slice(0, 16),
          connections: [
            context.creator ? `Creator: ${context.creator.displayName || context.creator.handle || 'Creator'}` : '',
            context.connectedCreators.length ? `${context.connectedCreators.length} connected creators` : '',
            context.moreTheyWorkedOn.length ? `${context.moreTheyWorkedOn.length} works they also worked on` : '',
            context.relatedWorks.length ? `${context.relatedWorks.length} related works` : '',
            context.provenance?.hasManifest ? 'Manifest available' : '',
            context.provenance?.hasLockedProof ? 'Locked proof available' : '',
          ].filter(Boolean),
          lineage: [
            context.creator ? `Created by ${context.creator.displayName || context.creator.handle || 'Creator'}` : '',
            context.peopleBehindThis.length ? `${context.peopleBehindThis.length} people behind this work` : '',
            context.featuring.length ? `${context.featuring.length} featured creators` : '',
            context.createdWith.length ? `${context.createdWith.length} collaborators` : '',
            context.builtFrom.length ? `${context.builtFrom.length} built-from works` : '',
            context.derivedFrom.length ? `${context.derivedFrom.length} source works` : '',
            context.worksThatBuiltOnThis.length ? `${context.worksThatBuiltOnThis.length} downstream works` : '',
            context.provenance?.hasManifest ? 'Manifest available' : '',
            context.provenance?.hasLockedProof ? 'Locked proof available' : '',
          ].filter(Boolean),
          credits: people,
        });
      })
      .catch(() => {
        if (active) setDrawerContent((current) => current || fallbackContent);
      });
    return () => {
      active = false;
    };
  }, [currentSourceItem]);

  const handleEnded = useCallback(() => {
    endingRef.current = true;
    setState('ended');
    setMessage('Ended');
    if (!autoplayNext) return;
    if (playNextQueuedItem(item)) setMessage('Ended. Playing next.');
  }, [autoplayNext, item, playNextQueuedItem]);
  const toggleAutoplayNext = useCallback(() => {
    setAutoplayNext((current) => {
      const next = !current;
      if (typeof window !== 'undefined') window.localStorage.setItem(AUTOPLAY_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const contextValue = useMemo(() => ({
    playItem,
    setMobilePlayerOpen: setMobileSheetOpen,
    setFreeDropQueue,
    setDrawerContent,
    openDrawer: setDetailPanel,
    togglePlay,
    playNextFreeDrop,
    playPreviousFreeDrop,
    seek,
    resetIdle,
    recentItems,
    state,
    item,
    message,
    progress,
    duration,
    canPlayNextFreeDrop,
    canPlayPreviousFreeDrop,
  }), [canPlayNextFreeDrop, canPlayPreviousFreeDrop, duration, item, message, playItem, playNextFreeDrop, playPreviousFreeDrop, progress, recentItems, resetIdle, seek, setFreeDropQueue, state, togglePlay]);
  const isIdle = state === 'idle';
  const isPlaying = state === 'playing';
  const canControl = Boolean(item?.playback.streamUrl);
  const displayedTitle = item?.title || 'Certifyd Player';
  const displayedMeta = isIdle ? 'Tap Play to start listening' : `${item?.playbackLabel || 'READY'} · ${message === state ? item?.creator || 'Creator' : message}`;
  const progressMax = Math.max(duration || 0, progress || 0, 1);
  const progressValue = Math.min(progress, Math.max(duration || progress || 1, 1));
  const visualAspectClass = `stage1a-rich-visual-${mediaAspect}`;
  const detailPanelTitle =
    detailPanel === 'details' ? 'Details'
      : detailPanel === 'creator' ? 'Creator'
      : detailPanel === 'more' ? 'More From Creator'
        : detailPanel === 'worked' ? 'More They Worked On'
          : detailPanel === 'lineage' ? 'Attribution & Lineage'
            : detailPanel === 'connections' ? 'Connections'
              : detailPanel === 'proofs' ? 'Proofs & Credits'
                : '';
  const detailPanelRows = detailPanel === 'proofs'
    ? [...(item?.creditLabels || []), ...(item?.proofLabels || []), ...(drawerContent?.credits || [])]
    : detailPanel === 'creator'
      ? [
        item?.creator ? `Creator: @${item.creator}` : '',
        item?.creatorUrl ? `Profile: ${item.creatorUrl}` : '',
        currentCreator?.displayName ? `Name: ${currentCreator.displayName}` : '',
        currentCreator?.latestTitle ? `Latest: ${currentCreator.latestTitle}` : '',
      ].filter(Boolean)
      : detailPanel === 'lineage'
        ? [...(drawerContent?.lineage || []), ...(item?.connectedLabels || [])]
    : detailPanel === 'details'
        ? [
          item?.title ? `Title: ${item.title}` : '',
          item?.creator ? `Creator: @${item.creator}` : '',
          item?.mediaKind ? `Media: ${item.mediaKind}` : '',
          item?.playbackLabel ? `State: ${item.playbackLabel}` : '',
          ...(item?.detailLabels || []),
          item?.description || '',
        ].filter(Boolean)
        : detailPanel === 'connections'
          ? [...(item?.connectedLabels || []), ...(drawerContent?.connections || [])]
          : [];
  const detailPanelItems = detailPanel === 'more'
    ? drawerContent?.moreFromCreator || []
    : detailPanel === 'worked'
      ? drawerContent?.moreTheyWorkedOn || []
    : detailPanel === 'connections'
      ? drawerContent?.relatedWorks || []
      : [];

  return (
    <Stage1APlayerContext.Provider value={contextValue}>
      {children}
      <aside className={`stage1a-rich-player ${isIdle ? 'stage1a-rich-player-idle' : ''} ${mobileSheetOpen ? 'stage1a-rich-player-mobile-open' : ''}`} data-state={state} aria-label="Now Playing">
        <div className="stage1a-rich-mobile-handle" aria-hidden="true" />
        <div className="stage1a-rich-topline">
          <div className="stage1a-rich-kicker">Now Playing</div>
          <button type="button" className="stage1a-rich-collapse" onClick={() => setMobileSheetOpen(false)} aria-label="Collapse player">↓</button>
        </div>
        <div
          ref={visualRef}
          className={`stage1a-rich-visual ${item?.mediaKind === 'video' ? 'stage1a-rich-visual-video' : 'stage1a-rich-visual-artwork'} ${visualAspectClass}`}
          onTouchStart={handleVisualTouchStart}
          onTouchEnd={handleVisualTouchEnd}
        >
          {item?.mediaKind === 'video' ? (
            <video
              ref={videoRef}
              className="stage1a-player-video"
              muted={mediaMuted}
              poster={item.artwork || undefined}
              playsInline
              onPlay={() => { endingRef.current = false; setState('playing'); setMessage('Playing'); }}
              onPause={() => { if (!endingRef.current && state !== 'ended' && activeMediaRef.current?.currentTime) { setState('paused'); setMessage('Paused'); } }}
              onLoadedMetadata={(event) => {
                setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
                setMediaAspect(classifyAspect(event.currentTarget.videoWidth, event.currentTarget.videoHeight));
              }}
              onTimeUpdate={onTimeUpdate}
              onEnded={handleEnded}
              onError={() => { setState('error'); setMessage('Playback error.'); }}
            />
          ) : item?.artwork ? (
            <img
              src={item.artwork}
              alt=""
              className="stage1a-rich-artwork"
              referrerPolicy="no-referrer"
              onLoad={(event) => {
                if (!mediaAspectHintRef.current) {
                  setMediaAspect(classifyAspect(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight));
                }
              }}
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
              onEnded={handleEnded}
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
              <button type="button" className="stage1a-rich-nav stage1a-rich-fullscreen" onClick={toggleFullscreen} disabled={!canControl} aria-label="Fullscreen">⛶</button>
              {item?.mediaKind === 'video' ? (
                <button type="button" className="stage1a-rich-nav stage1a-rich-mute" onClick={toggleMute} disabled={!canControl} aria-label={mediaMuted ? 'Unmute' : 'Mute'}>
                  {mediaMuted ? '🔇' : '🔊'}
                </button>
              ) : null}
            </div>
            <button type="button" className={`stage1a-rich-autoplay ${autoplayNext ? 'stage1a-rich-autoplay-on' : ''}`} onClick={toggleAutoplayNext}>
              Autoplay next {autoplayNext ? 'On' : 'Off'}
            </button>
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
            {item?.description ? <p className="stage1a-rich-description">{item.description}</p> : null}
            {item?.detailLabels.length ? (
              <div className="stage1a-rich-detail-grid" aria-label="Playback details">
                {item.detailLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            ) : null}
            <div className="stage1a-rich-overlay-actions" aria-label="Work actions">
              <button type="button" onClick={toggleCurrentSaved} disabled={!currentSourceItem}>
                {isCurrentSaved ? 'Saved' : 'Save Work'}
              </button>
              <button type="button" onClick={shareCurrent}>
                Share
              </button>
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'details' ? null : 'details'))}>
                More / Details
              </button>
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'worked' ? null : 'worked'))}>
                Worked On
              </button>
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'lineage' ? null : 'lineage'))}>
                Lineage
              </button>
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'proofs' ? null : 'proofs'))}>
                Proofs
              </button>
              {item?.creatorUrl ? (
                <a className="stage1a-rich-overlay-link" href={item.creatorUrl} target="_blank" rel="noreferrer">
                  Creator
                </a>
              ) : (
                <button type="button" onClick={() => setDetailPanel((current) => (current === 'creator' ? null : 'creator'))}>
                  Creator
                </button>
              )}
              <button type="button" onClick={toggleCurrentFollowed} disabled={!currentCreator}>
                {isCurrentFollowed ? 'Following' : 'Follow'}
              </button>
            </div>
            <div className="stage1a-rich-actions">
              <a className="stage1a-rich-support" href={item?.buyUrl || '#'} target="_blank" rel="noreferrer">
                {item?.supportLabel || 'Support Creator'}
              </a>
            </div>
            <div className="stage1a-rich-links" aria-label="Work details">
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'details' ? null : 'details'))}>Details</button>
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'creator' ? null : 'creator'))}>Creator</button>
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'more' ? null : 'more'))}>More from Creator</button>
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'worked' ? null : 'worked'))}>More They Worked On</button>
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'lineage' ? null : 'lineage'))}>Attribution / Lineage</button>
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'connections' ? null : 'connections'))}>Connections</button>
              <button type="button" onClick={() => setDetailPanel((current) => (current === 'proofs' ? null : 'proofs'))}>Proofs / Credits</button>
              {item?.creatorUrl ? (
                <a className="stage1a-rich-inline-link" href={item.creatorUrl} target="_blank" rel="noreferrer">
                  Visit Creator
                </a>
              ) : null}
            </div>
            {item?.connectedLabels.length ? (
              <div className="stage1a-rich-connected">
                <div className="stage1a-rich-connected-title">Connected to</div>
                <div className="stage1a-rich-connected-list">
                  {item.connectedLabels.map((label) => (
                    <button type="button" key={label} onClick={() => setDetailPanel('connections')}>{label}</button>
                  ))}
                </div>
              </div>
            ) : null}
            {detailPanel ? (
              <div className="stage1a-rich-detail-panel" role="region" aria-label={detailPanelTitle}>
                <div className="stage1a-rich-detail-panel-head">
                  <div>{detailPanelTitle}</div>
                  <button type="button" onClick={() => setDetailPanel(null)} aria-label="Close details">×</button>
                </div>
                <div className="stage1a-rich-drawer-hero">
                  {item?.artwork ? <img src={item.artwork} alt="" referrerPolicy="no-referrer" /> : <div aria-hidden="true">CERTIFYD</div>}
                  <div>
                    <span>{item?.playbackLabel || 'READY'}</span>
                    <strong>{item?.title || 'Certifyd Player'}</strong>
                    <small>{isIdle ? 'Choose a work to start playback.' : `@${item?.creator || 'creator'}`}</small>
                  </div>
                </div>
                {detailPanelItems.length > 0 ? (
                  <div className="stage1a-rich-drawer-cards">
                    {detailPanelItems.map((drawerItem) => (
                      <button
                        type="button"
                        key={`${drawerItem.publicOrigin}:${drawerItem.contentId}`}
                        className="stage1a-rich-drawer-card"
                        onClick={() => void playItem(drawerItem)}
                      >
                        {drawerItem.coverUrl ? <img src={drawerItem.coverUrl} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">♪</span>}
                        <span>
                          <strong>{drawerItem.title || 'Untitled'}</strong>
                          <small>@{String(drawerItem.creatorHandle || 'creator').replace(/^@+/, '')}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {detailPanelRows.length > 0 ? (
                  <ul>
                    {detailPanelRows.map((row) => (
                      <li key={row}>{row}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No public data available yet.</p>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </aside>
      <div className={`stage1a-player-dock ${isIdle ? 'stage1a-player-dock-idle' : ''}`} data-state={state} role="region" aria-label="Certifyd transport" onClick={() => { if (!isIdle) setMobileSheetOpen(true); }}>
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
              <button type="button" className="stage1a-player-button" onClick={(event) => { event.stopPropagation(); togglePlay(); }} disabled={!canControl} aria-label="Play or pause">
                <PlayIcon playing={isPlaying} />
              </button>
              <input
                className="stage1a-player-progress"
                type="range"
                min={0}
                max={progressMax}
                step="0.1"
                value={progressValue}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => seek(Number(event.currentTarget.value))}
                disabled={!canControl || duration <= 0}
                aria-label="Playback progress"
              />
              <span className="stage1a-player-time">{formatTime(progress)}</span>
            </div>
          ) : null}
        </div>
        {!isIdle ? (
          <button type="button" className="stage1a-player-clear" onClick={(event) => { event.stopPropagation(); resetIdle(); }} aria-label="Clear player">×</button>
        ) : null}
      </div>
    </Stage1APlayerContext.Provider>
  );
}
