import { selectFastestMovingItems } from './fastestMoving';
import type { DiscoverableItem, DiscoverySignalsResponse, DiscoverySignalWork } from './types';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function work(overrides: Partial<DiscoverySignalWork> = {}): DiscoverySignalWork {
  return {
    contentId: 'work-1',
    title: 'Work 1',
    contentType: 'song',
    primaryTopic: 'music',
    creatorHandle: 'creator',
    publicUrl: 'https://node.test/buy/work-1',
    coverUrl: 'https://node.test/cover.jpg',
    previewUrl: 'https://node.test/preview.mp3',
    accessMode: 'locked',
    priceSats: 100,
    publicOrigin: 'https://node.test',
    scores: { fastestMovingScore: 10 },
    ...overrides,
  };
}

function canonical(overrides: Partial<DiscoverableItem> = {}): DiscoverableItem {
  return {
    contentId: 'work-1',
    title: 'Canonical Work',
    description: null,
    creatorHandle: 'creator',
    contentType: 'song',
    primaryTopic: 'music',
    coverUrl: 'https://node.test/canonical-cover.jpg',
    previewUrl: 'https://node.test/canonical-preview.mp3',
    buyUrl: 'https://node.test/buy/work-1',
    offerUrl: 'https://node.test/buy/content/work-1/offer',
    priceSats: 100,
    accessMode: 'locked',
    publicOrigin: 'https://node.test',
    discoveryStatus: 'live',
    originHealth: 'healthy',
    ...overrides,
  };
}

function signal(origin: string, fastestMoving: DiscoverySignalWork[], topSelling: DiscoverySignalWork[] = []): DiscoverySignalsResponse {
  return {
    generatedAt: '2026-08-09T00:00:00.000Z',
    window: '24h',
    origin: { publicOrigin: origin, health: 'healthy', trust: 'stable' },
    creators: { topCreators: [] },
    ecosystems: [],
    works: {
      topSelling,
      mostSupported: [],
      fastestMoving,
      recentlyAdded: [],
      recentlySupported: [],
      collaborativeReleases: [],
    },
  };
}

function ids(items: DiscoverableItem[]): string[] {
  return items.map((item) => `${item.publicOrigin.replace(/\/+$/, '')}::${item.contentId}`);
}

const mixed = signal('https://node.test', [
  work({ contentId: 'music-1', title: 'Music 1', primaryTopic: 'music', scores: { fastestMovingScore: 30 } }),
  work({ contentId: 'news-1', title: 'News 1', primaryTopic: 'news', scores: { fastestMovingScore: 90 } }),
  work({ contentId: 'music-2', title: 'Music 2', primaryTopic: 'Music', scores: { fastestMovingScore: 20 } }),
  work({ contentId: 'gaming-1', title: 'Gaming 1', primaryTopic: ' gaming ', scores: { fastestMovingScore: 50 } }),
]);

const music = selectFastestMovingItems({ signals: [mixed], topic: 'music' });
assert(ids(music).join('|') === 'https://node.test::music-1|https://node.test::music-2', 'music scope keeps only music fastest-moving works in signal order');

const gaming = selectFastestMovingItems({ signals: [mixed], topic: 'gaming' });
assert(ids(gaming).join('|') === 'https://node.test::gaming-1', 'gaming scope keeps whitespace/case-normalized gaming work');

const multipleOrigins = selectFastestMovingItems({
  signals: [
    signal('https://a.test', [work({ publicOrigin: 'https://a.test', contentId: 'a-music', primaryTopic: 'music', scores: { fastestMovingScore: 15 } })]),
    signal('https://b.test', [work({ publicOrigin: 'https://b.test', contentId: 'b-music', primaryTopic: 'music', scores: { fastestMovingScore: 25 } })]),
  ],
  topic: 'music',
});
assert(ids(multipleOrigins).join('|') === 'https://b.test::b-music|https://a.test::a-music', 'multiple origins aggregate and preserve fastest-moving score order');

const duplicate = selectFastestMovingItems({
  signals: [signal('https://node.test', [
    work({ publicOrigin: 'https://node.test/', contentId: 'dup', primaryTopic: 'music', title: 'Low score', scores: { fastestMovingScore: 5 } }),
    work({ publicOrigin: 'https://node.test', contentId: 'dup', primaryTopic: 'music', title: 'High score', scores: { fastestMovingScore: 50 } }),
  ])],
  topic: 'music',
});
assert(duplicate.length === 1 && duplicate[0]?.title === 'High score', 'duplicate publicOrigin+contentId collapses to strongest fastest-moving result');

const noFallback = selectFastestMovingItems({ signals: [mixed], topic: 'sports' });
assert(noFallback.length === 0, 'empty topic scope does not fall back to unrelated global fastest-moving works');

const all = selectFastestMovingItems({ signals: [mixed], topic: 'all' });
assert(ids(all).join('|') === 'https://node.test::news-1|https://node.test::gaming-1|https://node.test::music-1|https://node.test::music-2', 'all scope keeps global fastest-moving behavior by score');

const canonicalTopic = selectFastestMovingItems({
  signals: [signal('https://node.test', [work({ contentId: 'canonical-topic', primaryTopic: 'news', title: 'Stale Topic' })])],
  canonicalItems: [canonical({ contentId: 'canonical-topic', primaryTopic: 'music', publicOrigin: 'https://node.test' })],
  topic: 'music',
});
assert(canonicalTopic.length === 1 && canonicalTopic[0]?.primaryTopic === 'music', 'canonical discovery item topic overrides stale signal topic when available');

const topSellingOnly = selectFastestMovingItems({
  signals: [signal('https://node.test', [], [work({ contentId: 'top-selling-only', primaryTopic: 'music' })])],
  topic: 'music',
});
assert(topSellingOnly.length === 0, 'other rails are not pulled into fastest-moving selection');
