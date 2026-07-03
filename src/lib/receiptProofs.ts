import type { DiscoverableItem } from './types';

const RECEIPT_PROOFS_STORAGE_KEY = 'certifyd-player:receipt-proofs:v1';

type ReceiptProof = {
  contentId?: string;
  publicOrigin?: string;
  receiptId?: string;
  receiptToken?: string;
};

function clean(value: unknown): string {
  return String(value || '').trim();
}

function readProofs(): ReceiptProof[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECEIPT_PROOFS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeProofs(proofs: ReceiptProof[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECEIPT_PROOFS_STORAGE_KEY, JSON.stringify(proofs.slice(0, 100)));
  } catch {
    // Ignore storage quota/unavailable errors.
  }
}

export function captureReceiptProofFromLocation() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const receiptId = clean(params.get('receiptId'));
  const receiptToken = clean(params.get('receiptToken'));
  if (!receiptId && !receiptToken) return;
  const proof: ReceiptProof = { receiptId, receiptToken };
  const current = readProofs();
  const key = `${receiptId || ''}::${receiptToken || ''}`;
  const next = [proof, ...current.filter((row) => `${row.receiptId || ''}::${row.receiptToken || ''}` !== key)];
  writeProofs(next);
}

export function rememberReceiptProofForItem(item: DiscoverableItem, proof: ReceiptProof) {
  const receiptId = clean(proof.receiptId);
  const receiptToken = clean(proof.receiptToken);
  if (!receiptId && !receiptToken) return;
  const contentId = clean(item.contentId);
  const publicOrigin = clean(item.publicOrigin).replace(/\/+$/, '');
  const nextProof: ReceiptProof = { contentId, publicOrigin, receiptId, receiptToken };
  const current = readProofs();
  const next = [
    nextProof,
    ...current.filter((row) =>
      !(
        clean(row.contentId) === contentId &&
        clean(row.publicOrigin).replace(/\/+$/, '') === publicOrigin &&
        clean(row.receiptId) === receiptId &&
        clean(row.receiptToken) === receiptToken
      )
    ),
  ];
  writeProofs(next);
}

export function receiptProofsForItem(item: DiscoverableItem): ReceiptProof[] {
  captureReceiptProofFromLocation();
  const contentId = clean(item.contentId);
  const publicOrigin = clean(item.publicOrigin).replace(/\/+$/, '');
  return readProofs().filter((proof) => {
    const proofContentId = clean(proof.contentId);
    const proofOrigin = clean(proof.publicOrigin).replace(/\/+$/, '');
    return (!proofContentId || proofContentId === contentId) && (!proofOrigin || proofOrigin === publicOrigin);
  });
}

export function withReceiptProofs(url: string, item: DiscoverableItem): string[] {
  const proofs = receiptProofsForItem(item);
  if (!proofs.length) return [url];
  const urls = [url];
  for (const proof of proofs) {
    try {
      const next = new URL(url);
      if (proof.receiptId) next.searchParams.set('receiptId', proof.receiptId);
      if (proof.receiptToken) next.searchParams.set('receiptToken', proof.receiptToken);
      urls.unshift(next.toString());
    } catch {
      // Ignore malformed offer URL and keep the original.
    }
  }
  return urls;
}
