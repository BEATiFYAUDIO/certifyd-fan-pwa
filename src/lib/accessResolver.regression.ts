import { resolveAccessFromOffer, type CanonicalOffer } from './accessResolver';
import { normalizeCanonicalOrigin } from './origin';
import { receiptProofsForItem, withReceiptProofs } from './receiptProofs';
import { isReceiptStatusUnlocked, type ReceiptAccessStatus } from './receiptStatus';
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
    receiptToken: 'receipt-token-1',
    receiptId: 'receipt-1',
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

  const staleReceipt = receiptStatus({ access: 'locked', status: 'open', paymentStatus: 'requires_payment_method', canFulfill: false, unlocked: false });
  assert(!isReceiptStatusUnlocked(staleReceipt), 'receipt helper does not unlock stale/failed status');
  const staleLocked = resolveAccessFromOffer(item, lockedOffer, staleReceipt);
  assert(staleLocked.isLocked && staleLocked.playback.mode === 'preview', 'stale/failed receipt remains locked');

  const freeItem = fixtureItem({ priceSats: 0, accessMode: 'unlocked', isFree: true });
  const freePlayback = resolveAccessFromOffer(freeItem, { priceSats: 0, isFree: true, fullMediaUrl: '/free.mp3', accessMode: 'unlocked' });
  assert(!freePlayback.isLocked && freePlayback.playback.mode === 'full', 'free content still plays full');

  const paidFullFallback = resolveAccessFromOffer(item, paidOffer({ previewUrl: '', playback: null }));
  assert(paidFullFallback.playback.mode !== 'full', 'paid locked never plays full fallback URL');

  const canPlayFullOnly = resolveAccessFromOffer(item, paidOffer({ playback: { mode: 'full', streamUrl: '/full.mp3', canPlayFull: true } }));
  assert(canPlayFullOnly.isLocked && canPlayFullOnly.playback.mode !== 'full', 'paid content does not unlock from playback canPlayFull alone');

  const watchPage = resolveAccessFromOffer(item, lockedOffer, paidReceipt);
  const player = resolveAccessFromOffer(item, lockedOffer, paidReceipt);
  assert(watchPage.accessMode === player.accessMode && watchPage.playback.mode === player.playback.mode, 'WatchPage and player resolve same state');

  const refreshed = resolveAccessFromOffer(item, lockedOffer, paidReceipt);
  assert(refreshed.accessMode === receiptUnlocked.accessMode && refreshed.playback.mode === receiptUnlocked.playback.mode, 'refresh preserves same receipt access');

  installMockWindow('?origin=https%3A%2F%2Fcreator.test&receiptId=receipt-1');
  const originProofs = receiptProofsForItem(item);
  assert(originProofs[0]?.publicOrigin === 'https://creator.test', 'localhost handoff stores canonical contentbox origin');
  assert(originProofs[0]?.receiptId === 'receipt-1' && !originProofs[0]?.receiptToken, 'receiptId durable fallback is stored without receiptToken');
  const rewrittenOfferUrl = withReceiptProofs('http://localhost:5174/buy/content/content-1/offer', item)[0] || '';
  assert(rewrittenOfferUrl.startsWith('https://creator.test/buy/content/content-1/offer'), 'offer URL with proof uses contentbox origin, not localhost');
  assert(rewrittenOfferUrl.includes('receiptId=receipt-1'), 'offer URL includes receiptId fallback');

  assert(normalizeCanonicalOrigin('javascript:alert(1)') === '', 'malformed origin is ignored');
  installMockWindow('?origin=javascript%3Aalert(1)&receiptId=receipt-2');
  const malformedOriginProofs = receiptProofsForItem(item);
  assert(malformedOriginProofs[0]?.publicOrigin === item.publicOrigin, 'malformed URL origin falls back to item origin');

  const durableReceiptUrl = parseRestoreAccessInput('https://creator.test/buy/receipt/receipt-3', item.publicOrigin);
  assert(durableReceiptUrl.publicOrigin === 'https://creator.test' && durableReceiptUrl.receiptId === 'receipt-3', 'restore parser reads receipt page URL');

  const statusReceiptUrl = parseRestoreAccessInput('https://creator.test/buy/receipts/r/receipt-4/status', item.publicOrigin);
  assert(statusReceiptUrl.publicOrigin === 'https://creator.test' && statusReceiptUrl.receiptId === 'receipt-4', 'restore parser reads durable status URL');

  const tokenStatusUrl = parseRestoreAccessInput('https://creator.test/buy/receipts/token-1/status', item.publicOrigin);
  assert(tokenStatusUrl.publicOrigin === 'https://creator.test' && tokenStatusUrl.receiptToken === 'token-1', 'restore parser reads token status URL');

  const tokenPrefix = parseRestoreAccessInput('receiptToken: token-2', item.publicOrigin);
  assert(tokenPrefix.receiptToken === 'token-2', 'restore parser respects receiptToken prefix');

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
