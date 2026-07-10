import { resolveAccessFromOffer, type CanonicalOffer } from './accessResolver';
import { normalizeCanonicalOrigin } from './origin';
import { receiptProofsForItem, withReceiptProofs } from './receiptProofs';
import { accessStatusUrlsForItem, isReceiptStatusUnlocked, type ReceiptAccessStatus } from './receiptStatus';
import { parseRestoreAccessInput } from './restoreAccess';
import { buyUrlWithFanReturnUrl, contentboxBuyUrlForItem } from './fanReturnUrl';
import type { DiscoverableItem } from './types';

function fixtureItem(overrides: Partial<DiscoverableItem> = {}): DiscoverableItem {
  return {
    contentId: 'content-1',
    title: 'Test Content',
    description: null,
    creatorHandle: 'creator',
    contentType: 'audio',
    primaryTopic: 'music',
    coverUrl: 'https://creator.test/cover.jpg',
    previewUrl: 'https://creator.test/preview.mp3',
    buyUrl: 'https://creator.test/buy/content/content-1',
    offerUrl: 'https://creator.test/buy/content/content-1/offer',
    priceSats: 100,
    accessMode: 'locked',
    publicOrigin: 'https://creator.test',
    ...overrides,
  };
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function installMockWindow(search: string) {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    location: { hostname: 'localhost', search },
    localStorage: {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  };
  return store;
}

function paidOffer(overrides: CanonicalOffer = {}): CanonicalOffer {
  return {
    priceSats: 100,
    previewUrl: '/preview.mp3',
    fullMediaUrl: '/full.mp3',
    accessMode: 'locked',
    ...overrides,
  };
}

function receiptStatus(overrides: Partial<ReceiptAccessStatus> = {}): ReceiptAccessStatus {
  return {
    contentId: 'content-1',
    receiptToken: 'rcpt_status_1',
    receiptId: 'rct_1',
    paymentIntentId: 'pi_1',
    paidAt: '2026-07-08T00:00:00.000Z',
    paymentMethod: null,
    invoiceProviderNodeId: null,
    access: null,
    status: null,
    paymentStatus: null,
    canFulfill: false,
    unlocked: false,
    ...overrides,
  };
}

export function runAccessResolverRegressionChecks() {
  const item = fixtureItem();
  const lockedOffer = paidOffer({ accessMode: 'locked', playback: { mode: 'preview', streamUrl: '/preview.mp3', canPlayFull: false } });
  const paidReceipt = receiptStatus({ access: 'unlocked', status: 'paid', paymentStatus: 'paid', canFulfill: true, unlocked: true });
  assert(isReceiptStatusUnlocked(paidReceipt), 'receipt helper treats paid/unlocked status as unlocked');

  const receiptUnlocked = resolveAccessFromOffer(item, lockedOffer, paidReceipt);
  assert(!receiptUnlocked.isLocked, 'offer locked but receipt paid/unlocked resolves unlocked');
  assert(receiptUnlocked.playback.mode === 'full', 'receipt-unlocked paid content receives full playback when offer has full URL');
  assert(receiptUnlocked.hasViewerAccess && receiptUnlocked.owned && receiptUnlocked.accessMode === 'owned', 'receipt-unlocked paid content is full access and owned');

  const itemFullMedia = resolveAccessFromOffer(
    fixtureItem({ fullMediaUrl: 'https://creator.test/full-from-item.mp3' }),
    paidOffer({ fullMediaUrl: '', fullContentUrl: '', mediaUrl: '', contentUrl: '', playback: { mode: 'preview', streamUrl: '/preview.mp3', canPlayFull: false } }),
    paidReceipt,
  );
  assert(itemFullMedia.playback.mode === 'full' && itemFullMedia.playback.streamUrl === 'https://creator.test/full-from-item.mp3', 'receipt-proven access may use item full media fallback');

  const wrongContentReceipt = receiptStatus({ contentId: 'other-content', access: 'unlocked', status: 'paid', paymentStatus: 'paid', canFulfill: true, unlocked: true });
  const wrongContent = resolveAccessFromOffer(item, lockedOffer, wrongContentReceipt);
  assert(wrongContent.isLocked && wrongContent.playback.mode === 'preview', 'receipt for a different contentId does not unlock playback');

  const noReceipt = resolveAccessFromOffer(item, lockedOffer);
  assert(noReceipt.isLocked, 'no receipt keeps paid offer locked');
  assert(noReceipt.playback.mode === 'preview', 'no receipt keeps paid offer in preview');

  const canonicalPreviewOnly = resolveAccessFromOffer(
    item,
    paidOffer({
      previewUrl: '',
      fullMediaUrl: '/full.mp3',
      fullContentUrl: '/full-content.mp3',
      mediaUrl: '/media.mp3',
      contentUrl: '/content.mp3',
      playback: { mode: 'preview', streamUrl: '/canonical-preview.mp3', canPlayFull: false },
    }),
  );
  assert(canonicalPreviewOnly.isLocked, 'paid locked canonical preview remains locked');
  assert(canonicalPreviewOnly.playback.mode === 'preview', 'paid locked canonical playback.streamUrl is playable as preview');
  assert(canonicalPreviewOnly.playback.streamUrl === '/canonical-preview.mp3', 'paid locked preview uses canonical preview stream');
  assert(canonicalPreviewOnly.playback.canPlayFull === false, 'paid locked canonical preview cannot play full');

  const receiptProtectedLocked = resolveAccessFromOffer(
    fixtureItem({ hasLockedSplitSnapshot: true, previewUrl: '' }),
    paidOffer({ previewUrl: '', playback: { mode: 'preview', streamUrl: '/receipt-protected-preview.mp3', canPlayFull: false } }),
  );
  assert(receiptProtectedLocked.isLocked && receiptProtectedLocked.playback.mode === 'preview', 'receipt-protected locked content plays preview');

  const discoveryOwnedWithoutProof = resolveAccessFromOffer(
    fixtureItem({ accessMode: 'owned', owned: true, hasFullAccess: true, fullMediaUrl: 'https://creator.test/discovery-full.mp3' }),
    paidOffer({ accessMode: 'locked', playback: { mode: 'preview', streamUrl: '/preview.mp3', canPlayFull: false } }),
  );
  assert(discoveryOwnedWithoutProof.isLocked && discoveryOwnedWithoutProof.playback.mode === 'preview', 'paid content does not infer ownership from discovery metadata');

  const canonicalOwned = resolveAccessFromOffer(
    item,
    paidOffer({ accessMode: 'owned', owned: true, hasFullAccess: true, playback: { mode: 'full', streamUrl: '/canonical-full.mp3', canPlayFull: true } }),
  );
  assert(canonicalOwned.owned && canonicalOwned.playback.mode === 'full' && canonicalOwned.playback.streamUrl === '/canonical-full.mp3', 'paid owned canonical offer plays full');

  const staleReceipt = receiptStatus({ access: 'locked', status: 'open', paymentStatus: 'requires_payment_method', canFulfill: false, unlocked: false });
  assert(!isReceiptStatusUnlocked(staleReceipt), 'receipt helper does not unlock stale/failed status');
  const staleLocked = resolveAccessFromOffer(item, lockedOffer, staleReceipt);
  assert(staleLocked.isLocked && staleLocked.playback.mode === 'preview', 'stale/failed receipt remains locked');

  const freeItem = fixtureItem({ priceSats: 0, accessMode: 'unlocked', isFree: true });
  const freePlayback = resolveAccessFromOffer(freeItem, { priceSats: 0, isFree: true, fullMediaUrl: '/free.mp3', accessMode: 'unlocked' });
  assert(!freePlayback.isLocked && freePlayback.playback.mode === 'full', 'free content still plays full');

  const paidFullFallback = resolveAccessFromOffer(item, paidOffer({ previewUrl: '', playback: null }));
  assert(paidFullFallback.playback.mode !== 'full', 'paid locked never plays full fallback URL');

  const unavailableNoPreview = resolveAccessFromOffer(
    fixtureItem({ previewUrl: '', fullMediaUrl: 'https://creator.test/full-from-discovery.mp3' }),
    paidOffer({ previewUrl: '', playback: null }),
  );
  assert(unavailableNoPreview.isLocked && unavailableNoPreview.playback.mode === 'none', 'paid locked with no preview and no access is unavailable');
  assert(unavailableNoPreview.playback.streamUrl === null, 'unavailable paid locked content exposes no stream URL');

  const canPlayFullOnly = resolveAccessFromOffer(item, paidOffer({ playback: { mode: 'full', streamUrl: '/full.mp3', canPlayFull: true } }));
  assert(canPlayFullOnly.isLocked && canPlayFullOnly.playback.mode !== 'full', 'paid content does not unlock from playback canPlayFull alone');

  const watchPage = resolveAccessFromOffer(item, lockedOffer, paidReceipt);
  const player = resolveAccessFromOffer(item, lockedOffer, paidReceipt);
  assert(watchPage.accessMode === player.accessMode && watchPage.playback.mode === player.playback.mode, 'WatchPage and player resolve same state');

  const refreshed = resolveAccessFromOffer(item, lockedOffer, paidReceipt);
  assert(refreshed.accessMode === receiptUnlocked.accessMode && refreshed.playback.mode === receiptUnlocked.playback.mode, 'refresh preserves same receipt access');

  installMockWindow('?origin=https%3A%2F%2Fcreator.test&receiptId=rct_1');
  const originProofs = receiptProofsForItem(item);
  assert(originProofs[0]?.publicOrigin === 'https://creator.test', 'localhost handoff stores canonical contentbox origin');
  assert(originProofs[0]?.receiptId === 'rct_1' && !originProofs[0]?.receiptToken, 'receiptId durable fallback is stored without receiptToken');
  const rewrittenOfferUrl = withReceiptProofs('http://localhost:5174/buy/content/content-1/offer', item)[0] || '';
  assert(rewrittenOfferUrl.startsWith('https://creator.test/buy/content/content-1/offer'), 'offer URL with proof uses contentbox origin, not localhost');
  assert(rewrittenOfferUrl.includes('receiptId=rct_1'), 'offer URL includes receiptId fallback');

  assert(normalizeCanonicalOrigin('javascript:alert(1)') === '', 'malformed origin is ignored');
  installMockWindow('?origin=javascript%3Aalert(1)&receiptId=rct_2');
  const malformedOriginProofs = receiptProofsForItem(item);
  assert(malformedOriginProofs[0]?.publicOrigin === item.publicOrigin, 'malformed URL origin falls back to item origin');

  const durableReceiptUrl = parseRestoreAccessInput('https://creator.test/buy/receipt/rct_3', item.publicOrigin);
  assert(durableReceiptUrl.publicOrigin === 'https://creator.test' && durableReceiptUrl.receiptId === 'rct_3', 'restore parser reads receipt page URL');

  const statusReceiptUrl = parseRestoreAccessInput('https://creator.test/buy/receipts/r/rct_4/status', item.publicOrigin);
  assert(statusReceiptUrl.publicOrigin === 'https://creator.test' && statusReceiptUrl.receiptId === 'rct_4', 'restore parser reads durable status URL');

  const tokenStatusUrl = parseRestoreAccessInput('https://creator.test/buy/receipts/rcpt_token_1/status', item.publicOrigin);
  assert(tokenStatusUrl.publicOrigin === 'https://creator.test' && tokenStatusUrl.receiptToken === 'rcpt_token_1', 'restore parser reads token status URL');

  const tokenPrefix = parseRestoreAccessInput('receiptToken: rcpt_token_2', item.publicOrigin);
  assert(tokenPrefix.receiptToken === 'rcpt_token_2', 'restore parser respects receiptToken prefix');

  installMockWindow('?origin=https%3A%2F%2Fcreator.test&receiptToken=rcpt_legacy');
  const legacyReceiptProofs = receiptProofsForItem(item);
  assert(legacyReceiptProofs[0]?.receiptToken === 'rcpt_legacy', 'rcpt_ proof remains available as receiptToken');
  assert(legacyReceiptProofs[0]?.receiptId === 'rcpt_legacy', 'rcpt_ proof is also repaired as legacy receiptId');
  const legacyAccessStatusUrl = accessStatusUrlsForItem(item)[0] || '';
  assert(legacyAccessStatusUrl === 'https://creator.test/buy/content/content-1/access-status?receiptId=rcpt_legacy', 'legacy rcpt_ proof is sent as receiptId to access-status first');

  installMockWindow('?origin=https%3A%2F%2Fcreator.test&receiptId=rct_durable');
  const durableAccessStatusUrl = accessStatusUrlsForItem(item)[0] || '';
  assert(durableAccessStatusUrl === 'https://creator.test/buy/content/content-1/access-status?receiptId=rct_durable', 'rct_ durable proof is sent as receiptId to access-status');

  const wrongContentStore = installMockWindow('');
  wrongContentStore.set('certifyd-player:receipt-proofs:v1', JSON.stringify([{
    contentId: 'other-content',
    publicOrigin: 'https://creator.test',
    receiptId: 'rct_wrong',
  }]));
  const wrongContentAccessUrls = accessStatusUrlsForItem(item);
  assert(!wrongContentAccessUrls.some((url) => url.includes('rct_wrong')), 'wrong contentId proof is not sent to access-status');

  const stalePlusGoodStore = installMockWindow('');
  stalePlusGoodStore.set('certifyd-player:receipt-proofs:v1', JSON.stringify([
    {
      contentId: 'content-1',
      publicOrigin: 'https://creator.test',
      receiptId: '_600e4c0f...8_454ff8',
    },
    {
      contentId: 'content-1',
      publicOrigin: 'https://creator.test',
      receiptId: 'rcpt_good',
      receiptToken: 'rcpt_good',
      paymentIntentId: 'pi_good',
      paidAt: '2026-07-04T05:32:00.000Z',
    },
  ]));
  const repairedProofs = receiptProofsForItem(item);
  assert(repairedProofs.length === 1, 'truncated placeholder proof is dropped during migration');
  assert(repairedProofs[0]?.receiptId === 'rcpt_good', 'good rcpt_ proof remains after stale proof is dropped');
  const stalePlusGoodAccessUrls = accessStatusUrlsForItem(item);
  assert(stalePlusGoodAccessUrls[0] === 'https://creator.test/buy/content/content-1/access-status?receiptId=rcpt_good', 'good proof is tried before bare access-status when stale proof existed first');
  assert(!stalePlusGoodAccessUrls.some((url) => url.includes('_600e4c0f')), 'invalid truncated proof is never sent to access-status');

  (globalThis as unknown as { window: { location: Record<string, string> } }).window.location = {
    hostname: 'localhost',
    origin: 'http://localhost:5174',
    href: 'http://localhost:5174/watch/content-1?origin=https%3A%2F%2Fcreator.test',
    search: '?origin=https%3A%2F%2Fcreator.test',
  };
  const canonicalBuyUrl = contentboxBuyUrlForItem(item);
  assert(canonicalBuyUrl === 'https://creator.test/buy/content-1', 'contentbox buy URL uses canonical origin');
  const repairedBuyUrl = buyUrlWithFanReturnUrl('http://localhost:5174/watch/content-1?origin=https%3A%2F%2Fcreator.test', item);
  assert(repairedBuyUrl.startsWith('https://creator.test/buy/content-1?'), 'fan watch URL is repaired to contentbox buy URL');
  assert(repairedBuyUrl.includes('returnUrl=http%3A%2F%2Flocalhost%3A5174%2Fwatch%2Fcontent-1'), 'purchase URL carries fan returnUrl');

  const repairedProfileUrl = buyUrlWithFanReturnUrl('https://creator.test/u/creator', item);
  assert(repairedProfileUrl.startsWith('https://creator.test/buy/content-1?'), 'creator profile URL is repaired to contentbox buy URL');
}

runAccessResolverRegressionChecks();
