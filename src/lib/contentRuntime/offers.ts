import type { CanonicalOffer } from '../accessResolver';
import { fetchCanonicalOfferPayload, normalizeCanonicalOffer } from '../offerFetch';
import { rememberReceiptProofForItem, withReceiptProofs } from '../receiptProofs';
import { hydrateReceiptStatusForItem, type ReceiptAccessStatus } from '../receiptStatus';
import type { DiscoverableItem } from '../types';
import { resolveAbsoluteUrl } from './urls';

export type CanonicalOfferResult = {
  offer: CanonicalOffer | null;
  receiptStatus: ReceiptAccessStatus | null;
};

export async function fetchCanonicalOfferForItem(item: DiscoverableItem): Promise<CanonicalOfferResult> {
  let receiptStatus = await hydrateReceiptStatusForItem(item);
  const canonicalOfferUrl = resolveAbsoluteUrl(`/buy/content/${encodeURIComponent(item.contentId)}/offer`, item.publicOrigin);
  const baseOfferUrls = [...new Set([String(item.offerUrl || '').trim(), canonicalOfferUrl].filter(Boolean))];
  const offerUrls = baseOfferUrls.flatMap((offerUrl) => withReceiptProofs(offerUrl, item));
  const offer = normalizeCanonicalOffer(await fetchCanonicalOfferPayload(offerUrls)) as CanonicalOffer | null;
  const paymentAccessProof = offer?.paymentAccessProof && typeof offer.paymentAccessProof === 'object'
    ? offer.paymentAccessProof as Record<string, unknown>
    : null;
  rememberReceiptProofForItem(item, {
    receiptId: typeof paymentAccessProof?.paymentReceiptId === 'string' ? paymentAccessProof.paymentReceiptId : typeof offer?.receiptId === 'string' ? offer.receiptId : undefined,
    receiptToken: typeof paymentAccessProof?.receiptToken === 'string' ? paymentAccessProof.receiptToken : typeof offer?.receiptToken === 'string' ? offer.receiptToken : undefined,
    paymentIntentId: typeof paymentAccessProof?.paymentIntentId === 'string' ? paymentAccessProof.paymentIntentId : typeof offer?.paymentIntentId === 'string' ? offer.paymentIntentId : undefined,
    paidAt: typeof paymentAccessProof?.paidAt === 'string' ? paymentAccessProof.paidAt : typeof offer?.paidAt === 'string' ? offer.paidAt : undefined,
  });
  if (!receiptStatus) receiptStatus = await hydrateReceiptStatusForItem(item);
  return { offer, receiptStatus };
}
