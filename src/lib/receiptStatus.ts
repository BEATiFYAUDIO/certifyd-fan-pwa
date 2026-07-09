import type { DiscoverableItem } from './types';
import { receiptProofsForItem, rememberReceiptProofForItem, type ReceiptProof } from './receiptProofs';
import { normalizeCanonicalOrigin } from './origin';

export type ReceiptAccessStatus = {
  contentId: string | null;
  receiptToken: string | null;
  receiptId: string | null;
  paymentIntentId: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  invoiceProviderNodeId: string | null;
  access: string | null;
  status: string | null;
  paymentStatus: string | null;
  canFulfill: boolean;
  unlocked: boolean;
};

function clean(value: unknown): string {
  return String(value || '').trim();
}

function debugReceiptPropagation(...args: unknown[]) {
  if (typeof window === 'undefined') return;
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return;
  console.debug('[Certifyd receipt propagation]', ...args);
}

function lower(value: unknown): string {
  return clean(value).toLowerCase();
}

export function isReceiptStatusUnlocked(status: ReceiptAccessStatus | null | undefined): boolean {
  if (!status) return false;
  return status.unlocked ||
    lower(status.access) === 'unlocked' ||
    status.canFulfill === true ||
    lower(status.status) === 'paid' ||
    lower(status.paymentStatus) === 'paid';
}

export function receiptStatusMatchesItem(status: ReceiptAccessStatus | null | undefined, item: Pick<DiscoverableItem, 'contentId'>): boolean {
  if (!status) return false;
  const statusContentId = clean(status.contentId);
  return !statusContentId || statusContentId === clean(item.contentId);
}

function normalizeReceiptStatus(payload: unknown): ReceiptAccessStatus | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const unlocked = lower(record.access) === 'unlocked' ||
    record.canFulfill === true ||
    lower(record.status) === 'paid' ||
    lower(record.paymentStatus) === 'paid';
  return {
    contentId: clean(record.contentId) || null,
    receiptToken: clean(record.receiptToken) || null,
    receiptId: clean(record.receiptId) || null,
    paymentIntentId: clean(record.paymentIntentId) || null,
    paidAt: clean(record.paidAt) || null,
    paymentMethod: clean(record.paymentMethod) || null,
    invoiceProviderNodeId: clean(record.invoiceProviderNodeId) || null,
    access: clean(record.access) || null,
    status: clean(record.status) || null,
    paymentStatus: clean(record.paymentStatus) || null,
    canFulfill: record.canFulfill === true,
    unlocked,
  };
}

function statusUrlsForProof(item: DiscoverableItem, proof: ReceiptProof): string[] {
  const origin = normalizeCanonicalOrigin(proof.publicOrigin) || normalizeCanonicalOrigin(item.publicOrigin);
  if (!origin) return [];
  const urls: string[] = [];
  const receiptId = clean(proof.receiptId);
  const receiptToken = clean(proof.receiptToken);
  if (receiptToken) urls.push(`${origin}/buy/receipts/${encodeURIComponent(receiptToken)}/status`);
  if (receiptId) urls.push(`${origin}/buy/receipts/r/${encodeURIComponent(receiptId)}/status`);
  return urls;
}

function accessStatusUrlForItem(item: DiscoverableItem): string | null {
  const origin = normalizeCanonicalOrigin(item.publicOrigin);
  const contentId = clean(item.contentId);
  if (!origin || !contentId) return null;
  return `${origin}/buy/content/${encodeURIComponent(contentId)}/access-status`;
}

async function fetchReceiptStatusUrl(url: string): Promise<ReceiptAccessStatus | null> {
  debugReceiptPropagation('calling receipt status URL', { url });
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    debugReceiptPropagation('receipt status HTTP failure', { url, status: response.status, statusText: response.statusText });
    return null;
  }
  const payload = await response.json();
  const status = normalizeReceiptStatus(payload);
  debugReceiptPropagation('receipt status response', { url, payload, normalized: status });
  return status;
}

async function hydrateNodeAccessStatusForItem(item: DiscoverableItem): Promise<ReceiptAccessStatus | null> {
  const url = accessStatusUrlForItem(item);
  if (!url) return null;
  try {
    debugReceiptPropagation('calling node access status URL', {
      url,
      origin: normalizeCanonicalOrigin(item.publicOrigin),
      contentId: item.contentId,
    });
    const status = await fetchReceiptStatusUrl(url);
    if (!status) return null;
    if (!receiptStatusMatchesItem(status, item)) {
      debugReceiptPropagation('node access status contentId mismatch', { itemContentId: item.contentId, status });
      return null;
    }
    if (status.receiptId || status.receiptToken || status.paymentIntentId) {
      rememberReceiptProofForItem(item, {
        publicOrigin: item.publicOrigin,
        receiptToken: status.receiptToken || undefined,
        receiptId: status.receiptId || undefined,
        paymentIntentId: status.paymentIntentId || undefined,
        paidAt: status.paidAt || undefined,
      });
    }
    debugReceiptPropagation('node access status result', {
      origin: normalizeCanonicalOrigin(item.publicOrigin),
      contentId: item.contentId,
      receiptId: status.receiptId,
      access: status.access,
      paymentStatus: status.paymentStatus,
      unlocked: isReceiptStatusUnlocked(status),
    });
    return isReceiptStatusUnlocked(status) ? status : null;
  } catch (error) {
    debugReceiptPropagation('node access status fetch blocked or failed', { url, error });
    return null;
  }
}

export async function hydrateReceiptStatusForItem(item: DiscoverableItem): Promise<ReceiptAccessStatus | null> {
  const nodeAccessStatus = await hydrateNodeAccessStatusForItem(item);
  if (nodeAccessStatus) return nodeAccessStatus;

  const proofs = receiptProofsForItem(item);
  debugReceiptPropagation('hydrating receipt status for item', {
    item: { contentId: item.contentId, publicOrigin: item.publicOrigin },
    proofs,
  });
  for (const proof of proofs) {
    const urls = statusUrlsForProof(item, proof);
    debugReceiptPropagation('receipt status URLs for proof', { proof, urls });
    for (const url of urls) {
      try {
        const status = await fetchReceiptStatusUrl(url);
        if (!status) continue;
        if (!receiptStatusMatchesItem(status, item)) {
          debugReceiptPropagation('receipt status contentId mismatch', { itemContentId: item.contentId, status });
          continue;
        }
        rememberReceiptProofForItem(item, {
          receiptToken: status.receiptToken || proof.receiptToken,
          receiptId: status.receiptId || proof.receiptId,
          paymentIntentId: status.paymentIntentId || proof.paymentIntentId,
          paidAt: status.paidAt || proof.paidAt,
        });
        if (isReceiptStatusUnlocked(status)) {
          debugReceiptPropagation('receipt status unlocked item', { item: { contentId: item.contentId, publicOrigin: item.publicOrigin }, status });
          return status;
        }
        debugReceiptPropagation('receipt status did not unlock item', { item: { contentId: item.contentId, publicOrigin: item.publicOrigin }, status });
      } catch (error) {
        debugReceiptPropagation('receipt status fetch blocked or failed', { url, error });
      }
    }
  }
  debugReceiptPropagation('no unlocked receipt status for item', { item: { contentId: item.contentId, publicOrigin: item.publicOrigin } });
  return null;
}
