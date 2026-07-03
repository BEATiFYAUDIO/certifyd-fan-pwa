import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ShortsCard } from '../components/ShortsCard';
import { TopicRail, type ExtraScope } from '../components/TopicRail';
import { useStage1APlayer } from '../components/stage1APlayerContext';
import { fetchDiscoverablePage, fetchDiscoverySignals } from '../lib/api';
import { loadConfiguredOrigins } from '../lib/config';
import { EXTRA_SCOPE_OPTIONS, TOPIC_SCOPE_OPTIONS } from '../lib/scopeOptions';
import type { DiscoverableItem, DiscoverySignalCreator, DiscoverySignalsResponse, DiscoverySignalWork, OriginFeedState, Topic } from '../lib/types';
import { isLockedOrPremium, isRenderableDiscoveryItem } from '../lib/discoveryGuard';
import { displayStateFromItem } from '../lib/playbackDisplay';
import {
  buildHomeDiscoveryViewModel,
  dedupeDiscoveryItems,
  searchableText,
  sortNewestFirst,
  type CreatorSpotlight,
} from '../lib/discoveryViewModel';
import { creatorKey, useLocalLibrary, type LocalCreator } from '../lib/localLibrary';
import { getCardThemeVars } from '../lib/profileTheme';

const INITIAL_PAGE_LIMIT = 8;
const NEXT_PAGE_LIMIT = 18;
const ORIGIN_TIMEOUT_MS = 3000;
const RETRY_BASE_MS = 4000;
const RETRY_MAX_MS = 60000;
const ORIGIN_SOFT_DISABLE_AFTER_FAILS = 3;
const ORIGIN_SOFT_DISABLE_MS = 5 * 60 * 1000;
const MAX_ORIGINS_PER_PASS = 6;
const HOME_REFRESH_INTERVAL_MS = 90_000;
const HOME_RANDOM_SEED = `all:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;

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

function normalizeOriginKey(value: string | null | undefined): string {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function itemBelongsToOrigin(item: DiscoverableItem, origin: string): boolean {
  return normalizeOriginKey(item.publicOrigin) === normalizeOriginKey(origin);
}

function signalBelongsToOrigin(signal: DiscoverySignalsResponse, origin: string): boolean {
  const target = normalizeOriginKey(origin);
  if (!target) return false;
  if (normalizeOriginKey(signal.origin?.publicOrigin) === target) return true;
  const works = [
    ...(signal.works?.topSelling || []),
    ...(signal.works?.mostSupported || []),
    ...(signal.works?.fastestMoving || []),
    ...(signal.works?.recentlyAdded || []),
    ...(signal.works?.recentlySupported || []),
    ...(signal.works?.collaborativeReleases || []),
  ];
  if (works.some((work) => normalizeOriginKey(work.publicOrigin) === target)) return true;
  const creators = [...(signal.ecosystems || []), ...(signal.creators?.topCreators || [])];
  return creators.some((creator) => normalizeOriginKey(creator.publicOrigin) === target);
}

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return String(value);
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
  const fallbackLogo = `${import.meta.env.BASE_URL}header-logo.svg`;
  const displayName = creator.handle.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const [lead, ...rest] = creator.works;
  const badges = creatorBadges(creator);
  const hasCompanionWorks = rest.length > 0;
  const themeVars = useMemo(() => getCardThemeVars(creator.profileTheme), [creator.profileTheme]);
  return (
    <article className="creator-themed-card self-start overflow-hidden rounded-3xl border p-3 shadow-2xl shadow-black/30 sm:p-4 lg:col-span-2" style={themeVars}>
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
          <p className="creator-themed-link text-[10px] font-semibold uppercase tracking-[0.22em]">Hub creator</p>
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
                className="creator-themed-badge rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
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
            className="creator-themed-media group overflow-hidden rounded-2xl border bg-black/30 transition"
          >
            <div className="aspect-[16/9] max-h-[280px] bg-zinc-950">
              {lead.coverUrl ? (
                <img src={lead.coverUrl} alt="" className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.02]" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-zinc-500">{lead.contentType || 'Work'}</div>
              )}
            </div>
            <div className="p-2.5 sm:p-3">
              <div className="line-clamp-2 text-base font-semibold text-zinc-100 group-hover:text-white">{lead.title || 'Untitled'}</div>
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
              className="creator-themed-media group flex items-center gap-3 rounded-xl border bg-black/25 p-2 transition"
            >
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-950">
                {work.coverUrl ? (
                  <img src={work.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-wide text-zinc-500">{work.contentType || 'Work'}</div>
                )}
              </div>
              <div className="min-w-0">
                <div className="line-clamp-1 text-sm font-semibold text-zinc-100 group-hover:text-white">{work.title || 'Untitled'}</div>
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
        className="creator-themed-badge mt-3 inline-flex min-h-9 items-center rounded-full border px-3 text-[11px] font-semibold uppercase tracking-wide"
      >
        Explore ecosystem →
      </a>
    </article>
  );
}

function CreatorClusterCard({ creator, index }: { creator: CreatorSpotlight; index: number }) {
  const fallbackLogo = `${import.meta.env.BASE_URL}header-logo.svg`;
  const displayName = creator.handle.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const badges = creatorBadges(creator).slice(0, 3);
  const themeVars = useMemo(() => getCardThemeVars(creator.profileTheme), [creator.profileTheme]);
  return (
    <article className={`creator-themed-card self-start rounded-2xl border p-3 shadow-xl shadow-black/20 ${index === 0 ? 'xl:col-span-2' : ''}`} style={themeVars}>
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
          <span key={badge} className="creator-themed-badge-muted rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
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
            className="creator-themed-media group aspect-square overflow-hidden rounded-xl border bg-black/30 transition"
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
        className="creator-themed-link mt-3 inline-flex text-[11px] font-semibold uppercase tracking-wide"
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

function hasExplicitRelationshipSummary(work: DiscoverySignalWork): boolean {
  const summary = work.relationshipSummary;
  if (!summary) return false;
  return Boolean(
    (Array.isArray(summary.relationshipTypes) && summary.relationshipTypes.length > 0) ||
    summary.hasLockedSplitSnapshot ||
    summary.isDerivative ||
    signalNumber(summary.splitParticipantCount) > 0 ||
    signalNumber(summary.royaltyRecipientCount) > 0 ||
    signalNumber(summary.upstreamCreatorCount) > 0 ||
    signalNumber(summary.derivedFromCount) > 0 ||
    signalNumber(summary.relatedWorkCount) > 0 ||
    signalNumber(summary.connectedCreatorCount) > 0
  );
}

function relationshipScoreForSignalWork(work: DiscoverySignalWork): number {
  const hasSummary = hasExplicitRelationshipSummary(work);
  const summary = work.relationshipSummary || {};
  const summaryTypes = Array.isArray(summary.relationshipTypes) ? summary.relationshipTypes : Array.isArray(work.relationshipTypes) ? work.relationshipTypes : [];
  const contributors = Array.isArray(work.contributors) ? work.contributors.length : 0;
  const collaborators = signalNumber(work.signals?.collaborators);
  const connectedWorks = Math.max(signalNumber(work.signals?.connectedWorks), signalNumber(hasSummary ? summary.relatedWorkCount : work.relatedWorkCount));
  const splitParticipants = Math.max(signalNumber(hasSummary ? summary.splitParticipantCount : work.splitParticipantCount), contributors);
  const royaltyRecipients = signalNumber(hasSummary ? summary.royaltyRecipientCount : work.royaltyRecipientCount);
  const upstreamCreators = signalNumber(hasSummary ? summary.upstreamCreatorCount : work.upstreamCreatorCount);
  const connectedCreators = signalNumber(hasSummary ? summary.connectedCreatorCount : work.connectedCreatorCount);
  const labels = Array.isArray(work.labels) ? work.labels.join(' ').toLowerCase() : '';
  const explicitRelationship =
    summaryTypes.length > 0 ||
    Boolean(summary.hasLockedSplitSnapshot || work.hasLockedSplitSnapshot || summary.isDerivative || work.isDerivative) ||
    (!hasSummary && (
      /\b(collaborative|shared|split|royalty|upstream|derivative|lineage|related|built)\b/.test(labels) ||
      String(work.contentType || '').toLowerCase().includes('derivative')
    ));
  const base = signalNumber(work.scores?.topConnectedScore);
  return base
    + Math.max(0, splitParticipants - 1) * 16
    + Math.max(0, collaborators - 1) * 12
    + connectedWorks * 10
    + royaltyRecipients * 14
    + upstreamCreators * 10
    + connectedCreators * 6
    + (explicitRelationship ? 14 : 0);
}

function hasStrongFreeConnection(work: DiscoverySignalWork): boolean {
  const hasSummary = hasExplicitRelationshipSummary(work);
  const summary = work.relationshipSummary || {};
  const summaryTypes = Array.isArray(summary.relationshipTypes) ? summary.relationshipTypes : Array.isArray(work.relationshipTypes) ? work.relationshipTypes : [];
  const normalizedTypes = summaryTypes.map((type) => String(type || '').trim().toLowerCase());
  const contributors = Array.isArray(work.contributors) ? work.contributors.length : 0;
  const collaborators = signalNumber(work.signals?.collaborators);
  const connectedWorks = Math.max(signalNumber(work.signals?.connectedWorks), signalNumber(hasSummary ? summary.relatedWorkCount : work.relatedWorkCount));
  const splitParticipants = Math.max(signalNumber(hasSummary ? summary.splitParticipantCount : work.splitParticipantCount), contributors);
  const royaltyRecipients = signalNumber(hasSummary ? summary.royaltyRecipientCount : work.royaltyRecipientCount);
  const upstreamCreators = signalNumber(hasSummary ? summary.upstreamCreatorCount : work.upstreamCreatorCount);
  const connectedCreators = signalNumber(hasSummary ? summary.connectedCreatorCount : work.connectedCreatorCount);
  const derivedFromCount = signalNumber(hasSummary ? summary.derivedFromCount : work.derivedFromCount);
  const isDerivative = Boolean(summary.isDerivative || work.isDerivative || normalizedTypes.includes('derivative'));
  const explicitStrongType = normalizedTypes.some((type) => ['related', 'split', 'shared', 'royalty', 'derivative'].includes(type));

  return (
    splitParticipants > 1 ||
    contributors > 1 ||
    collaborators > 1 ||
    connectedCreators > 1 ||
    connectedWorks > 0 ||
    royaltyRecipients > 0 ||
    upstreamCreators > 0 ||
    derivedFromCount > 0 ||
    isDerivative ||
    explicitStrongType
  );
}

function relationshipBadgesForSignalWork(work: DiscoverySignalWork): string[] {
  const hasSummary = hasExplicitRelationshipSummary(work);
  const badges: string[] = [];
  const summary = work.relationshipSummary || {};
  const summaryTypes = Array.isArray(summary.relationshipTypes) ? summary.relationshipTypes : Array.isArray(work.relationshipTypes) ? work.relationshipTypes : [];
  const labels = Array.isArray(work.labels) ? work.labels.join(' ').toLowerCase() : '';
  const contentType = String(work.contentType || '').toLowerCase();
  const contributors = Array.isArray(work.contributors) ? work.contributors.length : 0;
  const collaborators = signalNumber(work.signals?.collaborators);
  const connectedWorks = Math.max(signalNumber(work.signals?.connectedWorks), signalNumber(hasSummary ? summary.relatedWorkCount : work.relatedWorkCount));
  const splitParticipants = Math.max(signalNumber(hasSummary ? summary.splitParticipantCount : work.splitParticipantCount), contributors);
  const royaltyRecipients = signalNumber(hasSummary ? summary.royaltyRecipientCount : work.royaltyRecipientCount);
  const hasSplit = splitParticipants > 1 || summaryTypes.includes('split');
  const hasRoyalty = royaltyRecipients > 0 || summaryTypes.includes('royalty') || (!hasSummary && (labels.includes('royalty') || labels.includes('upstream')));
  const hasDerivative = Boolean(summary.isDerivative || work.isDerivative || summaryTypes.includes('derivative') || (!hasSummary && (labels.includes('derivative') || contentType.includes('derivative'))));
  const hasRelated = connectedWorks > 0 || summaryTypes.includes('related') || (!hasSummary && (labels.includes('related') || labels.includes('built')));
  const hasShared = !hasSplit && (collaborators > 1 || summaryTypes.includes('shared') || (!hasSummary && labels.includes('collaborative')));
  if (hasRoyalty) badges.push('ROYALTY');
  if (hasDerivative) badges.push('DERIVATIVE');
  if (hasSplit) badges.push('SPLIT');
  if (hasShared) badges.push('SHARED');
  if (hasRelated) badges.push('RELATED');
  if ((summary.isFree || work.isFree || work.accessMode === 'unlocked' || Number(work.priceSats || 0) === 0) && hasStrongFreeConnection(work)) badges.push('FREE CONNECTED');
  const priority = ['ROYALTY', 'DERIVATIVE', 'SPLIT', 'SHARED', 'RELATED', 'FREE CONNECTED'];
  return [...new Set(badges)]
    .filter((badge) => badge !== 'SHARED' || !badges.includes('SPLIT'))
    .sort((a, b) => priority.indexOf(a) - priority.indexOf(b))
    .slice(0, 3);
}

function relationshipReasonForSignalWork(work: DiscoverySignalWork): string | null {
  const badges = relationshipBadgesForSignalWork(work);
  const summary = work.relationshipSummary || {};
  const connectedWorks = Math.max(signalNumber(work.signals?.connectedWorks), signalNumber(summary.relatedWorkCount || work.relatedWorkCount));
  if (badges.includes('ROYALTY') && badges.includes('DERIVATIVE')) return 'Royalty-linked derivative';
  if (badges.includes('DERIVATIVE') || summary.lineageLabel === 'derivative') return 'Built from another work';
  if (connectedWorks > 0 || badges.includes('RELATED')) return 'Related work network';
  if (badges.includes('SHARED')) return 'Connected campaign asset';
  return null;
}

function signalWorkToDiscoverableItem(work: DiscoverySignalWork): DiscoverableItem | null {
  if (!work.contentId || !work.publicOrigin) return null;
  const publicUrl = work.publicUrl || '';
  const offerUrl = `${work.publicOrigin}/buy/content/${encodeURIComponent(work.contentId)}/offer`;
  const rawPriceSats = Number(work.priceSats);
  const priceKnown = Number.isFinite(rawPriceSats);
  const priceSats = priceKnown && rawPriceSats > 0 ? rawPriceSats : 0;
  const rawAccessMode = String(work.accessMode || '').trim().toLowerCase();
  const hasFreeMarker = work.isFree === true || work.relationshipSummary?.isFree === true;
  const isZeroPriceUnlocked = priceKnown && priceSats === 0 && rawAccessMode === 'unlocked';
  const accessMode = (rawAccessMode === 'owned' || rawAccessMode === 'unlocked' || rawAccessMode === 'locked'
    ? rawAccessMode
    : (hasFreeMarker || isZeroPriceUnlocked ? 'unlocked' : 'locked')) as DiscoverableItem['accessMode'];
  return {
    contentId: work.contentId,
    title: work.title || 'Untitled',
    description: null,
    createdAt: work.createdAt || null,
    updatedAt: work.updatedAt || null,
    publishedAt: work.publishedAt || work.createdAt || null,
    creatorHandle: work.creatorHandle || null,
    contentType: work.contentType || 'work',
    primaryTopic: (work.primaryTopic || null) as DiscoverableItem['primaryTopic'],
    coverUrl: work.coverUrl || '',
    previewUrl: work.previewUrl || '',
    buyUrl: publicUrl,
    offerUrl,
    priceSats,
    accessMode,
    publicOrigin: work.publicOrigin,
    creatorAvatarUrl: work.creatorAvatarUrl || null,
    profileTheme: work.profileTheme || null,
    contributors: Array.isArray(work.contributors) ? work.contributors.slice(0, 4) : [],
    relationshipBadges: relationshipBadgesForSignalWork(work),
    relationshipReason: relationshipReasonForSignalWork(work),
    relationshipSummary: work.relationshipSummary,
    relationshipTypes: work.relationshipTypes,
    splitParticipantCount: work.splitParticipantCount,
    royaltyRecipientCount: work.royaltyRecipientCount,
    upstreamCreatorCount: work.upstreamCreatorCount,
    derivedFromCount: work.derivedFromCount,
    relatedWorkCount: work.relatedWorkCount,
    connectedCreatorCount: work.connectedCreatorCount,
    hasLockedSplitSnapshot: work.hasLockedSplitSnapshot,
    isDerivative: work.isDerivative,
    isFree: work.isFree,
    lineageLabel: work.lineageLabel,
    attributionLabel: work.attributionLabel,
    discoveryStatus: 'live',
    originHealth: 'healthy',
  };
}

function connectedSignalWorks(signals: DiscoverySignalsResponse[]): DiscoverySignalWork[] {
  const all = dedupeSignalWorks(signals.flatMap((signal) => [
    ...(signal.works?.collaborativeReleases || []),
    ...(signal.works?.topSelling || []),
    ...(signal.works?.mostSupported || []),
    ...(signal.works?.fastestMoving || []),
    ...(signal.works?.recentlyAdded || []),
    ...(signal.works?.recentlySupported || []),
  ]));
  return all
    .filter((work) => {
      const hasSummary = hasExplicitRelationshipSummary(work);
      const contributors = Array.isArray(work.contributors) ? work.contributors.length : 0;
      const collaborators = signalNumber(work.signals?.collaborators);
      const summary = work.relationshipSummary || {};
      const connectedWorks = Math.max(signalNumber(work.signals?.connectedWorks), signalNumber(hasSummary ? summary.relatedWorkCount : work.relatedWorkCount));
      const relationshipTypes = Array.isArray(summary.relationshipTypes) ? summary.relationshipTypes : Array.isArray(work.relationshipTypes) ? work.relationshipTypes : [];
      const labels = Array.isArray(work.labels) ? work.labels.join(' ').toLowerCase() : '';
      return relationshipScoreForSignalWork(work) > 0
        && (
          contributors > 1 ||
          collaborators > 1 ||
          connectedWorks > 0 ||
          relationshipTypes.length > 0 ||
          Boolean(summary.hasLockedSplitSnapshot || work.hasLockedSplitSnapshot || summary.isDerivative || work.isDerivative) ||
          (!hasSummary && /\b(collaborative|shared|split|royalty|upstream|derivative|lineage|related|built)\b/.test(labels))
        );
    })
    .sort((a, b) => relationshipScoreForSignalWork(b) - relationshipScoreForSignalWork(a));
}

function signalCreatorToSpotlight(creator: DiscoverySignalCreator): CreatorSpotlight | null {
  const handle = String(creator.creatorHandle || '').replace(/^@+/, '').trim();
  const publicOrigin = String(creator.publicOrigin || '').trim();
  if (!handle || !publicOrigin) return null;
  const creatorTheme = creator.profileTheme || null;
  const works = (creator.representativeWorks || [])
    .map(signalWorkToDiscoverableItem)
    .filter((item): item is DiscoverableItem => Boolean(item))
    .map((item) => ({
      ...item,
      profileTheme: item.profileTheme || creatorTheme,
    }));
  const labels = Array.isArray(creator.labels) ? creator.labels : [];
  const topics = [...new Set(works.map((item) => String(item.primaryTopic || '').trim()).filter(Boolean))].slice(0, 2);
  const types = [...new Set(works.map((item) => String(item.contentType || '').trim()).filter(Boolean))].slice(0, 2);
  return {
    key: `signals:${publicOrigin}:${handle}`,
    handle,
    publicOrigin,
    avatarUrl: creator.avatarUrl || '',
    profileTheme: creatorTheme || works[0]?.profileTheme || null,
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

function normalizeRelationshipIdentity(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function contributorIdentityKey(contributor: NonNullable<DiscoverableItem['contributors']>[number]): string {
  return (
    normalizeRelationshipIdentity(contributor.profileUrl) ||
    normalizeRelationshipIdentity(contributor.handle) ||
    normalizeRelationshipIdentity(contributor.displayName)
  );
}

function visibleOtherContributors(item: DiscoverableItem): NonNullable<DiscoverableItem['contributors']> {
  const creator = normalizeRelationshipIdentity(item.creatorHandle);
  const seen = new Set<string>();
  return (Array.isArray(item.contributors) ? item.contributors : [])
    .filter((contributor) => {
      const handle = normalizeRelationshipIdentity(contributor.handle);
      const displayName = normalizeRelationshipIdentity(contributor.displayName);
      const key = contributorIdentityKey(contributor);
      if (!key) return false;
      if (creator && (handle === creator || displayName === creator)) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function formatSatsPrice(value: unknown): string | null {
  const sats = Number(value);
  if (!Number.isFinite(sats) || sats < 0) return null;
  if (sats === 0) return null;
  return `⚡ ${Math.round(sats).toLocaleString()} sats`;
}

function RankingRow({
  item,
  rank,
  score,
  scoreLabel,
  showPrice = false,
}: {
  item: DiscoverableItem;
  rank: number;
  score?: number;
  scoreLabel?: string;
  showPrice?: boolean;
}) {
  const { playItem } = useStage1APlayer();
  const creator = String(item.creatorHandle || 'creator').replace(/^@+/, '');
  const contributors = visibleOtherContributors(item);
  const relationshipBadges = Array.isArray(item.relationshipBadges) ? item.relationshipBadges.slice(0, contributors.length ? 2 : 3) : [];
  const priceLine = showPrice ? formatSatsPrice(item.priceSats) : null;
  const playbackDisplay = displayStateFromItem(item);
  const [imageFailed, setImageFailed] = useState(false);
  const themeVars = useMemo(() => getCardThemeVars(item.profileTheme), [item.profileTheme]);
  return (
    <article
      className="creator-themed-card signal-row group flex h-[84px] min-w-0 items-center gap-2 overflow-hidden rounded-xl border p-2 transition sm:gap-3"
      style={themeVars}
    >
      <Link
        to={`/watch/${encodeURIComponent(item.contentId)}?origin=${encodeURIComponent(item.publicOrigin)}`}
        state={{ item }}
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3"
      >
        <div className="creator-themed-rank flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold">
          {rank}
        </div>
        <div className="relative h-12 w-[72px] shrink-0 overflow-hidden rounded-lg bg-zinc-950">
          {item.coverUrl && !imageFailed ? (
            <img
              src={item.coverUrl}
              alt=""
              className="h-full w-full object-cover opacity-90"
              loading={rank === 1 ? 'eager' : 'lazy'}
              decoding="async"
              fetchPriority={rank === 1 ? 'high' : 'auto'}
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-2 text-center text-[9px] uppercase tracking-wide text-zinc-500">
              {item.contentType || 'Work'}
            </div>
          )}
          <button
            type="button"
            className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 focus:bg-black/45 focus:opacity-100"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void playItem(item);
            }}
            aria-label={`Play ${item.title || 'work'} in Certifyd`}
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-white/90 pl-0.5 text-[10px] text-black shadow-lg">▶</span>
          </button>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="line-clamp-1 text-[13px] font-semibold leading-4 text-zinc-100 group-hover:text-white">{item.title || 'Untitled'}</div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">@{creator}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden">
            <span className="creator-themed-link shrink-0 truncate text-[11px] font-bold uppercase tracking-wide">{playbackDisplay.label}</span>
            {priceLine ? <span className="truncate text-[11px] font-medium text-zinc-500">{priceLine}</span> : null}
          </div>
          {relationshipBadges.length > 0 ? (
            <div className="mt-0.5 flex max-h-5 min-w-0 flex-nowrap gap-1 overflow-hidden">
              {relationshipBadges.slice(0, 2).map((badge) => (
                <span key={`${itemKey(item)}:${badge}`} className="creator-themed-badge max-w-[9rem] truncate rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                  {badge}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {score && score > 0 ? (
          <div className="hidden w-16 shrink-0 text-right min-[380px]:block">
            <div className="creator-themed-link text-sm font-bold">{formatCount(score)}</div>
            <div className="text-[9px] uppercase tracking-wide text-zinc-500">{scoreLabel || 'signals'}</div>
          </div>
        ) : null}
      </Link>
    </article>
  );
}

function RankedSurfaceCard({ surface, id }: { surface: RankedSurface; id?: string }) {
  if (surface.items.length === 0) return null;
  const showPrice = surface.key === 'unlockable-works';
  return (
    <section id={id || surface.key} className="signal-surface-card min-w-0 scroll-mt-40 break-inside-avoid overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-2.5 shadow-xl shadow-black/20 sm:p-3">
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
            showPrice={showPrice}
          />
        ))}
      </div>
    </section>
  );
}

function ExpandedRankedSurface({ surface, id }: { surface: RankedSurface; id: string }) {
  if (surface.items.length === 0) return null;
  const showPrice = surface.key === 'unlockable-works';
  return (
    <section id={id} className="signal-surface-card min-w-0 scroll-mt-40 overflow-hidden rounded-3xl border border-zinc-800/90 bg-zinc-950/75 p-3 shadow-2xl shadow-black/30 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200/80">Discovery signal</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{surface.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{surface.subtitle}</p>
        </div>
        <span className="mt-2 h-3 w-3 shrink-0 rounded-full bg-amber-300/80 shadow-lg shadow-amber-300/20" aria-hidden="true" />
      </div>

      <div className="mt-5 grid min-w-0 grid-cols-1 gap-2.5 lg:grid-cols-2">
        {surface.items.slice(0, 12).map((item, index) => (
          <RankingRow
            key={`${surface.key}:expanded:${itemKey(item)}`}
            item={item}
            rank={index + 1}
            score={surface.scoreFor?.(item)}
            scoreLabel={surface.scoreLabel}
            showPrice={showPrice}
          />
        ))}
      </div>
    </section>
  );
}

function EmptyDiscoveryContext({ id, title }: { id: DiscoveryContext; title: string }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-40 rounded-3xl border border-zinc-800/90 bg-zinc-950/70 p-5 shadow-2xl shadow-black/30">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200/80">Discovery signal</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">No public signal data is available for this context yet.</p>
    </section>
  );
}

function displayCreatorName(handle: string): string {
  return handle.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function creatorSpotlightToLocalCreator(creator: CreatorSpotlight): LocalCreator {
  const handle = String(creator.handle || '').replace(/^@+/, '').trim();
  const publicOrigin = String(creator.publicOrigin || '').replace(/\/+$/, '');
  return {
    key: creatorKey(handle, publicOrigin),
    handle,
    displayName: displayCreatorName(handle),
    avatarUrl: creator.avatarUrl || '',
    profileUrl: creator.profileUrl || `${publicOrigin}/u/${encodeURIComponent(handle)}`,
    publicOrigin,
    profileTheme: creator.profileTheme || null,
    itemCount: creator.itemCount,
    freeCount: creator.freeCount,
    premiumCount: creator.premiumCount,
    topics: creator.topics,
    types: creator.types,
    latestTitle: creator.latestTitle,
  };
}

function itemCreatorToLocalCreator(item: DiscoverableItem): LocalCreator | null {
  const handle = String(item.creatorHandle || '').replace(/^@+/, '').trim();
  const publicOrigin = String(item.publicOrigin || '').replace(/\/+$/, '');
  if (!handle || !publicOrigin) return null;
  return {
    key: creatorKey(handle, publicOrigin),
    handle,
    displayName: displayCreatorName(handle),
    avatarUrl: item.creatorAvatarUrl || item.creatorProfileImageUrl || item.profileImageUrl || item.avatarUrl || '',
    profileUrl: `${publicOrigin}/u/${encodeURIComponent(handle)}`,
    publicOrigin,
    profileTheme: item.profileTheme || null,
    itemCount: 1,
    freeCount: item.accessMode === 'locked' || item.isLocked ? 0 : 1,
    premiumCount: item.accessMode === 'locked' || item.isLocked || Number(item.priceSats || 0) > 0 ? 1 : 0,
    topics: item.primaryTopic ? [item.primaryTopic] : [],
    types: item.contentType ? [item.contentType] : [],
    latestTitle: item.title || '',
  };
}

function mergeLocalCreator(base: LocalCreator, hydrated: LocalCreator): LocalCreator {
  return {
    ...base,
    ...hydrated,
    displayName: hydrated.displayName || base.displayName,
    avatarUrl: hydrated.avatarUrl || base.avatarUrl,
    profileUrl: hydrated.profileUrl || base.profileUrl,
    profileTheme: hydrated.profileTheme || base.profileTheme || null,
    itemCount: hydrated.itemCount || base.itemCount,
    freeCount: hydrated.freeCount ?? base.freeCount,
    premiumCount: hydrated.premiumCount ?? base.premiumCount,
    topics: hydrated.topics?.length ? hydrated.topics : base.topics,
    types: hydrated.types?.length ? hydrated.types : base.types,
    latestTitle: hydrated.latestTitle || base.latestTitle,
  };
}

function hydrateLocalCreators(creators: LocalCreator[], creatorSources: CreatorSpotlight[], itemSources: DiscoverableItem[]): LocalCreator[] {
  const byKey = new Map<string, LocalCreator>();
  for (const creator of creatorSources) {
    const localCreator = creatorSpotlightToLocalCreator(creator);
    if (localCreator.key) byKey.set(localCreator.key, localCreator);
  }
  for (const item of itemSources) {
    const localCreator = itemCreatorToLocalCreator(item);
    if (!localCreator?.key) continue;
    const current = byKey.get(localCreator.key);
    byKey.set(localCreator.key, current ? mergeLocalCreator(current, localCreator) : localCreator);
  }
  return creators.map((creator) => {
    const key = creatorKey(creator.handle, creator.publicOrigin);
    const hydrated = byKey.get(key);
    return hydrated ? mergeLocalCreator(creator, hydrated) : creator;
  });
}

function LocalCreatorCard({ creator }: { creator: LocalCreator }) {
  const fallbackLogo = `${import.meta.env.BASE_URL}header-logo.svg`;
  const themeVars = useMemo(() => getCardThemeVars(creator.profileTheme), [creator.profileTheme]);
  const chips = [
    creator.itemCount ? `${creator.itemCount} ${creator.itemCount === 1 ? 'work' : 'works'}` : '',
    creator.premiumCount ? `${creator.premiumCount} premium` : '',
    creator.freeCount ? `${creator.freeCount} free` : '',
    ...(creator.topics || []),
    ...(creator.types || []),
  ].filter(Boolean).slice(0, 3);
  const displayHost = (() => {
    try {
      return new URL(creator.publicOrigin).host;
    } catch {
      return creator.publicOrigin;
    }
  })();
  return (
    <a
      href={creator.profileUrl}
      target="_blank"
      rel="noreferrer"
      className="creator-themed-card group flex min-w-0 items-center gap-3 rounded-2xl border p-3 transition"
      style={themeVars}
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/10 bg-zinc-900">
        {creator.avatarUrl ? (
          <img src={creator.avatarUrl} alt={`@${creator.handle}`} className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : (
          <img src={fallbackLogo} alt="" className="h-full w-full object-contain p-2 opacity-75" loading="lazy" decoding="async" />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-zinc-100 group-hover:text-white">{creator.displayName || creator.handle}</div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">@{creator.handle}</div>
        <div className="mt-1 truncate text-[11px] text-zinc-300/80">{creator.latestTitle || displayHost}</div>
        {chips.length > 0 ? (
          <div className="mt-1.5 flex min-w-0 gap-1 overflow-hidden">
            {chips.map((chip) => (
              <span key={chip} className="creator-themed-badge-muted truncate rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </a>
  );
}

function LocalCreatorSection({ id, title, subtitle, creators }: { id: DiscoveryContext; title: string; subtitle: string; creators: LocalCreator[] }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-40 overflow-hidden rounded-3xl border border-zinc-800/90 bg-zinc-950/75 p-3 shadow-2xl shadow-black/30 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200/80">Your World</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{subtitle}</p>
        </div>
        <span className="mt-2 h-3 w-3 shrink-0 rounded-full bg-fuchsia-300/80 shadow-lg shadow-fuchsia-300/20" aria-hidden="true" />
      </div>
      {creators.length > 0 ? (
        <div className="mt-5 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          {creators.map((creator) => (
            <LocalCreatorCard key={creator.key} creator={creator} />
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-2xl border border-zinc-800/80 bg-black/25 p-4 text-sm text-zinc-400">No public data available yet.</p>
      )}
    </section>
  );
}

function SavedLibrarySection({ works, creators }: { works: DiscoverableItem[]; creators: LocalCreator[] }) {
  return (
    <section id="saved" className="min-w-0 scroll-mt-40 space-y-4">
      {works.length > 0 ? (
        <ExpandedRankedSurface
          id="saved"
          surface={{
            key: 'saved',
            title: 'Saved Works',
            subtitle: 'Works saved locally on this device',
            items: works,
          }}
        />
      ) : (
        <EmptyDiscoveryContext id="saved" title="Saved Works" />
      )}
      <LocalCreatorSection id="saved" title="Saved Creators" subtitle="Creators saved locally on this device" creators={creators} />
    </section>
  );
}

function CompactCreatorRow({ creator, rank }: { creator: CreatorSpotlight; rank: number }) {
  const fallbackLogo = `${import.meta.env.BASE_URL}header-logo.svg`;
  const displayName = creator.handle.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const chips = creatorBadges(creator).slice(0, 2);
  const themeVars = useMemo(() => getCardThemeVars(creator.profileTheme), [creator.profileTheme]);
  return (
    <a
      href={creator.profileUrl}
      target="_blank"
      rel="noreferrer"
      className="creator-themed-card creator-row group flex min-w-0 items-center gap-2 rounded-xl border p-2 transition sm:gap-3"
      style={themeVars}
    >
      <div className="creator-themed-rank flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold">
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
        <div className="truncate text-sm font-semibold text-zinc-100 group-hover:text-white">{displayName}</div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">
          @{creator.handle} · {creator.itemCount} {creator.itemCount === 1 ? 'work' : 'works'}
        </div>
        {chips.length > 0 ? (
          <div className="mt-1 flex min-w-0 gap-1 overflow-hidden">
            {chips.map((chip) => (
              <span key={chip} className="creator-themed-badge-muted truncate rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
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
    <section className="creator-network-card min-w-0 scroll-mt-40 break-inside-avoid overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-2.5 shadow-xl shadow-black/20 sm:p-3">
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

function ExpandedCreatorNetwork({ creators }: { creators: CreatorSpotlight[] }) {
  if (creators.length === 0) return null;
  return (
    <section id="active-creator-ecosystems" className="min-w-0 scroll-mt-40 space-y-4 overflow-hidden rounded-3xl border border-zinc-800/90 bg-zinc-950/75 p-3 shadow-2xl shadow-black/30 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200/80">Discovery signal</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">Active Creator Ecosystems</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Creators with public works, catalog activity, connected releases, and visible ecosystem momentum.</p>
        </div>
        <span className="mt-2 h-3 w-3 shrink-0 rounded-full bg-amber-300/80 shadow-lg shadow-amber-300/20" aria-hidden="true" />
      </div>
      <CreatorEcosystemGrid creators={creators} />
    </section>
  );
}

function TopActivityBoard({
  surfaces,
  activeCreators,
  recentItems,
  unlockableItems,
}: {
  surfaces: RankedSurface[];
  activeCreators: CreatorSpotlight[];
  recentItems: DiscoverableItem[];
  unlockableItems: DiscoverableItem[];
}) {
  if (surfaces.length === 0 && activeCreators.length === 0 && recentItems.length === 0 && unlockableItems.length === 0) return null;
  return (
    <section id="creator-economy-board" className="creator-economy-board w-full min-w-0 scroll-mt-40 overflow-hidden rounded-3xl border border-zinc-800/90 p-2.5 shadow-2xl shadow-black/40 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200/80">Network Pulse</p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-zinc-50 sm:text-xl">Creator Economy Board</h1>
        </div>
        <a
          href="#creator-ecosystems"
          className="hidden shrink-0 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-100 hover:bg-amber-300/15 sm:inline-flex"
        >
          Explore creators
        </a>
      </div>
      <div className="top-activity-grid grid min-w-0 auto-rows-auto grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        <CreatorNetworkCard creators={activeCreators} />
        {recentItems.length > 0 ? (
          <RankedSurfaceCard
            surface={{
              key: 'recently-added',
              title: 'Recently Published',
              subtitle: 'Fresh public works from active creators',
              items: recentItems,
            }}
            id="recently-published"
          />
        ) : null}
        {unlockableItems.length > 0 ? (
          <RankedSurfaceCard
            surface={{
              key: 'unlockable-works',
              title: 'Premium Works',
              subtitle: 'Premium works to explore here and unlock on creator pages',
              items: unlockableItems,
            }}
            id="premium-works-board"
          />
        ) : null}
        {surfaces.slice(0, 4).map((surface) => (
          <RankedSurfaceCard key={surface.key} surface={surface} />
        ))}
      </div>
    </section>
  );
}

type DiscoveryContext =
  | 'creator-economy-board'
  | 'active-creator-ecosystems'
  | 'recently-published'
  | 'premium-works'
  | 'top-selling'
  | 'top-connected'
  | 'fastest-moving'
  | 'free-drops'
  | 'creator-ecosystems'
  | 'following'
  | 'recently-played'
  | 'saved';

const discoveryContexts = new Set<DiscoveryContext>([
  'creator-economy-board',
  'active-creator-ecosystems',
  'recently-published',
  'premium-works',
  'top-selling',
  'top-connected',
  'fastest-moving',
  'free-drops',
  'creator-ecosystems',
  'following',
  'recently-played',
  'saved',
]);

const topicScopes = new Set<Topic>(['all', 'entertainment', 'music', 'news', 'gaming', 'sports', 'technology']);
const extraScopes = new Set<ExtraScope>(['trending', 'new', 'live', 'following']);

function readDiscoveryContext(hashValue?: string): DiscoveryContext {
  const hash = (hashValue ?? (typeof window === 'undefined' ? '' : window.location.hash)).replace(/^#/, '');
  return discoveryContexts.has(hash as DiscoveryContext) ? (hash as DiscoveryContext) : 'creator-economy-board';
}

function readScope(searchValue?: string): { topic: Topic; extraScope: ExtraScope | null } {
  const params = new URLSearchParams(searchValue ?? (typeof window === 'undefined' ? '' : window.location.search));
  const scope = (params.get('scope') || 'all').toLowerCase();
  if (topicScopes.has(scope as Topic)) return { topic: scope as Topic, extraScope: null };
  if (extraScopes.has(scope as ExtraScope)) return { topic: 'all', extraScope: scope as ExtraScope };
  return { topic: 'all', extraScope: null };
}

export function HomePage() {
  const { recentItems, setFreeDropQueue } = useStage1APlayer();
  const { savedWorks, savedCreators, followedCreators } = useLocalLibrary();
  const location = useLocation();
  const navigate = useNavigate();
  const [origins, setOrigins] = useState<string[]>([]);
  const [originsLoaded, setOriginsLoaded] = useState(false);
  const { topic, extraScope } = useMemo(() => readScope(location.search), [location.search]);
  const discoveryContext = useMemo(() => readDiscoveryContext(location.hash), [location.hash]);
  const [query, setQuery] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [items, setItems] = useState<DiscoverableItem[]>([]);
  const [signals, setSignals] = useState<DiscoverySignalsResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeds, setFeeds] = useState<OriginFeedState[]>([]);
  const randomSeed = HOME_RANDOM_SEED;
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
    navigate({ pathname: '/', search: `?scope=${next}`, hash: location.hash || '#creator-economy-board' });
    setMobileFiltersOpen(false);
  }

  function onExtraScopeChange(next: ExtraScope) {
    navigate({ pathname: '/', search: `?scope=${next}`, hash: location.hash || '#creator-economy-board' });
    setMobileFiltersOpen(false);
  }

  useEffect(() => {
    window.requestAnimationFrame(() => {
      if (location.hash === '#certifyd-player-search') {
        document.getElementById('certifyd-player-search')?.focus();
        return;
      }
      const target = document.getElementById(discoveryContext);
      if (target) {
        target.scrollIntoView({ block: 'start' });
      }
    });
  }, [discoveryContext, location.hash]);

  const inActiveScope = useCallback((item: DiscoverableItem) => {
    if (topic !== 'all') {
      const itemTopic = String(item.primaryTopic || '').trim().toLowerCase();
      if (itemTopic !== topic) return false;
    }
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return searchableText(item).includes(q);
  }, [topic, query]);

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
    const isFirstPagePass = currentItems.length === 0 || currentFeeds.every((feed) => feed.cursor === null && !feed.done);
    const startOffset = pendingIndexes.length > 0 ? originPassOffsetRef.current % pendingIndexes.length : 0;
    const rotated = pendingIndexes.slice(startOffset).concat(pendingIndexes.slice(0, startOffset));
    const selectedIndexes = isFirstPagePass ? rotated : rotated.slice(0, MAX_ORIGINS_PER_PASS);
    originPassOffsetRef.current += 1;

    const requestId = ++requestIdRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    const failedOrigins = new Set<string>();

    await Promise.all(
      selectedIndexes.map(async (index) => {
        const feed = nextFeeds[index];
        try {
          const data = await fetchDiscoverablePage({
            origin: feed.origin,
            topic,
            limit: isFirstPagePass ? INITIAL_PAGE_LIMIT : NEXT_PAGE_LIMIT,
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
          failedOrigins.add(feed.origin);
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
    const retainedItems = failedOrigins.size > 0
      ? currentItems.filter((item) => ![...failedOrigins].some((origin) => itemBelongsToOrigin(item, origin)))
      : currentItems;
    const nextItems = sortNewestFirst(dedupeDiscoveryItems([...updates, ...retainedItems]));
    setItems(nextItems);
    if (failedOrigins.size > 0) {
      setSignals((currentSignals) =>
        currentSignals.filter((signal) => ![...failedOrigins].some((origin) => signalBelongsToOrigin(signal, origin)))
      );
    }
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
    queueMicrotask(() => {
      setFeeds(initialFeeds);
      setItems(warmItems);
      setError(null);
      void loadMore(initialFeeds, warmItems);
    });
  }, [cacheKey, loadMore, origins, topic]);

  useEffect(() => {
    if (origins.length === 0) {
      queueMicrotask(() => setSignals([]));
      return;
    }
    let cancelled = false;
    try {
      const raw = sessionStorage.getItem(signalsCacheKey);
      const parsed = raw ? JSON.parse(raw) as { signals?: DiscoverySignalsResponse[] } : null;
      if (Array.isArray(parsed?.signals)) queueMicrotask(() => setSignals(parsed.signals || []));
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
    if (origins.length === 0) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || loadingRef.current) return;
      const refreshFeeds = origins.map((origin) => ({ origin, cursor: null, done: false, loading: false, error: null }));
      setFeeds(refreshFeeds);
      void loadMore(refreshFeeds, items);
      void Promise.all(origins.map((origin) => fetchDiscoverySignals({ origin, timeoutMs: ORIGIN_TIMEOUT_MS + 1500 })))
        .then((responses) => {
          const nextSignals = responses.filter((response): response is DiscoverySignalsResponse => Boolean(response));
          setSignals(nextSignals);
          try {
            sessionStorage.setItem(signalsCacheKey, JSON.stringify({ signals: nextSignals }));
          } catch {
            // Ignore storage quota/unavailable errors.
          }
        })
        .catch(() => {
          // Keep the last known signal board when a background refresh fails.
        });
    };
    const intervalId = window.setInterval(refresh, HOME_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [items, loadMore, origins, signalsCacheKey]);

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
    const topicScoped = topic === 'all'
      ? items
      : items.filter((it) => String(it.primaryTopic || '').trim().toLowerCase() === topic);
    const searched = !q
      ? topicScoped.filter((it) => isRenderableDiscoveryItem(it))
      : topicScoped.filter((it) => {
      if (!isRenderableDiscoveryItem(it)) return false;
      return searchableText(it).includes(q);
    });
    const liveItems = searched.filter((it) => it.discoveryStatus === 'live' || it.originHealth === 'healthy');
    const scoped = extraScope === 'new'
      ? sortNewestFirst(searched)
      : extraScope === 'live' && liveItems.length > 0
        ? liveItems
        : searched;
    const freeLaneBase = scoped.filter((it) => !isLockedOrPremium(it) && (it.accessMode === 'unlocked' || it.accessMode === 'owned'));
    const lockedLaneBase = scoped.filter((it) => isLockedOrPremium(it));
    const freeLane = topic === 'all' ? sortStableRandom(freeLaneBase, `${randomSeed}:free`) : freeLaneBase;
    const lockedLane = topic === 'all' ? sortStableRandom(lockedLaneBase, `${randomSeed}:locked`) : lockedLaneBase;
    return [...freeLane, ...lockedLane];
  }, [extraScope, items, query, topic, randomSeed]);
  const discoveryView = useMemo(() => buildHomeDiscoveryViewModel(filtered), [filtered]);
  const signalWorks = useMemo(() => {
    const topSelling = dedupeSignalWorks(signals.flatMap((signal) => signal.works?.topSelling || []));
    const mostSupported = dedupeSignalWorks(signals.flatMap((signal) => signal.works?.mostSupported || []));
    const fastestMoving = dedupeSignalWorks(signals.flatMap((signal) => signal.works?.fastestMoving || []));
    const recentlyAdded = dedupeSignalWorks(signals.flatMap((signal) => signal.works?.recentlyAdded || []));
    const recentlySupported = dedupeSignalWorks(signals.flatMap((signal) => signal.works?.recentlySupported || []));
    const collaborativeReleases = dedupeSignalWorks(signals.flatMap((signal) => signal.works?.collaborativeReleases || []));
    const connectedWorks = connectedSignalWorks(signals);
    return {
      topSelling,
      mostSupported,
      fastestMoving,
      recentlyAdded,
      recentlySupported,
      collaborativeReleases,
      connectedWorks,
      topSellingItems: topSelling.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
      mostSupportedItems: mostSupported.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
      fastestMovingItems: fastestMoving.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
      recentlyAddedItems: recentlyAdded.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
      recentlySupportedItems: recentlySupported.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
      collaborativeItems: collaborativeReleases.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
      connectedItems: connectedWorks.map(signalWorkToDiscoverableItem).filter((item): item is DiscoverableItem => Boolean(item)),
    };
  }, [signals]);
  const signalScoreByWork = useMemo(() => {
    const map = new Map<string, { support: number; unlock: number; moving: number; connected: number }>();
    const add = (work: DiscoverySignalWork) => {
      map.set(signalWorkKey(work), {
        support: signalNumber(work.scores?.supportMomentumScore),
        unlock: signalNumber(work.scores?.unlockMomentumScore),
        moving: signalNumber(work.scores?.fastestMovingScore),
        connected: relationshipScoreForSignalWork(work),
      });
    };
    [...signalWorks.topSelling, ...signalWorks.mostSupported, ...signalWorks.fastestMoving, ...signalWorks.recentlyAdded, ...signalWorks.recentlySupported, ...signalWorks.collaborativeReleases, ...signalWorks.connectedWorks].forEach(add);
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
  const localCreatorHydrationItems = useMemo(() => dedupeDiscoveryItems([
    ...items,
    ...filtered,
    ...savedWorks,
    ...recentItems,
    ...signalWorks.topSellingItems,
    ...signalWorks.mostSupportedItems,
    ...signalWorks.fastestMovingItems,
    ...signalWorks.recentlyAddedItems,
    ...signalWorks.recentlySupportedItems,
    ...signalWorks.collaborativeItems,
    ...signalWorks.connectedItems,
  ]), [
    filtered,
    items,
    recentItems,
    savedWorks,
    signalWorks.collaborativeItems,
    signalWorks.connectedItems,
    signalWorks.fastestMovingItems,
    signalWorks.mostSupportedItems,
    signalWorks.recentlyAddedItems,
    signalWorks.recentlySupportedItems,
    signalWorks.topSellingItems,
  ]);
  const hydratedSavedCreators = useMemo(
    () => hydrateLocalCreators(savedCreators, homepageCreators, localCreatorHydrationItems),
    [homepageCreators, localCreatorHydrationItems, savedCreators]
  );
  const hydratedFollowedCreators = useMemo(
    () => hydrateLocalCreators(followedCreators, homepageCreators, localCreatorHydrationItems),
    [followedCreators, homepageCreators, localCreatorHydrationItems]
  );
  const freeItems = useMemo(
    () => (topic === 'all' ? sortStableRandom(discoveryView.freeItems, `${randomSeed}:free:view`) : discoveryView.freeItems),
    [discoveryView.freeItems, topic, randomSeed]
  );

  useEffect(() => {
    setFreeDropQueue(freeItems.slice(0, 24));
  }, [freeItems, setFreeDropQueue]);
  const lockedItems = useMemo(
    () => (topic === 'all' ? sortStableRandom(discoveryView.lockedItems, `${randomSeed}:locked:view`) : discoveryView.lockedItems),
    [discoveryView.lockedItems, topic, randomSeed]
  );
  const topSurfaces = useMemo(() => {
    const scoreFromSignal = (kind: 'support' | 'unlock' | 'moving' | 'connected') => (item: DiscoverableItem) =>
      signalScoreByWork.get(itemKey(item))?.[kind] || 0;

    const connectedScoped = signalWorks.connectedItems.filter(inActiveScope);
    const topSellingScoped = signalWorks.topSellingItems.filter(inActiveScope);
    const movingScoped = signalWorks.fastestMovingItems.filter(inActiveScope);

    const connected = connectedScoped.length > 0 ? connectedScoped.slice(0, 12) : [];
    const topSelling = topSellingScoped.slice(0, 12);
    const usedSignalKeys = new Set([...connected, ...topSelling].map(itemKey));
    const moving = movingScoped.length > 0
      ? movingScoped.filter((item) => !usedSignalKeys.has(itemKey(item))).slice(0, 12)
      : [];

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
        subtitle: 'Shared, split, derivative, and free connected works',
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
  }, [inActiveScope, signalScoreByWork, signalWorks]);
  const boardRecentItems = useMemo(() => {
    const signalRecent = [
      ...signalWorks.recentlyAddedItems,
      ...signalWorks.recentlySupportedItems,
      ...signalWorks.collaborativeItems,
      ...signalWorks.fastestMovingItems,
    ].filter(inActiveScope);
    const discoverableRecent = discoveryView.recentRail?.items || [];
    return sortNewestFirst(dedupeDiscoveryItems([...signalRecent, ...discoverableRecent]));
  }, [discoveryView.recentRail, inActiveScope, signalWorks.collaborativeItems, signalWorks.fastestMovingItems, signalWorks.recentlyAddedItems, signalWorks.recentlySupportedItems]);
  const boardUnlockableItems = useMemo(() => lockedItems, [lockedItems]);
  const hasHomepageContent = filtered.length > 0 || homepageCreators.length > 0 || topSurfaces.some((surface) => surface.items.length > 0);
  const recentlyPublishedSurface = useMemo<RankedSurface>(() => ({
    key: 'recently-added',
    title: 'Recently Published',
    subtitle: 'Fresh public works from active creators',
    items: boardRecentItems,
  }), [boardRecentItems]);
  const premiumWorksSurface = useMemo<RankedSurface>(() => ({
    key: 'unlockable-works',
    title: 'Premium Works',
    subtitle: 'Premium works to explore here and unlock on creator pages',
    items: boardUnlockableItems,
  }), [boardUnlockableItems]);
  const recentlyPlayedSurface = useMemo<RankedSurface>(() => ({
    key: 'recently-played',
    title: 'Recently Played',
    subtitle: 'Works started in the Certifyd Player on this device',
    items: recentItems,
  }), [recentItems]);
  const surfaceByContext = useMemo(() => {
    const byContext = new Map<DiscoveryContext, RankedSurface>();
    byContext.set('recently-published', recentlyPublishedSurface);
    byContext.set('premium-works', premiumWorksSurface);
    byContext.set('recently-played', recentlyPlayedSurface);
    for (const surface of topSurfaces) {
      if (surface.key === 'top-selling' || surface.key === 'top-connected' || surface.key === 'fastest-moving') {
        byContext.set(surface.key, surface);
      }
    }
    return byContext;
  }, [premiumWorksSurface, recentlyPlayedSurface, recentlyPublishedSurface, topSurfaces]);
  const selectedSurface = surfaceByContext.get(discoveryContext);
  const showOverview = discoveryContext === 'creator-economy-board';
  const showSaved = discoveryContext === 'saved';
  const showFollowing = discoveryContext === 'following';
  const selectedContextLabel = selectedSurface?.title || (discoveryContext === 'active-creator-ecosystems' ? 'Active Creator Ecosystems' : discoveryContext.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '));
  const activeScopeLabel =
    extraScope
      ? EXTRA_SCOPE_OPTIONS.find((scope) => scope.key === extraScope)?.label || 'Filter'
      : TOPIC_SCOPE_OPTIONS.find((scope) => scope.key === topic)?.label || 'All';

  return (
    <main className="app-shell min-h-screen text-zinc-100">
      <header className="certifyd-fan-toolbar sticky top-0 z-30 border-b border-zinc-800/70 bg-zinc-950/90 backdrop-blur-xl">
        <div className="mx-auto grid max-w-7xl gap-1.5 px-4 py-2">
          <div className="certifyd-fan-toolbar-inner flex items-center gap-2">
            <button type="button" className="network-selector" aria-label="Current network" disabled>
              Public Certifyd <span aria-hidden="true">⌄</span>
            </button>
            <div className="certifyd-fan-toolbar-search">
              <input
                id="certifyd-player-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search creators, works, drops, videos..."
                className="search-input w-full rounded-full border border-zinc-700/80 bg-zinc-900/80 px-4 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-amber-300/70"
              />
            </div>
            <button
              type="button"
              className="mobile-filter-toggle"
              onClick={() => setMobileFiltersOpen((current) => !current)}
              aria-expanded={mobileFiltersOpen}
              aria-controls="certifyd-mobile-filter"
            >
              Filter · {activeScopeLabel}
            </button>
          </div>
          <TopicRail active={topic} activeExtra={extraScope} onChange={onTopicChange} onExtraChange={onExtraScopeChange} />
          {mobileFiltersOpen ? (
            <div id="certifyd-mobile-filter" className="mobile-filter-sheet" role="dialog" aria-label="Filter content">
              <div className="mobile-filter-sheet-head">
                <span>Filter</span>
                <button type="button" onClick={() => setMobileFiltersOpen(false)} aria-label="Close filters">×</button>
              </div>
              <div className="mobile-filter-options">
                {TOPIC_SCOPE_OPTIONS.map((scope) => {
                  const active = !extraScope && topic === scope.key;
                  return (
                    <button
                      key={`mobile-topic:${scope.key}`}
                      type="button"
                      onClick={() => onTopicChange(scope.key)}
                      className={`mobile-filter-option ${active ? 'mobile-filter-option-active' : ''}`}
                    >
                      {scope.label}
                    </button>
                  );
                })}
                {EXTRA_SCOPE_OPTIONS.map((scope) => {
                  const active = extraScope === scope.key;
                  return (
                    <button
                      key={`mobile-extra:${scope.key}`}
                      type="button"
                      onClick={() => onExtraScopeChange(scope.key)}
                      className={`mobile-filter-option ${active ? 'mobile-filter-option-active mobile-filter-option-extra' : ''}`}
                    >
                      {scope.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-3 px-4 py-3">
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

        {hasHomepageContent && showOverview ? (
          <TopActivityBoard
            surfaces={topSurfaces}
            activeCreators={homepageCreators}
            recentItems={boardRecentItems}
            unlockableItems={boardUnlockableItems}
          />
        ) : null}

        {!showOverview && discoveryContext === 'active-creator-ecosystems' ? (
          <ExpandedCreatorNetwork creators={homepageCreators} />
        ) : null}

        {!showOverview && discoveryContext === 'active-creator-ecosystems' && homepageCreators.length === 0 ? (
          <EmptyDiscoveryContext id="active-creator-ecosystems" title="Active Creator Ecosystems" />
        ) : null}

        {!showOverview && showFollowing ? (
          <LocalCreatorSection id="following" title="Following" subtitle="Creators followed locally on this device" creators={hydratedFollowedCreators} />
        ) : null}

        {!showOverview && showSaved ? (
          <SavedLibrarySection works={savedWorks} creators={hydratedSavedCreators} />
        ) : null}

        {!showOverview && !showSaved && !showFollowing && selectedSurface ? (
          <ExpandedRankedSurface surface={selectedSurface} id={discoveryContext} />
        ) : null}

        {!showOverview && !showSaved && !showFollowing && selectedSurface && selectedSurface.items.length === 0 ? (
          <EmptyDiscoveryContext id={discoveryContext} title={selectedContextLabel} />
        ) : null}

        {!showOverview && !showSaved && !showFollowing && discoveryContext !== 'free-drops' && discoveryContext !== 'creator-ecosystems' && discoveryContext !== 'active-creator-ecosystems' && !selectedSurface ? (
          <EmptyDiscoveryContext id={discoveryContext} title={selectedContextLabel} />
        ) : null}

        <div className="space-y-6">
          {discoveryContext === 'free-drops' && freeItems.length > 0 ? (
            <section id="free-drops" className="space-y-3 scroll-mt-40">
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

          {discoveryContext === 'free-drops' && freeItems.length === 0 ? (
            <EmptyDiscoveryContext id="free-drops" title="Free Drops" />
          ) : null}

          {discoveryContext === 'creator-ecosystems' && homepageCreators.length > 0 ? (
            <section id="creator-ecosystems" className="space-y-3 scroll-mt-40">
              <RailHeader title="Creator Ecosystems" subtitle="Hub creators, connected works, and active public catalogs" />
              <CreatorEcosystemGrid creators={homepageCreators} />
            </section>
          ) : null}

          {discoveryContext === 'creator-ecosystems' && homepageCreators.length === 0 ? (
            <EmptyDiscoveryContext id="creator-ecosystems" title="Creator Ecosystems" />
          ) : null}
        </div>

        {origins.length > 0 && !allDone ? <div ref={sentinelRef} className="h-8 w-full" aria-hidden="true" /> : null}
        {loading && items.length > 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center text-xs text-zinc-300">Loading more…</div>
        ) : null}
      </section>
    </main>
  );
}
