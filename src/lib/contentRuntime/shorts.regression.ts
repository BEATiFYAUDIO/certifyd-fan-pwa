import { mergeCanonicalOffer } from './hydration';
import { resolveRuntimePlayback } from './playback';
import { inferRuntimeRenderKind } from './render';
import { contentRuntimeItemKey } from './shorts';
import { shouldAttemptShortsPlayback, shortsPlaybackAttemptKey } from './shortsPlayback';
import type { DiscoverableItem } from '../types';

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) throw new Error(message || `Expected ${String(expected)}, got ${String(actual)}`);
}

function item(overrides: Partial<DiscoverableItem> = {}): DiscoverableItem {
  return {
    contentId: 'work-1',
    title: 'Work',
    description: null,
    creatorHandle: 'creator',
    contentType: 'video',
    primaryTopic: 'music',
    coverUrl: 'https://node.test/cover.jpg',
    previewUrl: 'https://node.test/preview.mp4',
    fullMediaUrl: 'https://node.test/full.mp4',
    fullContentUrl: null,
    mediaUrl: null,
    contentUrl: null,
    buyUrl: 'https://node.test/buy/work-1',
    offerUrl: 'https://node.test/buy/content/work-1/offer',
    priceSats: 1000,
    accessMode: 'locked',
    isLocked: true,
    isFree: false,
    hasFullAccess: false,
    owned: false,
    previewSeconds: 20,
    primaryFileMime: 'video/mp4',
    publicOrigin: 'https://node.test',
    ...overrides,
  };
}

function run() {
  assertEqual(contentRuntimeItemKey(item({ publicOrigin: 'https://node.test/' })), 'https://node.test::work-1');
  assertEqual(inferRuntimeRenderKind(item({ primaryFileMime: 'audio/mpeg', contentType: 'song' }), 'https://node.test/song.mp3'), 'audio');
  assertEqual(inferRuntimeRenderKind(item({ primaryFileMime: 'image/png', contentType: 'image', previewUrl: '', fullMediaUrl: null, coverUrl: 'https://node.test/art.png' }), ''), 'image');
  assertEqual(inferRuntimeRenderKind(item({ primaryFileMime: 'application/pdf', contentType: 'document', previewUrl: '', fullMediaUrl: null, coverUrl: 'https://node.test/doc.jpg' }), ''), 'document');

  const locked = resolveRuntimePlayback(item());
  assertEqual(locked.playback.mode, 'preview');
  assertEqual(locked.streamUrl, 'https://node.test/preview.mp4');

  const rawOwnedWithoutCanonicalPlayback = resolveRuntimePlayback(item({ accessMode: 'owned', owned: true, hasFullAccess: true, isLocked: false }));
  assertEqual(rawOwnedWithoutCanonicalPlayback.playback.mode, 'preview');
  assertEqual(rawOwnedWithoutCanonicalPlayback.streamUrl, 'https://node.test/preview.mp4');

  const free = resolveRuntimePlayback(item({ priceSats: 0, accessMode: 'unlocked', isFree: true, isLocked: false, owned: false, hasFullAccess: false }));
  assertEqual(free.playback.mode, 'full');


  const hydratedOwned = mergeCanonicalOffer(item({
    fullMediaUrl: null,
    fullContentUrl: null,
    mediaUrl: null,
    contentUrl: null,
  }), {
    priceSats: 1000,
    accessMode: 'owned',
    owned: true,
    playback: {
      mode: 'full',
      streamUrl: 'https://node.test/signed-full.mp4',
      canPlayFull: true,
      previewLimitSeconds: null,
    },
    previewUrl: 'https://node.test/signed-preview.mp4',
  }, {
    contentId: 'work-1',
    receiptToken: 'receipt-token',
    receiptId: 'receipt-1',
    paymentIntentId: null,
    paidAt: '2026-08-04T00:00:00.000Z',
    paymentMethod: 'bitcoin',
    invoiceProviderNodeId: 'node-1',
    access: 'unlocked',
    status: 'paid',
    paymentStatus: 'paid',
    canFulfill: true,
    unlocked: true,
  });
  const hydratedPlayback = resolveRuntimePlayback(hydratedOwned);
  assertEqual(hydratedPlayback.playback.mode, 'full');
  assertEqual(hydratedPlayback.streamUrl, 'https://node.test/signed-full.mp4');

  const premiumHydratedCanonicalFull = mergeCanonicalOffer(item({
    accessMode: 'locked',
    owned: false,
    hasFullAccess: false,
    fullMediaUrl: null,
    fullContentUrl: null,
    mediaUrl: null,
    contentUrl: null,
  }), {
    priceSats: 1000,
    accessMode: 'locked',
    playback: {
      mode: 'full',
      streamUrl: 'https://node.test/premium-signed-full.mp4',
      canPlayFull: true,
    },
    previewUrl: 'https://node.test/signed-preview.mp4',
  }, null, { trustCanonicalFullPlayback: true });
  const premiumHydratedPlayback = resolveRuntimePlayback(premiumHydratedCanonicalFull);
  assertEqual(premiumHydratedCanonicalFull.canonicalPlaybackAuthorized, true);
  assertEqual(premiumHydratedCanonicalFull.accessMode, 'owned');
  assertEqual(premiumHydratedCanonicalFull.owned, true);
  assertEqual(premiumHydratedCanonicalFull.hasFullAccess, true);
  assertEqual(premiumHydratedCanonicalFull.isLocked, false);
  assertEqual(premiumHydratedPlayback.playback.mode, 'full');
  assertEqual(premiumHydratedPlayback.streamUrl, 'https://node.test/premium-signed-full.mp4');

  const staleDiscoveryUnlockedCanonicalPreview = mergeCanonicalOffer(item({
    accessMode: 'owned',
    owned: true,
    hasFullAccess: true,
    fullMediaUrl: 'https://node.test/stale-discovery-full.mp4',
  }), {
    priceSats: 1000,
    accessMode: 'locked',
    playback: {
      mode: 'preview',
      streamUrl: 'https://node.test/canonical-preview.mp4',
      canPlayFull: false,
    },
    previewUrl: 'https://node.test/canonical-preview.mp4',
  }, null, { trustCanonicalFullPlayback: true });
  const staleDiscoveryPlayback = resolveRuntimePlayback(staleDiscoveryUnlockedCanonicalPreview);
  assertEqual(staleDiscoveryPlayback.playback.mode, 'preview');
  assertEqual(staleDiscoveryPlayback.streamUrl, 'https://node.test/canonical-preview.mp4');

  const firstPreviewKey = shortsPlaybackAttemptKey(true, 1, 'https://node.test/preview.mp4');
  const hydratedFullKey = shortsPlaybackAttemptKey(true, 2, 'https://node.test/full.mp4');
  const refreshedFullKey = shortsPlaybackAttemptKey(true, 3, 'https://node.test/full-refreshed.mp4');
  assertEqual(shouldAttemptShortsPlayback('', firstPreviewKey), true, 'active preview source starts playback');
  assertEqual(shouldAttemptShortsPlayback(firstPreviewKey, firstPreviewKey), false, 'same source and generation does not loop autoplay');
  assertEqual(shouldAttemptShortsPlayback(firstPreviewKey, hydratedFullKey), true, 'preview to full source change retries playback');
  assertEqual(shouldAttemptShortsPlayback(hydratedFullKey, refreshedFullKey), true, 'refreshed signed stream URL retries playback');
  assertEqual(shouldAttemptShortsPlayback(hydratedFullKey, shortsPlaybackAttemptKey(false, 4, 'https://node.test/inactive.mp4')), false, 'inactive slide hydration does not steal playback');

  const freePreviewOnly = resolveRuntimePlayback(item({
    priceSats: 0,
    accessMode: 'unlocked',
    isFree: true,
    isLocked: false,
    owned: false,
    hasFullAccess: false,
    fullMediaUrl: null,
    previewUrl: 'https://node.test/free-only.mp4',
  }));
  assertEqual(freePreviewOnly.playback.mode, 'full');
  assertEqual(freePreviewOnly.streamUrl, 'https://node.test/free-only.mp4');
}

run();
