import { mergeCanonicalOffer } from './hydration';
import { resolveRuntimePlayback } from './playback';
import { inferRuntimeRenderKind } from './render';
import { contentRuntimeItemKey } from './shorts';
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

  const barePremiumPreview = resolveRuntimePlayback(item({
    previewUrl: 'https://node.test/public/content/work-1/preview-file',
  }));
  assertEqual(barePremiumPreview.playback.mode, 'none');
  assertEqual(barePremiumPreview.streamUrl, '');

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
