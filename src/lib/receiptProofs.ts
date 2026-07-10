import type { DiscoverableItem } from './types';
import { normalizeCanonicalOrigin } from './origin';

const RECEIPT_PROOFS_STORAGE_KEY = 'certifyd-player:receipt-proofs:v1';

export type ReceiptProof = {
  contentId?: string;
  publicOrigin?: string;
  receiptId?: string;
  receiptToken?: string;
  paymentIntentId?: string;
  paidAt?: string;
};

function clean(value: unknown): string {
  return String(value || '').trim();
}

function debugReceiptPropagation(...args: unknown[]) {
  if (typeof window === 'undefined') return;
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return;
  console.debug('[Certifyd receipt propagation]', ...args);
}

function isNewsmaxProofContext(proof: ReceiptProof | Pick<DiscoverableItem, 'contentId' | 'publicOrigin'>): boolean {
  return clean(proof.contentId) === 'cmp74z1ub00dtxw4eraqa75ea' ||
    normalizeCanonicalOrigin(proof.publicOrigin) === 'https://certifyd.beatifygroup.com';
}

function debugNewsmaxProof(...args: unknown[]) {
  if (typeof window === 'undefined') return;
  console.debug('[Certifyd Newsmax receipt proof]', ...args);
}

function validReceiptValue(value: string): boolean {
  return Boolean(value) && !value.includes('...') && !value.startsWith('_') && (value.startsWith('rcpt_') || value.startsWith('rct_'));
}

function normalizeProofFields(proof: ReceiptProof): ReceiptProof {
  const rawReceiptId = clean(proof.receiptId);
  const rawReceiptToken = clean(proof.receiptToken);
  const receiptId = validReceiptValue(rawReceiptId) ? rawReceiptId : '';
  const receiptToken = validReceiptValue(rawReceiptToken) ? rawReceiptToken : '';
  const values = [receiptId, receiptToken].filter(Boolean);
  let normalizedReceiptId = receiptId;
  let normalizedReceiptToken = receiptToken;

  for (const value of values) {
    if (value.startsWith('rct_')) normalizedReceiptId = value;
    if (value.startsWith('rcpt_')) {
      normalizedReceiptToken = value;
      if (!normalizedReceiptId) normalizedReceiptId = value;
    }
  }

  return {
    contentId: clean(proof.contentId),
    publicOrigin: normalizeCanonicalOrigin(proof.publicOrigin),
    receiptId: normalizedReceiptId,
    receiptToken: normalizedReceiptToken,
    paymentIntentId: clean(proof.paymentIntentId),
    paidAt: clean(proof.paidAt),
  };
}

function dedupeProofs(proofs: ReceiptProof[]): ReceiptProof[] {
  const next: ReceiptProof[] = [];
  for (const proof of proofs.map(normalizeProofFields).sort(compareProofPriority)) {
    if (!proof.receiptId && !proof.receiptToken && !proof.paymentIntentId) continue;
    if (next.some((row) => sameProof(row, proof))) continue;
    next.push(proof);
  }
  return next;
}

function proofScore(proof: ReceiptProof): number {
  let score = 0;
  if (validReceiptValue(clean(proof.receiptId))) score += 100;
  if (validReceiptValue(clean(proof.receiptToken))) score += 80;
  if (clean(proof.paymentIntentId)) score += 20;
  if (clean(proof.paidAt)) score += 10;
  if (clean(proof.receiptId).startsWith('rct_')) score += 2;
  if (clean(proof.receiptId).startsWith('rcpt_')) score += 1;
  return score;
}

function compareProofPriority(left: ReceiptProof, right: ReceiptProof): number {
  return proofScore(right) - proofScore(left);
}

function readProofs(): ReceiptProof[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECEIPT_PROOFS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const normalized = dedupeProofs(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) writeProofs(normalized);
    return normalized;
  } catch {
    return [];
  }
}

export function debugStoredReceiptProofs(): ReceiptProof[] {
  return readProofs();
}

function writeProofs(proofs: ReceiptProof[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECEIPT_PROOFS_STORAGE_KEY, JSON.stringify(proofs.slice(0, 100)));
  } catch {
    // Ignore storage quota/unavailable errors.
  }
}

export function captureReceiptProofFromLocation(item?: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'> | null) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const receiptId = clean(params.get('receiptId'));
  const receiptToken = clean(params.get('receiptToken'));
  const paymentIntentId = clean(params.get('paymentIntentId'));
  const paidAt = clean(params.get('paidAt'));
  const handoffOrigin = normalizeCanonicalOrigin(params.get('origin'));
  if (!receiptId && !receiptToken && !paymentIntentId) return;
  const proof: ReceiptProof = {
    contentId: clean(item?.contentId),
    publicOrigin: handoffOrigin || normalizeCanonicalOrigin(item?.publicOrigin),
    receiptId,
    receiptToken,
    paymentIntentId,
    paidAt,
  };
  const nextProof = normalizeProofFields(proof);
  const current = readProofs();
  const next = dedupeProofs([nextProof, ...current.filter((row) => !sameProof(row, nextProof))]);
  writeProofs(next);
  debugReceiptPropagation('captured URL receipt proof', { proof: nextProof, storageKey: RECEIPT_PROOFS_STORAGE_KEY, storedProofs: next });
  if (isNewsmaxProofContext(nextProof)) debugNewsmaxProof('captured URL receipt proof', { proof: nextProof, storedProofs: next });
}

export function rememberReceiptProofForItem(item: DiscoverableItem, proof: ReceiptProof) {
  const receiptId = clean(proof.receiptId);
  const receiptToken = clean(proof.receiptToken);
  const paymentIntentId = clean(proof.paymentIntentId);
  if (!receiptId && !receiptToken && !paymentIntentId) return;
  const contentId = clean(item.contentId);
  const publicOrigin = normalizeCanonicalOrigin(proof.publicOrigin) || normalizeCanonicalOrigin(item.publicOrigin);
  const paidAt = clean(proof.paidAt);
  const nextProof = normalizeProofFields({ contentId, publicOrigin, receiptId, receiptToken, paymentIntentId, paidAt });
  const current = readProofs();
  const next = dedupeProofs([nextProof, ...current.filter((row) => !sameProof(row, nextProof))]);
  writeProofs(next);
  debugReceiptPropagation('remembered receipt proof for item', { proof: nextProof, storageKey: RECEIPT_PROOFS_STORAGE_KEY, storedProofs: next });
  if (isNewsmaxProofContext(nextProof)) debugNewsmaxProof('remembered receipt proof for item', { proof: nextProof, storedProofs: next });
}

export function receiptProofsForItem(item: DiscoverableItem): ReceiptProof[] {
  captureReceiptProofFromLocation(item);
  const contentId = clean(item.contentId);
  const publicOrigin = normalizeCanonicalOrigin(item.publicOrigin);
  const allProofs = readProofs();
  const matchingProofs = allProofs.filter((proof) => {
    const proofContentId = clean(proof.contentId);
    const proofOrigin = normalizeCanonicalOrigin(proof.publicOrigin);
    return (!proofContentId || proofContentId === contentId) && (!proofOrigin || proofOrigin === publicOrigin);
  }).sort(compareProofPriority);
  debugReceiptPropagation('stored receipt proofs for item', {
    item: { contentId, publicOrigin },
    allProofs,
    matchingProofs,
  });
  if (contentId === 'cmp74z1ub00dtxw4eraqa75ea') debugNewsmaxProof('matched stored proofs for item', { item: { contentId, publicOrigin }, matchingProofs });
  return matchingProofs;
}

export function withReceiptProofs(url: string, item: DiscoverableItem): string[] {
  const proofs = receiptProofsForItem(item);
  if (!proofs.length) return [url];
  const urls = [url];
  for (const proof of proofs) {
    try {
      const proofOrigin = normalizeCanonicalOrigin(proof.publicOrigin);
      const next = new URL(url);
      if (proofOrigin) {
        const currentPath = next.pathname;
        next.href = new URL(currentPath + next.search + next.hash, proofOrigin).toString();
      }
      if (proof.receiptId) next.searchParams.set('receiptId', proof.receiptId);
      if (proof.receiptToken) next.searchParams.set('receiptToken', proof.receiptToken);
      urls.unshift(next.toString());
    } catch {
      // Ignore malformed offer URL and keep the original.
    }
  }
  return urls;
}

function sameProof(left: ReceiptProof, right: ReceiptProof): boolean {
  const leftContentId = clean(left.contentId);
  const rightContentId = clean(right.contentId);
  if (leftContentId && rightContentId && leftContentId !== rightContentId) return false;
  const leftOrigin = normalizeCanonicalOrigin(left.publicOrigin);
  const rightOrigin = normalizeCanonicalOrigin(right.publicOrigin);
  if (leftOrigin && rightOrigin && leftOrigin !== rightOrigin) return false;
  const leftReceiptId = clean(left.receiptId);
  const rightReceiptId = clean(right.receiptId);
  if (leftReceiptId && rightReceiptId && leftReceiptId === rightReceiptId) return true;
  const leftReceiptToken = clean(left.receiptToken);
  const rightReceiptToken = clean(right.receiptToken);
  if (leftReceiptToken && rightReceiptToken && leftReceiptToken === rightReceiptToken) return true;
  const leftPaymentIntentId = clean(left.paymentIntentId);
  const rightPaymentIntentId = clean(right.paymentIntentId);
  if (leftPaymentIntentId && rightPaymentIntentId && leftPaymentIntentId === rightPaymentIntentId) return true;
  return false;
}
