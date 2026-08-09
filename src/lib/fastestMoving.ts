import { isRenderableDiscoveryItem } from './discoveryGuard';
import { searchableText } from './discoveryViewModel';
import type { DiscoverableItem, DiscoverySignalsResponse, DiscoverySignalWork, Topic } from './types';

function text(value: unknown): string {
  return String(value || '').trim();
}

function normalizeOrigin(value: unknown): string {
  return text(value).replace(/\/+$/, '').toLowerCase();
}

export function normalizeFastestMovingTopic(value: unknown): Topic {
  const topic = text(value).toLowerCase();
  if (topic === 'entertainment' || topic === 'music' || topic === 'news' || topic === 'gaming' || topic === 'sports' || topic === 'technology') return topic;
  return 'all';
}

function signalNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function signalWorkKey(work: Pick<DiscoverySignalWork, 'publicOrigin' | 'contentId'>): string {
  const origin = normalizeOrigin(work.publicOrigin);
  const contentId = text(work.contentId);
  return origin && contentId ? `${origin}::${contentId}` : '';
}

function itemKey(item: Pick<DiscoverableItem, 'publicOrigin' | 'contentId'>): string {
  const origin = normalizeOrigin(item.publicOrigin);
  const contentId = text(item.contentId);
  return origin && contentId ? `${origin}::${contentId}` : '';
}

function sortTime(value: DiscoverySignalWork): number {
  const parsed = Date.parse(text(value.publishedAt || value.createdAt || value.updatedAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

function fastestMovingScore(work: DiscoverySignalWork): number {
  return Math.max(
    signalNumber(work.scores?.fastestMovingScore),
    signalNumber(work.scores?.supportMomentumScore),
    signalNumber(work.scores?.unlockMomentumScore),
  );
}

export function dedupeFastestMovingSignalWorks(works: DiscoverySignalWork[]): DiscoverySignalWork[] {
  const bestByKey = new Map<string, { work: DiscoverySignalWork; index: number }>();
  works.forEach((work, index) => {
    const key = signalWorkKey(work);
    if (!key) return;
    const current = bestByKey.get(key);
    if (!current) {
      bestByKey.set(key, { work, index });
      return;
    }
    const nextScore = fastestMovingScore(work);
    const currentScore = fastestMovingScore(current.work);
    if (nextScore > currentScore || (nextScore === currentScore && sortTime(work) > sortTime(current.work))) {
      bestByKey.set(key, { work, index: current.index });
    }
  });
  return [...bestByKey.values()]
    .sort((a, b) => {
      const scoreDiff = fastestMovingScore(b.work) - fastestMovingScore(a.work);
      if (scoreDiff !== 0) return scoreDiff;
      const timeDiff = sortTime(b.work) - sortTime(a.work);
      if (timeDiff !== 0) return timeDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.work);
}

export function signalWorkToFastestMovingItem(work: DiscoverySignalWork, canonical?: DiscoverableItem): DiscoverableItem | null {
  if (!work.contentId || !work.publicOrigin) return null;
  const publicOrigin = text(work.publicOrigin).replace(/\/+$/, '');
  const rawPriceSats = Number(work.priceSats ?? canonical?.priceSats ?? 0);
  const priceSats = Number.isFinite(rawPriceSats) && rawPriceSats > 0 ? rawPriceSats : 0;
  const rawAccessMode = text(work.accessMode || canonical?.accessMode).toLowerCase();
  const accessMode = (rawAccessMode === 'owned' || rawAccessMode === 'unlocked' || rawAccessMode === 'locked'
    ? rawAccessMode
    : priceSats > 0 ? 'locked' : 'unlocked') as DiscoverableItem['accessMode'];
  return {
    ...canonical,
    contentId: work.contentId,
    title: work.title || canonical?.title || 'Untitled',
    description: canonical?.description || null,
    createdAt: work.createdAt || canonical?.createdAt || null,
    updatedAt: work.updatedAt || canonical?.updatedAt || null,
    publishedAt: work.publishedAt || canonical?.publishedAt || work.createdAt || null,
    creatorHandle: work.creatorHandle || canonical?.creatorHandle || null,
    contentType: work.contentType || canonical?.contentType || 'work',
    primaryTopic: (canonical?.primaryTopic || work.primaryTopic || null) as DiscoverableItem['primaryTopic'],
    coverUrl: work.coverUrl || canonical?.coverUrl || '',
    previewUrl: work.previewUrl || canonical?.previewUrl || '',
    buyUrl: canonical?.buyUrl || `${publicOrigin}/buy/${encodeURIComponent(work.contentId)}`,
    offerUrl: canonical?.offerUrl || `${publicOrigin}/buy/content/${encodeURIComponent(work.contentId)}/offer`,
    priceSats,
    accessMode,
    publicOrigin,
    creatorAvatarUrl: work.creatorAvatarUrl || canonical?.creatorAvatarUrl || null,
    profileTheme: work.profileTheme || canonical?.profileTheme || null,
    contributors: Array.isArray(work.contributors) ? work.contributors.slice(0, 4) : canonical?.contributors || [],
    relationshipBadges: canonical?.relationshipBadges || [],
    relationshipReason: canonical?.relationshipReason || null,
    relationshipSummary: work.relationshipSummary || canonical?.relationshipSummary,
    relationshipTypes: work.relationshipTypes || canonical?.relationshipTypes,
    splitParticipantCount: work.splitParticipantCount ?? canonical?.splitParticipantCount,
    royaltyRecipientCount: work.royaltyRecipientCount ?? canonical?.royaltyRecipientCount,
    upstreamCreatorCount: work.upstreamCreatorCount ?? canonical?.upstreamCreatorCount,
    derivedFromCount: work.derivedFromCount ?? canonical?.derivedFromCount,
    relatedWorkCount: work.relatedWorkCount ?? canonical?.relatedWorkCount,
    connectedCreatorCount: work.connectedCreatorCount ?? canonical?.connectedCreatorCount,
    hasLockedSplitSnapshot: work.hasLockedSplitSnapshot ?? canonical?.hasLockedSplitSnapshot,
    isDerivative: work.isDerivative ?? canonical?.isDerivative,
    isFree: work.isFree ?? canonical?.isFree,
    lineageLabel: work.lineageLabel || canonical?.lineageLabel,
    attributionLabel: work.attributionLabel || canonical?.attributionLabel,
    discoveryStatus: canonical?.discoveryStatus || 'live',
    originHealth: canonical?.originHealth || 'healthy',
  };
}

export function selectFastestMovingItems(input: {
  signals: DiscoverySignalsResponse[];
  topic: Topic;
  query?: string;
  canonicalItems?: DiscoverableItem[];
}): DiscoverableItem[] {
  const canonicalByKey = new Map<string, DiscoverableItem>();
  for (const item of input.canonicalItems || []) {
    const key = itemKey(item);
    if (key) canonicalByKey.set(key, item);
  }
  const selectedTopic = normalizeFastestMovingTopic(input.topic);
  const query = text(input.query).toLowerCase();
  return dedupeFastestMovingSignalWorks(input.signals.flatMap((signal) => signal.works?.fastestMoving || []))
    .map((work) => signalWorkToFastestMovingItem(work, canonicalByKey.get(signalWorkKey(work))))
    .filter((item): item is DiscoverableItem => Boolean(item && isRenderableDiscoveryItem(item)))
    .filter((item) => selectedTopic === 'all' || normalizeFastestMovingTopic(item.primaryTopic) === selectedTopic)
    .filter((item) => !query || searchableText(item).includes(query));
}
