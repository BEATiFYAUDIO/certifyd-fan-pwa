import type { DiscoverableItem } from './types';
import { hasRecentUnlockedAccessForItem } from './accessCache';

export type PlayerCommerceState = 'free' | 'preview' | 'owned' | 'unavailable';

export type PlaybackDisplayState = {
  state: PlayerCommerceState;
  label: string;
  ctaLabel: string;
};

function previewLabel(seconds: number | string | null | undefined): string {
  const parsed = Number(seconds);
  if (Number.isFinite(parsed) && parsed > 0) return `PREVIEW · ${Math.round(parsed)} sec`;
  return 'PREVIEW · 20 sec';
}

export function displayStateFromItem(item: DiscoverableItem): PlaybackDisplayState {
  if (item.accessMode === 'owned' || item.owned === true || item.hasFullAccess === true || hasRecentUnlockedAccessForItem(item)) {
    return { state: 'owned', label: 'OWNED', ctaLabel: 'Support Creator' };
  }
  if (item.accessMode === 'locked' || item.isLocked === true || Number(item.priceSats || 0) > 0) {
    return { state: 'preview', label: previewLabel(item.previewSeconds), ctaLabel: 'Unlock / Support' };
  }
  return { state: 'free', label: 'FREE', ctaLabel: 'Support Creator' };
}

export function displayStateFromPlayback(playback: {
  mode: 'full' | 'preview' | 'none';
  previewLimitSeconds: number | null;
  canPlayFull: boolean;
}, offer: Record<string, unknown> | null): PlaybackDisplayState {
  if (playback.mode === 'preview') {
    return { state: 'preview', label: previewLabel(playback.previewLimitSeconds), ctaLabel: 'Unlock / Support' };
  }
  if (playback.mode === 'full') {
    const accessMode = String(offer?.accessMode || '').trim().toLowerCase();
    const owned = offer?.owned === true || offer?.hasFullAccess === true || accessMode === 'owned';
    const free = offer?.isFree === true || accessMode === 'unlocked';
    const price = Number(offer?.priceSats || offer?.price_sat || offer?.amountSats || offer?.price || 0);
    if (owned || price > 0) return { state: 'owned', label: 'OWNED', ctaLabel: 'Support Creator' };
    if (free) return { state: 'free', label: 'FREE', ctaLabel: 'Support Creator' };
    return { state: 'free', label: 'FREE', ctaLabel: 'Support Creator' };
  }
  return { state: 'unavailable', label: 'UNAVAILABLE', ctaLabel: 'Support Creator' };
}
