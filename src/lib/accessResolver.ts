import type { DiscoverableItem } from './types';
import { isReceiptStatusUnlocked, receiptStatusMatchesItem, type ReceiptAccessStatus } from './receiptStatus';

export type CanonicalOffer = Record<string, unknown>;

export type ResolvedPlayback = {
  mode: 'full' | 'preview' | 'none';
  streamUrl: string | null;
  previewLimitSeconds: number | null;
  canPlayFull: boolean;
  reason?: string;
};

export type ResolvedAccess = {
  priceSats: number;
  isPaid: boolean;
  isFree: boolean;
  isLocked: boolean;
  hasViewerAccess: boolean;
  accessMode: DiscoverableItem['accessMode'];
  owned: boolean;
  playback: ResolvedPlayback;
};

function text(value: unknown): string {
  return String(value || '').trim();
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function explicitTrue(value: unknown): boolean {
  return value === true || lower(value) === 'true';
}

function numberFrom(values: unknown[], fallback = 0): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return fallback;
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstText(values: unknown[]): string | null {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return null;
}

function hasPositiveEntitlement(proof: unknown): boolean {
  if (!proof || typeof proof !== 'object') return false;
  const record = proof as Record<string, unknown>;
  const entitlementState = lower(record.entitlementState);
  const paymentState = lower(record.paymentState);
  return ['active', 'granted', 'owned', 'unlocked', 'valid', 'fulfilled'].includes(entitlementState)
    || ['paid', 'settled', 'succeeded', 'complete', 'completed'].includes(paymentState);
}

function normalizedAccessMode(value: unknown): DiscoverableItem['accessMode'] | null {
  const mode = lower(value);
  if (mode === 'owned' || mode === 'unlocked' || mode === 'locked') return mode;
  return null;
}

function playbackRecord(offer: CanonicalOffer | null): Record<string, unknown> | null {
  return offer?.playback && typeof offer.playback === 'object' ? offer.playback as Record<string, unknown> : null;
}

export function resolveAccessFromOffer(item: DiscoverableItem, offer: CanonicalOffer | null, receiptStatus?: ReceiptAccessStatus | null): ResolvedAccess {
  const playback = playbackRecord(offer);
  const offerAccessMode = normalizedAccessMode(offer?.accessMode);
  const accessMode = offerAccessMode || item.accessMode;
  const priceSats = numberFrom([offer?.priceSats, offer?.price_sat, offer?.unlockPriceSats, offer?.amountSats, offer?.price, item.priceSats]);
  const isPaid = priceSats > 0;
  const isFree = explicitTrue(offer?.isFree) || (!isPaid && accessMode !== 'locked');
  const canPlayFull = playback?.canPlayFull === true;
  const requestedMode = playback?.mode === 'full' || playback?.mode === 'preview' || playback?.mode === 'none'
    ? playback.mode
    : null;
  const receiptUnlocked = receiptStatusMatchesItem(receiptStatus, item) && isReceiptStatusUnlocked(receiptStatus);
  const hasViewerAccess = receiptUnlocked
    || explicitTrue(offer?.hasFullAccess)
    || explicitTrue(offer?.owned)
    || offerAccessMode === 'owned'
    || hasPositiveEntitlement(offer?.paymentAccessProof);
  const canonicalPreviewStreamUrl = requestedMode === 'preview' ? playback?.streamUrl : null;
  const previewStreamUrl = firstText([playback?.previewUrl, canonicalPreviewStreamUrl, offer?.previewUrl, item.previewUrl]);
  const offerFullStreamUrl = firstText([(requestedMode === 'full' || canPlayFull) ? playback?.streamUrl : null, offer?.fullMediaUrl, offer?.fullContentUrl, offer?.mediaUrl, offer?.contentUrl]);
  const itemFullStreamUrl = receiptUnlocked || isFree ? firstText([item.fullMediaUrl, item.fullContentUrl, item.mediaUrl, item.contentUrl]) : null;
  const fullStreamUrl = offerFullStreamUrl || itemFullStreamUrl;
  const previewLimitSeconds = positiveNumber(playback?.previewLimitSeconds)
    || positiveNumber(offer?.previewSeconds)
    || positiveNumber(offer?.previewDurationSeconds)
    || positiveNumber(offer?.previewLimitSeconds)
    || positiveNumber(item.previewSeconds);
  if (requestedMode === 'preview' && !hasViewerAccess) {
    return {
      priceSats,
      isPaid,
      isFree: false,
      isLocked: true,
      hasViewerAccess: false,
      accessMode: 'locked',
      owned: false,
      playback: {
        mode: previewStreamUrl ? 'preview' : 'none',
        streamUrl: previewStreamUrl,
        previewLimitSeconds: previewStreamUrl ? previewLimitSeconds || 20 : null,
        canPlayFull: false,
        reason: previewStreamUrl ? undefined : 'missing-preview-stream',
      },
    };
  }

  if (isPaid && !hasViewerAccess) {
    return {
      priceSats,
      isPaid,
      isFree: false,
      isLocked: true,
      hasViewerAccess: false,
      accessMode: 'locked',
      owned: false,
      playback: {
        mode: previewStreamUrl ? 'preview' : 'none',
        streamUrl: previewStreamUrl,
        previewLimitSeconds: previewStreamUrl ? previewLimitSeconds || 20 : null,
        canPlayFull: false,
        reason: previewStreamUrl ? undefined : 'locked',
      },
    };
  }

  if (requestedMode === 'none') {
    return {
      priceSats,
      isPaid,
      isFree,
      isLocked: true,
      hasViewerAccess,
      accessMode: isPaid && hasViewerAccess ? 'owned' : accessMode,
      owned: isPaid && hasViewerAccess,
      playback: { mode: 'none', streamUrl: null, previewLimitSeconds: null, canPlayFull: false, reason: text(playback?.reason) || 'playback-unavailable' },
    };
  }

  const canUseFullStream = Boolean(fullStreamUrl) && (isFree || hasViewerAccess);
  if (canUseFullStream) {
    return {
      priceSats,
      isPaid,
      isFree,
      isLocked: false,
      hasViewerAccess: isFree || hasViewerAccess,
      accessMode: isPaid ? 'owned' : 'unlocked',
      owned: isPaid && hasViewerAccess,
      playback: { mode: 'full', streamUrl: fullStreamUrl, previewLimitSeconds: null, canPlayFull: true },
    };
  }

  return {
    priceSats,
    isPaid,
    isFree,
    isLocked: !isFree,
    hasViewerAccess: isFree || hasViewerAccess,
    accessMode: isFree ? 'unlocked' : accessMode,
    owned: isPaid && hasViewerAccess,
    playback: {
      mode: previewStreamUrl ? 'preview' : 'none',
      streamUrl: previewStreamUrl,
      previewLimitSeconds: previewStreamUrl ? previewLimitSeconds || 20 : null,
      canPlayFull: false,
      reason: previewStreamUrl ? undefined : 'missing-full-stream',
    },
  };
}
