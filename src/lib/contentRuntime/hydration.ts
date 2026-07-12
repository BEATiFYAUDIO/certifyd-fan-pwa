import { resolveAccessFromOffer, type CanonicalOffer } from '../accessResolver';
import type { ReceiptAccessStatus } from '../receiptStatus';
import type { DiscoverableItem } from '../types';
import { fetchCanonicalOfferForItem } from './offers';
import { resolveAbsoluteUrl } from './urls';

function previewSecondsValue(...values: unknown[]): DiscoverableItem['previewSeconds'] {
  for (const value of values) {
    if (typeof value === 'number' || typeof value === 'string' || value === null) return value;
  }
  return null;
}

export function mergeCanonicalOffer(item: DiscoverableItem, offer: CanonicalOffer, receiptStatus: ReceiptAccessStatus | null): DiscoverableItem {
  const origin = item.publicOrigin;
  const access = resolveAccessFromOffer(item, offer, receiptStatus);
  return {
    ...item,
    title: typeof offer.title === 'string' && offer.title.trim() ? offer.title : item.title,
    description: typeof offer.description === 'string' ? offer.description : item.description,
    contentType: typeof offer.type === 'string' && offer.type.trim()
      ? offer.type
      : (typeof offer.contentType === 'string' && offer.contentType.trim() ? offer.contentType : item.contentType),
    primaryTopic: typeof offer.primaryTopic === 'string' && offer.primaryTopic.trim()
      ? offer.primaryTopic as DiscoverableItem['primaryTopic']
      : item.primaryTopic,
    creatorHandle: typeof offer.creatorHandle === 'string' && offer.creatorHandle.trim() ? offer.creatorHandle : item.creatorHandle,
    profileTheme: offer.profileTheme && typeof offer.profileTheme === 'object' ? offer.profileTheme as DiscoverableItem['profileTheme'] : item.profileTheme,
    coverUrl: resolveAbsoluteUrl(offer.coverUrl, origin) || item.coverUrl,
    previewUrl: access.playback.mode === 'preview'
      ? resolveAbsoluteUrl(access.playback.streamUrl, origin) || resolveAbsoluteUrl(offer.previewUrl, origin) || item.previewUrl
      : resolveAbsoluteUrl(offer.previewUrl, origin) || item.previewUrl,
    fullMediaUrl: access.playback.mode === 'full'
      ? resolveAbsoluteUrl(access.playback.streamUrl, origin) || resolveAbsoluteUrl(offer.fullMediaUrl, origin) || item.fullMediaUrl || null
      : null,
    fullContentUrl: access.playback.mode === 'full'
      ? resolveAbsoluteUrl(access.playback.streamUrl, origin) || resolveAbsoluteUrl(offer.fullContentUrl, origin) || item.fullContentUrl || null
      : null,
    mediaUrl: access.playback.mode === 'full' ? resolveAbsoluteUrl(offer.mediaUrl, origin) || item.mediaUrl || null : null,
    contentUrl: access.playback.mode === 'full' ? resolveAbsoluteUrl(offer.contentUrl, origin) || item.contentUrl || null : null,
    buyUrl: resolveAbsoluteUrl(offer.buyUrl, origin) || item.buyUrl,
    offerUrl: resolveAbsoluteUrl(offer.offerUrl, origin) || item.offerUrl || resolveAbsoluteUrl(`/buy/content/${encodeURIComponent(item.contentId)}/offer`, origin),
    priceSats: access.priceSats,
    accessMode: access.accessMode,
    isLocked: access.isLocked,
    isFree: access.isFree,
    hasFullAccess: access.owned,
    owned: access.owned,
    canonicalOfferHydrated: true,
    previewSeconds: previewSecondsValue(access.playback.previewLimitSeconds, offer.previewSeconds, offer.previewDurationSeconds, offer.previewLimitSeconds, item.previewSeconds),
    primaryFileMime: typeof offer.primaryFileMime === 'string' ? offer.primaryFileMime : item.primaryFileMime,
    paymentAccessProof: offer.paymentAccessProof && typeof offer.paymentAccessProof === 'object'
      ? offer.paymentAccessProof as DiscoverableItem['paymentAccessProof']
      : item.paymentAccessProof,
  };
}

export async function hydrateCanonicalOfferForItem(item: DiscoverableItem): Promise<DiscoverableItem> {
  const { offer, receiptStatus } = await fetchCanonicalOfferForItem(item);
  return offer ? mergeCanonicalOffer(item, offer, receiptStatus) : item;
}
