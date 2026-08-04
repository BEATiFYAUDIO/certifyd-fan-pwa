import { resolveAccessFromOffer, type CanonicalOffer, type ResolvedPlayback } from '../accessResolver';
import { displayStateFromItem, displayStateFromPlayback } from '../playbackDisplay';
import type { DiscoverableItem } from '../types';
import { inferRuntimeRenderKind, type RuntimeRenderKind } from './render';
import { resolveAbsoluteUrl } from './urls';

export type RuntimePlaybackState = {
  playback: ResolvedPlayback;
  label: string;
  ctaLabel: string;
  commerceState: string;
  streamUrl: string;
  renderKind: RuntimeRenderKind;
};

function isBareContentboxPreviewUrl(value: unknown): boolean {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw, 'https://fan.certifyd.me/');
    const pathname = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return pathname.endsWith('/preview-file') &&
      !parsed.searchParams.has('objectKey') &&
      !parsed.searchParams.has('t') &&
      !parsed.searchParams.has('token');
  } catch {
    return /\/preview-file\/?$/i.test(raw);
  }
}

function mustWaitForCanonicalPlayback(item: DiscoverableItem): boolean {
  if (item.canonicalOfferHydrated) return false;
  const price = Number(item.priceSats || 0);
  const isPremium = (Number.isFinite(price) && price > 0) || item.accessMode === 'locked' || item.isLocked === true;
  return isPremium && isBareContentboxPreviewUrl(item.previewUrl);
}

export function resolveRuntimePlayback(item: DiscoverableItem): RuntimePlaybackState {
  const display = displayStateFromItem(item);
  const waitForCanonicalPlayback = mustWaitForCanonicalPlayback(item);
  const resolverItem = waitForCanonicalPlayback ? { ...item, previewUrl: '' } : item;
  const pseudoOffer: CanonicalOffer = {
    priceSats: item.priceSats,
    accessMode: item.accessMode,
    isFree: item.isFree,
    owned: item.owned,
    hasFullAccess: item.hasFullAccess,
    previewUrl: waitForCanonicalPlayback ? '' : item.previewUrl,
    fullMediaUrl: item.fullMediaUrl,
    fullContentUrl: item.fullContentUrl,
    mediaUrl: item.mediaUrl,
    contentUrl: item.contentUrl,
    previewSeconds: item.previewSeconds,
    paymentAccessProof: item.paymentAccessProof,
    playback: item.canonicalPlayback && typeof item.canonicalPlayback === 'object' ? item.canonicalPlayback : undefined,
  };
  const access = resolveAccessFromOffer(resolverItem, pseudoOffer);
  const streamUrl = resolveAbsoluteUrl(access.playback.streamUrl, item.publicOrigin);
  const playbackDisplay = displayStateFromPlayback(access.playback, {
    priceSats: access.priceSats,
    accessMode: access.accessMode,
    isFree: access.isFree,
    owned: access.owned,
    hasFullAccess: access.owned,
  });
  return {
    playback: access.playback,
    label: playbackDisplay.label || display.label,
    ctaLabel: playbackDisplay.ctaLabel || display.ctaLabel,
    commerceState: playbackDisplay.state,
    streamUrl,
    renderKind: inferRuntimeRenderKind(item, streamUrl),
  };
}
