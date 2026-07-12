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

export function resolveRuntimePlayback(item: DiscoverableItem): RuntimePlaybackState {
  const display = displayStateFromItem(item);
  const pseudoOffer: CanonicalOffer = {
    priceSats: item.priceSats,
    accessMode: item.accessMode,
    isFree: item.isFree,
    owned: item.owned,
    hasFullAccess: item.hasFullAccess,
    previewUrl: item.previewUrl,
    fullMediaUrl: item.fullMediaUrl,
    fullContentUrl: item.fullContentUrl,
    mediaUrl: item.mediaUrl,
    contentUrl: item.contentUrl,
    previewSeconds: item.previewSeconds,
    paymentAccessProof: item.paymentAccessProof,
  };
  const access = resolveAccessFromOffer(item, pseudoOffer);
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
