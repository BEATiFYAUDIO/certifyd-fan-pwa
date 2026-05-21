import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FeedCard } from '../components/FeedCard';
import { ShortsCard } from '../components/ShortsCard';
import { TopicRail } from '../components/TopicRail';
import { fetchDiscoverablePage, fetchDiscoverySignals } from '../lib/api';
import { loadConfiguredOrigins } from '../lib/config';
import type { DiscoverableItem, DiscoverySignalCreator, DiscoverySignalsResponse, DiscoverySignalWork, OriginFeedState, Topic } from '../lib/types';
import { isLockedOrPremium, isRenderableDiscoveryItem } from '../lib/discoveryGuard';
import {
  buildHomeDiscoveryViewModel,
  dedupeDiscoveryItems,
  searchableText,
  sortNewestFirst,
  type CreatorSpotlight,
  type DiscoveryRail,
} from '../lib/discoveryViewModel';

const INITIAL_PAGE_LIMIT = 8;
const NEXT_PAGE_LIMIT = 18;
const ORIGIN_TIMEOUT_MS = 3000;
const RETRY_BASE_MS = 4000;
const RETRY_MAX_MS = 60000;
const ORIGIN_SOFT_DISABLE_AFTER_FAILS = 3;
const ORIGIN_SOFT_DISABLE_MS = 5 * 60 * 1000;
const MAX_ORIGINS_PER_PASS = 6;

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function sortStableRandom(items: DiscoverableItem[], seed: string): DiscoverableItem[] {
  return [...items].sort((a, b) => {
    const ak = `${a.publicOrigin}::${a.contentId}`;
    const bk = `${b.publicOrigin}::${b.contentId}`;
    const ah = hashString(`${seed}:${ak}`);
    const bh = hashString(`${seed}:${bk}`);
    if (ah !== bh) return ah - bh;
    return ak.localeCompare(bk);
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Failed to load feed';
}

function RailHeader({ title, subtitle, badge }: { title: string; subtitle: string; badge?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800/70 bg-black/35 px-3 py-2.5 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:border-transparent sm:bg-transparent sm:px-1 sm:py-0">
      <div className="min-w-0">
        <h2 className="section-title text-[13px] font-bold uppercase tracking-[0.14em] text-zinc-50 sm:text-sm sm:tracking-[0.2em]">{title}</h2>
        <p className="section-subtitle mt-1 max-w-[32rem] text-[12px] leading-5 text-zinc-300 sm:text-xs sm:text-zinc-400">{subtitle}</p>
      </div>
      {badge ? (
        <span className="mt-2 inline-flex shrink-0 rounded-full border border-amber-300/35 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200 sm:mt-0 sm:text-[11px]">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function itemKey(item: DiscoverableItem): string {
  return `${item.publicOrigin}::${item.contentId}`;
}

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return String(value);
}

function ContentRail({ rail }: { rail: DiscoveryRail }) {
  if (rail.items.length === 0) return null;
  return (
    <section className="space-y-3">
      <RailHeader title={rail.title} subtitle={rail.subtitle} />
      <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rail.items.map((item) => (
          <FeedCard key={`${rail.key}:${item.publicOrigin}:${item.contentId}`} item={item} />
        ))}
      </div>
    </section>
  );
}

function creatorBadges(creator: CreatorSpotlight): string[] {
  const badges: string[] = [];
  const supportBucket = String(creator.supportBucket || '').toLowerCase();
  const unlockBucket = String(creator.unlockBucket || '').toLowerCase();
  const viewBucket = String(creator.viewBucket || '').toLowerCase();
  if (supportBucket === 'high') badges.push('High support');
  else if (supportBucket === 'active') badges.push('Active support');
  if (unlockBucket === 'high') badges.push('High unlock activity');
  else if (unlockBucket === 'active') badges.push('Active unlocks');
  if (viewBucket === 'high') badges.push('High view activity');
  else if (viewBucket === 'active') badges.push('Active views');
  if (Number(creator.collaboratorCount || 0) > 0) {
    const count = Number(creator.collaboratorCount || 0);
    badges.push(`${formatCount(count)} ${count === 1 ? 'collaborator' : 'collaborators'}`);
  }
  if (Number(creator.connectedWorkCount || 0) > 0) {
    const count = Number(creator.connectedWorkCount || 0);
    badges.push(`${formatCount(count)} connected ${count === 1 ? 'work' : 'works'}`);
  }
  if (creator.postureScore > 0) badges.push('Trusted source');
  const unlockableCount = Number(creator.unlockableWorkCount || creator.premiumCount || 0);
  if (unlockableCount > 0) {
    badges.push(`${formatCount(unlockableCount)} unlockable ${unlockableCount === 1 ? 'work' : 'works'}`);
  }
  if (creator.freeCount > 0 && creator.premiumCount > 0) badges.push('Free + premium');
  if (creator.itemCount > 1) badges.push(`${formatCount(creator.itemCount)} works`);
  if (creator.itemCount > 1) badges.push('Active catalog');
  return badges.slice(0, 5);
}

function HubCreatorCard({ creator }: { creator: CreatorSpotlight }) {
  const fallbackLogo = `${import.meta.env.BASE_URL}header-logo.png`;
  const displayName = creator.handle.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const [lead, ...rest] = creator.works;
  const badges = creatorBadges(creator);
  const hasCompanionWorks = rest.length > 0;
  return (
    <article className="self-start overflow-hidden rounded-3xl border border-amber-300/20 bg-[radial-gradient(circle_at_20%_0%,rgba(217,180,92,0.18),transparent_36%),linear-gradient(135deg,rgba(24,24,27,0.96),rgba(8,8,9,0.98))] p-3 shadow-2xl shadow-black/30 sm:p-4 lg:col-span-2">
      <div className="flex items-start gap-3 sm:gap-4">
        <a
          href={creator.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-amber-300/25 bg-zinc-900 transition hover:border-amber-300/70 sm:h-20 sm:w-20"
        >
          {creator.avatarUrl ? (
            <img src={creator.avatarUrl} alt={`@${creator.handle}`} className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          ) : (
            <img src={fallbackLogo} alt="" className="h-full w-full object-contain p-2.5 opacity-80" loading="lazy" decoding="async" />
          )}
        </a>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-200/75">Hub creator</p>
          <h3 className="mt-1 truncate text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">{displayName}</h3>
          <p className="mt-0.5 truncate text-sm text-zinc-400">@{creator.handle}</p>
          <p className="mt-1.5 text-sm leading-5 text-zinc-300 sm:mt-2">
            {creator.itemCount} {creator.itemCount === 1 ? 'work' : 'works'}
            {creator.topics.length || creator.types.length ? ` across ${[...creator.topics, ...creator.types].slice(0, 3).join(' / ')}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-3">
            {badges.map((badge) => (
              <span
                key={badge}
                className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100"
              >
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={`mt-3 grid gap-3 sm:mt-4 ${hasCompanionWorks ? 'md:grid-cols-[minmax(0,1fr)_minmax(220px,0.72fr)]' : ''}`}>
        {lead ? (
          <Link
            to={`/watch/${encodeURIComponent(lead.contentId)}?origin=${encodeURIComponent(lead.publicOrigin)}`}
            state={{ item: lead }}
            className="group overflow-hidden rounded-2xl border border-zinc-800 bg-black/30 transition hover:border-amber-300/45"
          >
            <div className="aspect-[16/9] max-h-[280px] bg-zinc-950">
              {lead.coverUrl ? (
                <img src={lead.coverUrl} alt="" className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.02]" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-zinc-500">{lead.contentType || 'Work'}</div>
              )}
            </div>
            <div className="p-2.5 sm:p-3">
              <div className="line-clamp-2 text-base font-semibold text-zinc-100 group-hover:text-amber-100">{lead.title || 'Untitled'}</div>
              <div className="mt-1 text-xs text-zinc-500">{lead.primaryTopic || lead.contentType || 'publication'}</div>
            </div>
          </Link>
        ) : null}
        {hasCompanionWorks ? (
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
          {rest.slice(0, 3).map((work) => (
            <Link
              key={itemKey(work)}
              to={`/watch/${encodeURIComponent(work.contentId)}?origin=${encodeURIComponent(work.publicOrigin)}`}
              state={{ item: work }}
              className="group flex items-center gap-3 rounded-xl border border-zinc-800 bg-black/25 p-2 transition hover:border-amber-300/45"
            >
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-950">
                {work.coverUrl ? (
                  <img src={work.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-wide text-zinc-500">{work.contentType || 'Work'}</div>
                )}
              </div>
              <div className="min-w-0">
                <div className="line-clamp-1 text-sm font-semibold text-zinc-100 group-hover:text-amber-100">{work.title || 'Untitled'}</div>
                <div className="mt-0.5 truncate text-xs text-zinc-500">{work.primaryTopic || work.contentType || 'work'}</div>
              </div>
            </Link>
          ))}
        </div>
        ) : null}
      </div>
      <a
        href={creator.profileUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex min-h-9 items-center rounded-full border border-amber-300/25 bg-amber-300/10 px-3 text-[11px] font-semibold uppercase tracking-wide text-amber-100 hover:bg-amber-300/15"
      >
        Explore ecosystem →
      </a>
    </article>
  );
}

function CreatorClusterCard({ creator, index }: { creator: CreatorSpotlight; index: number }) {
  const fallbackLogo = `${import.meta.env.BASE_URL}header-logo.png`;
  const displayName = creator.handle.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const badges = creatorBadges(creator).slice(0, 3);
  return (
    <article className={`self-start rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-3 shadow-xl shadow-black/20 ${index === 0 ? 'xl:col-span-2' : ''}`}>
      <div className="flex gap-3">
        <a
          href={creator.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="h-14 w-14 shrink-0 overflow-hidden rounded-full border border-white/10 bg-zinc-800 transition hover:border-amber-300/60"
        >
          {creator.avatarUrl ? (
            <img src={creator.avatarUrl} alt={`@${creator.handle}`} className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          ) : (
            <img src={fallbackLogo} alt="" className="h-full w-full object-contain p-2 opacity-70" loading="lazy" decoding="async" />
          )}
        </a>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-zinc-100">{displayName}</div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">@{creator.handle}</div>
          <div className="mt-1 text-xs text-zinc-400">
            {creator.itemCount} {creator.itemCount === 1 ? 'work' : 'works'}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {badges.map((badge) => (
          <span key={badge} className="rounded-full border border-zinc-700 bg-black/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
            {badge}
          </span>
        ))}
      </div>

      <div className={`mt-3 grid gap-1.5 ${index === 0 ? 'grid-cols-3 sm:grid-cols-4 xl:grid-cols-3' : 'grid-cols-3'}`}>
        {creator.works.slice(0, 3).map((work) => (
          <Link
            key={itemKey(work)}
            to={`/watch/${encodeURIComponent(work.contentId)}?origin=${encodeURIComponent(work.publicOrigin)}`}
            state={{ item: work }}
            className="group aspect-square overflow-hidden rounded-xl border border-zinc-800 bg-black/30 transition hover:border-amber-300/45"
            title={work.title || 'Untitled'}
          >
            {work.coverUrl ? (
              <img src={work.coverUrl} alt="" className="h-full w-full object-cover opacity-90 transition group-hover:scale-105" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-full items-center justify-center px-1 text-center text-[9px] uppercase tracking-wide text-zinc-500">
                {work.contentType || 'Work'}
              </div>
            )}
          </Link>
        ))}
      </div>

      <a
        href={creator.profileUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex text-[11px] font-semibold uppercase tracking-wide text-amber-200/80 hover:text-amber-100"
      >
        View works →
      </a>
    </article>
  );
}

function CreatorEcosystemGrid({ creators }: { creators: CreatorSpotlight[] }) {
  if (creators.length === 0) return null;
  const [hub, secondHub, ...rest] = creators;
  const secondary = [secondHub, ...rest].filter(Boolean) as CreatorSpotlight[];
  return (
    <div className="grid auto-rows-auto items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
      <HubCreatorCard creator={hub} />
      {secondary.slice(0, 7).map((creator, index) => (
        <CreatorClusterCard key={creator.key} creator={creator} index={index} />
      ))}
    </div>
  );
}

function mergeCreatorSpotlights(primary: CreatorSpotlight[], secondary: CreatorSpotlight[]): CreatorSpotlight[] {
  const seen = new Set<string>();
  const merged: CreatorSpotlight[] = [];
  for (const creator of [...primary, ...secondary]) {
    const key = `${creator.publicOrigin}::${creator.handle}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(creator);
  }
  return merged;
}

type RankedSurface = {
  key: string;
  title: string;
  subtitle: string;
  items: DiscoverableItem[];
  scoreFor?: (item: DiscoverableItem) => number;
  scoreLabel?: string;
};

function signalNumber(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function signalWorkKey(work: DiscoverySignalWork): string {
  return `${work.publicOrigin || ''}::${work.contentId}`;
}

function signalWorkToDiscoverableItem(work: DiscoverySignalWork): DiscoverableItem | null {
  if (!work.contentId || !work.publicOrigin) return null;
  const publicUrl = work.publicUrl || '';
  return {
    contentId: work.contentId,
    title: work.title || 'Untitled',
    description: null,
    creatorHandle: work.creatorHandle || null,
    contentType: work.contentType || 'work',
    primaryTopic: (work.primaryTopic || null) as DiscoverableItem['primaryTopic'],
    coverUrl: work.coverUrl || '',
    previewUrl: work.previewUrl || '',
    buyUrl: publicUrl,
    offerUrl: publicUrl,
    priceSats: Number(work.priceSats || 0),
    accessMode: work.accessMode || 'unlocked',
    publicOrigin: work.publicOrigin,
    creatorAvatarUrl: work.creatorAvatarUrl || null,
    contributors: Array.isArray(work.contributors) ? work.contributors.slice(0, 4) : [],
    discoveryStatus: 'live',
    originHealth: 'healthy',
  };
}

function signalCreatorToSpotlight(creator: DiscoverySignalCreator): CreatorSpotlight | null {
  const handle = String(creator.creatorHandle || '').replace(/^@+/, '').trim();
  const publicOrigin = String(creator.publicOrigin || '').trim();
  if (!handle || !publicOrigin) return null;
  const works = (creator.representativeWorks || [])
    .map(signalWorkToDiscoverableItem)
    .filter((item): item is DiscoverableItem => Boolean(item));
  const labels = Array.isArray(creator.labels) ? creator.labels : [];
  const topics = [...new Set(works.map((item) => String(item.primaryTopic || '').trim()).filter(Boolean))].slice(0, 2);
  const types = [...new Set(works.map((item) => String(item.contentType || '').trim()).filter(Boolean))].slice(0, 2);
  return {
    key: `signals:${publicOrigin}:${handle}`,
    handle,
    publicOrigin,
    avatarUrl: creator.avatarUrl || '',
    profileUrl: creator.profileUrl || `${publicOrigin.replace(/\/+$/, '')}/u/${encodeURIComponent(handle)}`,
    itemCount: Number(creator.workCount || works.length || 0),
    freeCount: works.filter((item) => !isLockedOrPremium(item)).length,
    premiumCount: Number(creator.unlockableWorkCount || works.filter((item) => isLockedOrPremium(item)).length || 0),
    topics,
    types,
    works,
    supportScore: signalNumber(creator.scores?.supportMomentumScore),
    relationshipScore: Math.max(signalNumber(creator.scores?.topConnectedScore), signalNumber(creator.scores?.ecosystemDensityScore)),
    postureScore: labels.includes('Trusted source') || creator.signals?.originHealth === 'healthy' ? 1 : 0,
    activeScore: signalNumber(creator.scores?.creatorMomentumScore),
    supportBucket: creator.signals?.support || null,
    unlockBucket: creator.signals?.unlocks || null,
    viewBucket: creator.signals?.views || null,
    collaboratorCount: signalNumber(creator.signals?.collaborators),
    connectedWorkCount: signalNumber(creator.signals?.connectedWorks),
    unlockableWorkCount: Number(creator.unlockableWorkCount || 0),
    latestTitle: works[0]?.title || `${creator.workCount || 0} works`,
  };
}

function dedupeSignalWorks(works: DiscoverySignalWork[]): DiscoverySignalWork[] {
  const seen = new Map<string, DiscoverySignalWork>();
  for (const work of works) {
    const key = signalWorkKey(work);
    if (!work.contentId || !work.publicOrigin || seen.has(key)) continue;
    seen.set(key, work);
  }
  return [...seen.values()];
}

function RankingRow({
  item,
  rank,
  score,
  scoreLabel,
}: {
  item: DiscoverableItem;
  rank: number;
  score?: number;
  scoreLabel?: string;
}) {
  const creator = String(item.creatorHandle || 'creator').replace(/^@+/, '');
  const contributors = Array.isArray(item.contributors) ? item.contributors.slice(0, 4) : [];
  return (
    <Link
      to={`/watch/${encodeURIComponent(item.contentId)}?origin=${encodeURIComponent(item.publicOrigin)}`}
      state={{ item }}
      className="group flex min-w-0 items-center gap-2 rounded-xl border border-zinc-800 bg-black/25 p-2 transition hover:border-amber-300/45 sm:gap-3"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-300/25 bg-amber-300/10 text-xs font-bold text-amber-100">
        {rank}
      </div>
      <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-950">
        {item.coverUrl ? (
          <img
            src={item.coverUrl}
            alt=""
            className="h-full w-full object-cover opacity-90"
            loading={rank === 1 ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={rank === 1 ? 'high' : 'auto'}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-[9px] uppercase tracking-wide text-zinc-500">
            {item.contentType || 'Work'}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-sm font-semibold text-zinc-100 group-hover:text-amber-100">{item.title || 'Untitled'}</div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">@{creator} · {item.primaryTopic || item.contentType || 'work'}</div>
        {contributors.length > 0 ? (
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">With</span>
            {contributors.slice(0, 3).map((contributor) => {
              const label = contributor.displayName || contributor.handle || 'Contributor';
              const handle = contributor.handle ? contributor.handle.replace(/^@+/, '') : '';
              return (
                <span
                  key={`${itemKey(item)}:${label}:${contributor.role || ''}`}
                  className="inline-flex max-w-[9rem] items-center gap-1 rounded-full border border-zinc-700/80 bg-zinc-900/80 py-0.5 pl-1 pr-2 text-[10px] text-zinc-300"
                  title={[label, contributor.role].filter(Boolean).join(' · ')}
                >
                  {contributor.avatarUrl ? (
                    <span className="h-4 w-4 shrink-0 overflow-hidden rounded-full border border-white/10 bg-zinc-800">
                      <img src={contributor.avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    </span>
                  ) : null}
                  <span className="truncate">{handle || label}</span>
                  {contributor.role ? <span className="hidden text-zinc-500 min-[440px]:inline">· {contributor.role}</span> : null}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
      {score && score > 0 ? (
        <div className="hidden shrink-0 text-right min-[380px]:block">
          <div className="text-sm font-bold text-amber-100">{formatCount(score)}</div>
          <div className="text-[9px] uppercase tracking-wide text-zinc-500">{scoreLabel || 'signals'}</div>
        </div>
      ) : null}
    </Link>
  );
}

function RankedSurfaceCard({ surface }: { surface: RankedSurface }) {
  if (surface.items.length === 0) return null;
  return (
    <section className="min-w-0 break-inside-avoid overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-2.5 shadow-xl shadow-black/20 sm:p-3">
      <div className="flex min-w-0 items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-100">{surface.title}</h2>
          <p className="mt-1 text-xs text-zinc-500">{surface.subtitle}</p>
        </div>
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-300/80" aria-hidden="true" />
      </div>

      <div className="mt-2.5 space-y-1.5 sm:mt-3 sm:space-y-2">
        {surface.items.slice(0, 5).map((item, index) => (
          <RankingRow
            key={`${surface.key}:${itemKey(item)}`}
            item={item}
            rank={index + 1}
            score={surface.scoreFor?.(item)}
            scoreLabel={surface.scoreLabel}
          />
        ))}
      </div>
    </section>
  );
}

function CompactCreatorRow({ creator, rank }: { creator: CreatorSpotlight; rank: number }) {
  const fallbackLogo = `${import.meta.env.BASE_URL}header-logo.png`;
  const displayName = creator.handle.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const chips = creatorBadges(creator).slice(0, 2);
  return (
    <a
      href={creator.profileUrl}
      target="_blank"
      rel="noreferrer"
      className="group flex min-w-0 items-center gap-2 rounded-xl border border-zinc-800 bg-black/25 p-2 transition hover:border-amber-300/45 sm:gap-3"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-xs font-bold text-zinc-300">
        {rank}
      </div>
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-white/10 bg-zinc-900">
        {creator.avatarUrl ? (
          <img src={creator.avatarUrl} alt={`@${creator.handle}`} className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : (
          <img src={fallbackLogo} alt="" className="h-full w-full object-contain p-1.5 opacity-70" loading="lazy" decoding="async" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-100 group-hover:text-amber-100">{displayName}</div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">
          @{creator.handle} · {creator.itemCount} {creator.itemCount === 1 ? 'work' : 'works'}
        </div>
        {chips.length > 0 ? (
          <div className="mt-1 flex min-w-0 gap-1 overflow-hidden">
            {chips.map((chip) => (
              <span key={chip} className="truncate rounded-full border border-zinc-700 bg-black/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-300">
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </a>
  );
}

function CreatorNetworkCard({ creators }: { creators: CreatorSpotlight[] }) {
  if (creators.length === 0) return null;
  return (
    <section className="min-w-0 break-inside-avoid overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-2.5 shadow-xl shadow-black/20 sm:p-3">
      <div className="flex min-w-0 items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-100">Active Creator Ecosystems</h2>
          <p className="mt-1 text-xs text-zinc-500">Creators with public works, catalog activity, and connected releases</p>
        </div>
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-300/80" aria-hidden="true" />
      </div>
      <div className="mt-2.5 space-y-1.5 sm:mt-3 sm:space-y-2">
        {creators.slice(0, 5).map((creator, index) => (
          <CompactCreatorRow key={`active-creator:${creator.key}`} creator={creator} rank={index + 1} />
        ))}
      </div>
    </section>
  );
}

function TopActivityBoard({
  surfaces,
  networkCreators,
  recentItems,
  unlockableItems,
}: {
  surfaces: RankedSurface[];
  networkCreators: CreatorSpotlight[];
  recentItems: DiscoverableItem[];
  unlockableItems: DiscoverableItem[];
}) {
  if (surfaces.length === 0 && networkCreators.length === 0 && recentItems.length === 0 && unlockableItems.length === 0) return null;
  return (
    <section className="w-full min-w-0 overflow-hidden rounded-3xl border border-zinc-800/90 bg-[radial-gradient(circle_at_10%_0%,rgba(210,166,83,0.18),transparent_30%),linear-gradient(135deg,rgba(24,24,27,0.96),rgba(5,5,6,0.98))] p-2.5 shadow-2xl shadow-black/40 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200/80">Creator economy board</p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-zinc-50 sm:text-xl">Ranked creators, works, and momentum</h1>
        </div>
        <a
          href="#creator-ecosystems"
          className="hidden shrink-0 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-100 hover:bg-amber-300/15 sm:inline-flex"
        >
          Explore creators
        </a>
      </div>
      <div className="grid min-w-0 auto-rows-auto grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        <CreatorNetworkCard creators={networkCreators} />
        {recentItems.length > 0 ? (
          <RankedSurfaceCard
            surface={{
              key: 'recently-added',
              title: 'Recently Added',
              subtitle: 'Fresh public works from active creators',
              items: recentItems,
            }}
          />
        ) : null}
        {unlockableItems.length > 0 ? (
          <RankedSurfaceCard
            surface={{
              key: 'unlockable-works',
              title: 'Unlockable Works',
              subtitle: 'Premium works to explore here and unlock on creator pages',
              items: unlockableItems,
            }}
          />
        ) : null}
        {surfaces.slice(0, 4).map((surface) => (
          <RankedSurfaceCard key={surface.key} surface={surface} />
        ))}
      </div>
    </section>
  );
}

export function HomePage() {
  const logoSrc = `${import.meta.env.BASE_URL}header-logo.png`;
  const [origins, setOrigins] = useState<string[]>([]);
  const [originsLoaded, setOriginsLoaded] = useState(false);
  const [topic, setTopic] = useState<Topic>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<DiscoverableItem[]>([]);
  const [signals, setSignals] = useState<DiscoverySignalsResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeds, setFeeds] = useState<OriginFeedState[]>([]);
  const randomSeed = useMemo(
    () => `all:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
    []
  );
  const requestIdRef = useRef(0);
  const loadingRef = useRef(false);
  const originPassOffsetRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const sentinelWasVisibleRef = useRef(false);
  const retryMetaRef = useRef<Map<string, { failCount: number; retryAfter: number; disabledUntil: number }>>(new Map());
  const cacheKey = useMemo(
    () => `fanfeed:v1:${topic}:${origins.slice().sort().join(',') || 'none'}`,
    [origins, topic]
  );
  const signalsCacheKey = useMemo(
    () => `fansignals:v1:${origins.slice().sort().join(',') || 'none'}`,
    [origins]
  );

  useEffect(() => {
    let mounted = true;
    void loadConfiguredOrigins()
      .then((nextOrigins) => {
        if (!mounted) return;
        setOrigins(nextOrigins);
        setFeeds(nextOrigins.map((origin) => ({ origin, cursor: null, done: false, loading: false, error: null })));
      })
      .finally(() => {
        if (mounted) setOriginsLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  function onTopicChange(next: Topic) {
    setTopic(next);
  }

  const loadMore = useCallback(async (currentFeeds: OriginFeedState[], currentItems: DiscoverableItem[]) => {
    if (origins.length === 0 || loadingRef.current) return;
    const now = Date.now();
    const nextFeeds = currentFeeds.map((f) => ({ ...f }));
    const updates: DiscoverableItem[] = [];

    const pendingIndexes: number[] = [];
    for (let i = 0; i < nextFeeds.length; i += 1) {
      const feed = nextFeeds[i];
      if (feed.done || feed.loading) continue;
      const retryMeta = retryMetaRef.current.get(feed.origin);
      if (retryMeta && (retryMeta.retryAfter > now || retryMeta.disabledUntil > now)) continue;
      feed.loading = true;
      pendingIndexes.push(i);
    }
    if (pendingIndexes.length === 0) return;
    const isInitialLoadPass = currentItems.length === 0;
    const startOffset = pendingIndexes.length > 0 ? originPassOffsetRef.current % pendingIndexes.length : 0;
    const rotated = pendingIndexes.slice(startOffset).concat(pendingIndexes.slice(0, startOffset));
    const selectedIndexes = isInitialLoadPass ? rotated : rotated.slice(0, MAX_ORIGINS_PER_PASS);
    originPassOffsetRef.current += 1;

    const requestId = ++requestIdRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    await Promise.all(
      selectedIndexes.map(async (index) => {
        const feed = nextFeeds[index];
        try {
          const data = await fetchDiscoverablePage({
            origin: feed.origin,
            topic,
            limit: currentItems.length === 0 ? INITIAL_PAGE_LIMIT : NEXT_PAGE_LIMIT,
            cursor: feed.cursor,
            timeoutMs: ORIGIN_TIMEOUT_MS,
          });
          updates.push(...data.items);
          feed.cursor = data.cursor;
          feed.done = !data.cursor || data.items.length === 0;
          feed.error = null;
          retryMetaRef.current.delete(feed.origin);
        } catch (e: unknown) {
          feed.error = toErrorMessage(e);
          const prev = retryMetaRef.current.get(feed.origin) || { failCount: 0, retryAfter: 0, disabledUntil: 0 };
          const failCount = prev.failCount + 1;
          const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failCount - 1));
          const disabledUntil = failCount >= ORIGIN_SOFT_DISABLE_AFTER_FAILS ? Date.now() + ORIGIN_SOFT_DISABLE_MS : 0;
          retryMetaRef.current.set(feed.origin, {
            failCount,
            retryAfter: Date.now() + backoff,
            disabledUntil,
          });
        } finally {
          feed.loading = false;
        }
      })
    );

    if (requestId !== requestIdRef.current) {
      loadingRef.current = false;
      setLoading(false);
      return;
    }
    setFeeds(nextFeeds);
    const nextItems = sortNewestFirst(dedupeDiscoveryItems([...updates, ...currentItems]));
    setItems(nextItems);
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ items: nextItems }));
    } catch {
      // ignore storage quota/unavailable errors
    }

    const errors = nextFeeds.map((f) => f.error).filter(Boolean) as string[];
    if (errors.length && updates.length === 0 && currentItems.length === 0) {
      setError(errors[0]);
    }
    setLoading(false);
    loadingRef.current = false;
  }, [cacheKey, origins.length, topic]);

  useEffect(() => {
    if (origins.length === 0) return;
    const initialFeeds = origins.map((origin) => ({ origin, cursor: null, done: false, loading: false, error: null }));
    let warmItems: DiscoverableItem[] = [];
    try {
      const raw = sessionStorage.getItem(cacheKey);
      const parsed = raw ? JSON.parse(raw) as { items?: DiscoverableItem[] } : null;
      if (Array.isArray(parsed?.items)) {
        warmItems = sortNewestFirst(dedupeDiscoveryItems(parsed.items));
      }
    } catch {
      warmItems = [];
    }
    setFeeds(initialFeeds);
    setItems(warmItems);
    setError(null);
    if (warmItems.length === 0) {
      void loadMore(initialFeeds, []);
    }
  }, [cacheKey, loadMore, origins, topic]);

  useEffect(() => {
    if (origins.length === 0) {
      setSignals([]);
      return;
    }
    let cancelled = false;
    try {
      const raw = sessionStorage.getItem(signalsCacheKey);
      const parsed = raw ? JSON.parse(raw) as { signals?: DiscoverySignalsResponse[] } : null;
      if (Array.isArray(parsed?.signals)) setSignals(parsed.signals);
    } catch {
      // Ignore stale or unavailable session cache.
    }
    void Promise.all(origins.map((origin) => fetchDiscoverySignals({ origin, timeoutMs: ORIGIN_TIMEOUT_MS + 1500 })))
      .then((responses) => {
        if (cancelled) return;
        const nextSignals = responses.filter((response): response is DiscoverySignalsResponse => Boolean(response));
        setSignals(nextSignals);
        try {
          sessionStorage.setItem(signalsCacheKey, JSON.stringify({ signals: nextSignals }));
        } catch {
          // Ignore storage quota/unavailable errors.
        }
      })
      .catch(() => {
        if (!cancelled) setSignals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [origins, signalsCacheKey]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || loading) return;
      if (items.length === 0 && feeds.length > 0) {
        void loadMore(feeds, items);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [feeds, items, loadMore, loading]);

  const allDone = feeds.length > 0 && feeds.every((f) => f.done);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || origins.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) {
          sentinelWasVisibleRef.current = false;
          return;
        }
        if (sentinelWasVisibleRef.current) return;
        sentinelWasVisibleRef.current = true;
        if (loadingRef.current || loading || allDone) return;
        void loadMore(feeds, items);
      },
      { root: null, rootMargin: '320px 0px', threshold: 0.01 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [allDone, feeds, items, loadMore, loading, origins.length]);

  const filtered: DiscoverableItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const searched = !q
      ? items.filter((it) => isRenderableDiscoveryItem(it))
      : items.filter((it) => {
      if (!isRenderableDiscoveryItem(it)) return false;
      return searchableText(it).includes(q);
    });
    const freeLaneBase = searched.filter((it) => !isLockedOrPremium(it) && (it.accessMode === 'unlocked' || it.accessMode === 'owned'));
    const lockedLaneBase = searched.filter((it) => isLockedOrPremium(it));
    const freeLane = topic === 'all' ? sortStableRandom(freeLaneBase, `${randomSeed}:free`) : freeLaneBase;
    const lockedLane = topic === 'all' ? sortStableRandom(lockedLaneBase, `${randomSeed}:locked`) : lockedLaneBase;
    return [...freeLane, ...lockedLane];
  }, [items, query, topic, randomSeed]);
  const discoveryView = useMemo(() => buildHomeDiscoveryViewModel(filtered), [filtered]);
  const signalWorks = useMemo(() => {
    const topSelling = dedupeSignalWorks(signals.flatMap((signal) => signal.works?.topSelling || []));
    const mostSupported = dedupeSignalWorks(signals.flatMap((signal) => signal.works?.mostSupported || []));
    const fastestMoving = dedupeSignalWorks(signals.flatMap((signal) => signal.works?.fastestMoving || []));
    const collaborativeReleases = dedupeSignalWorks(signals.flatMap((signal) => signal.works?.collaborativeReleases || []));
    return {
      topSelling,
      mostSupported,
      fastestMoving,
      collaborativeReleases,
      topSellingItems: topSelling.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
      mostSupportedItems: mostSupported.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
      fastestMovingItems: fastestMoving.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
      collaborativeItems: collaborativeReleases.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
    };
  }, [signals]);
  const signalScoreByWork = useMemo(() => {
    const map = new Map<string, { support: number; unlock: number; moving: number; connected: number }>();
    const add = (work: DiscoverySignalWork) => {
      map.set(signalWorkKey(work), {
        support: signalNumber(work.scores?.supportMomentumScore),
        unlock: signalNumber(work.scores?.unlockMomentumScore),
        moving: signalNumber(work.scores?.fastestMovingScore),
        connected: signalNumber(work.scores?.topConnectedScore),
      });
    };
    [...signalWorks.topSelling, ...signalWorks.mostSupported, ...signalWorks.fastestMoving, ...signalWorks.collaborativeReleases].forEach(add);
    return map;
  }, [signalWorks]);
  const signalCreators = useMemo(() => {
    const byKey = new Map<string, DiscoverySignalCreator>();
    for (const creator of signals.flatMap((signal) => [...(signal.ecosystems || []), ...(signal.creators?.topCreators || [])])) {
      const key = `${creator.publicOrigin || ''}::${creator.creatorHandle || creator.displayName || ''}`;
      if (!creator.publicOrigin || byKey.has(key)) continue;
      byKey.set(key, creator);
    }
    return [...byKey.values()].sort((a, b) => signalNumber(b.scores?.creatorMomentumScore) - signalNumber(a.scores?.creatorMomentumScore));
  }, [signals]);
  const signalCreatorSpotlights = useMemo(
    () => signalCreators.map(signalCreatorToSpotlight).filter((creator): creator is CreatorSpotlight => Boolean(creator)),
    [signalCreators]
  );
  const networkCreators = discoveryView.creatorSpotlights;
  const homepageCreators = useMemo(
    () => mergeCreatorSpotlights(signalCreatorSpotlights, networkCreators),
    [signalCreatorSpotlights, networkCreators]
  );
  const freeItems = useMemo(
    () => (topic === 'all' ? sortStableRandom(discoveryView.freeItems, `${randomSeed}:free:view`) : discoveryView.freeItems),
    [discoveryView.freeItems, topic, randomSeed]
  );
  const lockedItems = useMemo(
    () => (topic === 'all' ? sortStableRandom(discoveryView.lockedItems, `${randomSeed}:locked:view`) : discoveryView.lockedItems),
    [discoveryView.lockedItems, topic, randomSeed]
  );
  const secondaryRails = useMemo(() => {
    const primaryKeys = new Set<string>();
    [
      ...freeItems.slice(0, 8),
      ...lockedItems.slice(0, 8),
      ...(discoveryView.supportedRail?.items || []),
      ...(discoveryView.recentRail?.items || []),
    ]
      .forEach((item) => primaryKeys.add(itemKey(item)));

    const rails: DiscoveryRail[] = [];
    rails.push(...discoveryView.dynamicRails);
    const seen = new Set<string>();
    return rails.map((rail) => ({
      ...rail,
      items: rail.items.filter((item) => !primaryKeys.has(itemKey(item))),
    })).filter((rail) => {
      if (rail.items.length < 3) return false;
      const signature = rail.items.map((item) => `${item.publicOrigin}:${item.contentId}`).join('|');
      if (!signature || seen.has(signature)) return false;
      seen.add(signature);
      return true;
    }).slice(0, 3);
  }, [discoveryView, freeItems, lockedItems]);
  const topSurfaces = useMemo(() => {
    const scoreFromSignal = (kind: 'support' | 'unlock' | 'moving' | 'connected') => (item: DiscoverableItem) =>
      signalScoreByWork.get(itemKey(item))?.[kind] || 0;

    const topSelling = signalWorks.topSellingItems.slice(0, 6);
    const moving = signalWorks.fastestMovingItems.length > 0 ? signalWorks.fastestMovingItems.slice(0, 6) : [];
    const connected = signalWorks.collaborativeItems.length > 0 ? signalWorks.collaborativeItems.slice(0, 6) : [];

    const surfaces: RankedSurface[] = [];
    if (topSelling.length > 0) {
      surfaces.push({
        key: 'top-selling',
        title: 'Top Selling',
        subtitle: 'Works with public unlock momentum',
        items: topSelling,
        scoreFor: scoreFromSignal('unlock'),
        scoreLabel: 'unlock',
      });
    }
    if (connected.length > 0) {
      surfaces.push({
        key: 'top-connected',
        title: 'Top Connected',
        subtitle: 'Collaborative and related works with public relationship signals',
        items: connected,
        scoreFor: scoreFromSignal('connected'),
        scoreLabel: 'links',
      });
    }
    if (moving.length > 0) {
      surfaces.push({
        key: 'fastest-moving',
        title: 'Fastest Moving',
        subtitle: 'Recent public movement across works and creators',
        items: moving,
        scoreFor: scoreFromSignal('moving'),
        scoreLabel: 'move',
      });
    }
    return surfaces.slice(0, 3);
  }, [signalScoreByWork, signalWorks]);
  const boardRecentItems = useMemo(() => (discoveryView.recentRail?.items || []).slice(0, 5), [discoveryView.recentRail]);
  const boardUnlockableItems = useMemo(() => lockedItems.slice(0, 5), [lockedItems]);
  const hasHomepageContent = filtered.length > 0 || homepageCreators.length > 0 || topSurfaces.some((surface) => surface.items.length > 0);

  return (
    <main className="app-shell min-h-screen text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-800/70 bg-zinc-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
          <div className="relative shrink-0">
            <img
              src={logoSrc}
              alt="Certifyd Discovery"
              className="h-24 w-auto object-contain sm:h-28"
              style={{ filter: "brightness(1.14) saturate(1.16) sepia(0.14)" }}
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
            <a
              href="https://certifyd.me"
              target="_blank"
              rel="noreferrer"
              className="absolute left-[84px] top-[61px] text-[10px] font-medium uppercase tracking-[0.14em] text-amber-200/85 transition hover:text-amber-100 hover:underline hover:decoration-amber-200/60 hover:underline-offset-2 sm:left-[98px] sm:top-[72px]"
            >
              Mission
            </a>
          </div>
          <div className="ml-auto w-full max-w-xl">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search creators, drops, music, stories..."
              className="search-input w-full rounded-full border border-zinc-700/80 bg-zinc-900/80 px-5 py-2.5 text-sm outline-none placeholder:text-zinc-500 focus:border-amber-300/70"
            />
          </div>
        </div>
        <TopicRail active={topic} onChange={onTopicChange} />
      </header>

      <section className="mx-auto max-w-7xl space-y-3 px-4 py-4">
        {originsLoaded && origins.length === 0 ? (
          <div className="rounded-xl border border-amber-700 bg-amber-950/30 p-4 text-sm text-amber-200">
            No valid origins found. Add <code>public/origins.json</code> and/or <code>VITE_CERTIFYD_ORIGINS</code>.
          </div>
        ) : null}

        {error ? <div className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-200">{error}</div> : null}

        {!error && items.length === 0 && loading ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-300">Loading feed…</div>
        ) : null}

        {!loading && !hasHomepageContent && !error ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-300">
            No discoverable content yet.
          </div>
        ) : null}

        {hasHomepageContent ? (
          <TopActivityBoard
            surfaces={topSurfaces}
            networkCreators={networkCreators}
            recentItems={boardRecentItems}
            unlockableItems={boardUnlockableItems}
          />
        ) : null}

        <div className="space-y-6">
          {homepageCreators.length > 0 ? (
            <section id="creator-ecosystems" className="space-y-3 scroll-mt-40">
              <RailHeader title="Creator Ecosystems" subtitle="Hub creators, connected works, and active public catalogs" />
              <CreatorEcosystemGrid creators={homepageCreators} />
            </section>
          ) : null}

          {freeItems.length > 0 ? (
            <section className="space-y-3">
              <RailHeader title="Free Drops" subtitle="Open works fans can play while exploring creators" badge="Open" />
              <div className="rail-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
                {freeItems.slice(0, 12).map((item) => {
                  const watchParams = new URLSearchParams({
                    origin: item.publicOrigin,
                    mode: 'freebies',
                    topic,
                  }).toString();
                  return (
                    <ShortsCard key={`shorts:${item.publicOrigin}:${item.contentId}`} item={item} watchParams={watchParams} />
                  );
                })}
              </div>
            </section>
          ) : null}

          {lockedItems.length > 0 ? (
            <section className="space-y-3">
              <RailHeader title="Premium Works" subtitle="Explore context here, unlock on the official creator page" badge="Lightning" />
              <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {lockedItems.slice(0, 8).map((item) => (
                  <FeedCard key={`${item.publicOrigin}:${item.contentId}`} item={item} />
                ))}
              </div>
            </section>
          ) : null}

          {discoveryView.supportedRail ? <ContentRail rail={discoveryView.supportedRail} /> : null}

          {discoveryView.recentRail ? <ContentRail rail={discoveryView.recentRail} /> : null}

          {secondaryRails.map((rail) => (
            <ContentRail key={rail.key} rail={rail} />
          ))}
        </div>

        {origins.length > 0 && !allDone ? <div ref={sentinelRef} className="h-8 w-full" aria-hidden="true" /> : null}
        {loading && items.length > 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center text-xs text-zinc-300">Loading more…</div>
        ) : null}
      </section>
    </main>
  );
}
