import { fetchCanonicalOfferPayload } from './offerFetch';
import { hydrateReceiptStatusForItem } from './receiptStatus';
import type { DiscoverableItem } from './types';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function item(overrides: Partial<DiscoverableItem> = {}): DiscoverableItem {
  return {
    contentId: 'paid-work',
    title: 'Paid Work',
    description: null,
    creatorHandle: 'creator',
    contentType: 'audio',
    primaryTopic: 'music',
    coverUrl: 'https://creator.test/cover.jpg',
    previewUrl: 'https://creator.test/preview.mp3',
    buyUrl: 'https://creator.test/buy/paid-work',
    offerUrl: 'https://creator.test/buy/content/paid-work/offer',
    priceSats: 1000,
    accessMode: 'locked',
    publicOrigin: 'https://creator.test',
    ...overrides,
  };
}

async function runFanEntitlementRegressionChecks() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; credentials: RequestCredentials | undefined }> = [];
  try {
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const url = String(_url);
      calls.push({ url, credentials: init?.credentials });
      if (url.includes('/offer')) {
        return new Response(JSON.stringify({
          offer: {
            priceSats: 1000,
            accessMode: init?.credentials === 'include' ? 'owned' : 'locked',
            playback: init?.credentials === 'include'
              ? { mode: 'full', streamUrl: '/owner-cookie-full.mp3', canPlayFull: true }
              : { mode: 'preview', streamUrl: '/preview.mp3', canPlayFull: false },
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/access-status')) {
        return new Response(JSON.stringify({
          contentId: 'paid-work',
          access: 'unlocked',
          status: 'paid',
          paymentStatus: 'paid',
          canFulfill: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const offer = await fetchCanonicalOfferPayload(['https://creator.test/buy/content/paid-work/offer']);
    assert(calls[0]?.credentials === 'omit', 'offer fetch tries anonymous/public state first');
    assert(offer?.accessMode === 'locked', 'credentialed creator cookies do not override public offer state');

    const bareStatus = await hydrateReceiptStatusForItem(item());
    assert(!bareStatus, 'paid content does not unlock from bare access-status without receipt proof');

    const proofStatus = await hydrateReceiptStatusForItem(item({
      paymentAccessProof: {
        paymentReceiptId: 'rcpt_paid',
        paymentState: 'paid',
        entitlementState: 'owned',
      },
    }));
    assert(Boolean(proofStatus), 'paid content can unlock when access-status URL carries receipt proof');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void runFanEntitlementRegressionChecks();
