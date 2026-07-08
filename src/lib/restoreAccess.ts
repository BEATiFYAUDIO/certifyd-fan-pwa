import { normalizeCanonicalOrigin } from './origin';
import { rememberReceiptProofForItem, type ReceiptProof } from './receiptProofs';
import { hydrateReceiptStatusForItem, isReceiptStatusUnlocked } from './receiptStatus';
import type { DiscoverableItem } from './types';

function clean(value: unknown): string {
  return String(value || '').trim();
}

function pathSegmentAfter(segments: string[], marker: string): string {
  const index = segments.findIndex((segment) => segment === marker);
  return index >= 0 ? clean(segments[index + 1]) : '';
}

export function parseRestoreAccessInput(input: string, fallbackOrigin?: string): ReceiptProof {
  const raw = clean(input);
  const fallbackPublicOrigin = normalizeCanonicalOrigin(fallbackOrigin);
  if (!raw) return { publicOrigin: fallbackPublicOrigin };
  const tokenMatch = raw.match(/^receiptToken[:=\s]+(.+)$/i);
  if (tokenMatch?.[1]) return { publicOrigin: fallbackPublicOrigin, receiptToken: tokenMatch[1].trim() };
  const idMatch = raw.match(/^receiptId[:=\s]+(.+)$/i);
  if (idMatch?.[1]) return { publicOrigin: fallbackPublicOrigin, receiptId: idMatch[1].trim() };

  try {
    const parsed = new URL(raw);
    const origin = normalizeCanonicalOrigin(parsed.searchParams.get('origin')) || normalizeCanonicalOrigin(parsed.origin) || fallbackPublicOrigin;
    const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
    const receiptIdFromDurableStatus = (() => {
      const receiptsIndex = segments.findIndex((segment) => segment === 'receipts');
      if (receiptsIndex >= 0 && segments[receiptsIndex + 1] === 'r') return clean(segments[receiptsIndex + 2]);
      return '';
    })();
    const receiptTokenFromStatus = (() => {
      const receiptsIndex = segments.findIndex((segment) => segment === 'receipts');
      if (receiptsIndex >= 0 && segments[receiptsIndex + 1] && segments[receiptsIndex + 1] !== 'r') return clean(segments[receiptsIndex + 1]);
      return '';
    })();
    return {
      publicOrigin: origin,
      receiptId: clean(parsed.searchParams.get('receiptId')) || receiptIdFromDurableStatus || pathSegmentAfter(segments, 'receipt'),
      receiptToken: clean(parsed.searchParams.get('receiptToken')) || receiptTokenFromStatus,
      paymentIntentId: clean(parsed.searchParams.get('paymentIntentId')),
      paidAt: clean(parsed.searchParams.get('paidAt')),
    };
  } catch {
    const normalized = raw.replace(/^receipt[:=\s]+/i, '').trim();
    if (!normalized) return { publicOrigin: fallbackPublicOrigin };
    if (/^rcpt[_-]/i.test(normalized) || /^r_[a-z0-9_-]+$/i.test(normalized)) {
      return { publicOrigin: fallbackPublicOrigin, receiptId: normalized };
    }
    return { publicOrigin: fallbackPublicOrigin, receiptId: normalized };
  }
}

export async function restoreAccessForItem(item: DiscoverableItem, input: string) {
  const proof = parseRestoreAccessInput(input, item.publicOrigin);
  if (!clean(proof.receiptId) && !clean(proof.receiptToken) && !clean(proof.paymentIntentId)) {
    throw new Error('Paste a receipt ID, receipt token, or receipt URL.');
  }
  rememberReceiptProofForItem(item, proof);
  const status = await hydrateReceiptStatusForItem(item);
  if (!isReceiptStatusUnlocked(status)) {
    throw new Error('Receipt found, but it is not paid or unlocked for this content.');
  }
  return { proof, status };
}
