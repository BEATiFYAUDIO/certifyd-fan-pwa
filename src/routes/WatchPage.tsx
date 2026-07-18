import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStage1APlayer } from '../components/stage1APlayerContext';
import { fetchContentContext } from '../lib/api';
import { hydrateCanonicalOfferForItem, loadDiscoverableById, loadDiscoveryItems, normalizeTopic } from '../lib/contentRuntime';
import { normalizeCanonicalOrigin } from '../lib/origin';
import { buyUrlWithFanReturnUrl, contentboxBuyUrlForItem } from '../lib/fanReturnUrl';
import { canonicalCreatorProfileUrlForItem, canonicalCreatorProfileUrlForPerson } from '../lib/destinations';
import type { ContentContextCreator, ContentContextPerson, ContentContextWork, ContentRelationshipContext, DiscoverableItem } from '../lib/types';
import { isRenderableDiscoveryItem } from '../lib/discoveryGuard';
import { displayStateFromItem } from '../lib/playbackDisplay';
import { buildWatchDiscoveryRails, dedupeDiscoveryItems, itemSortTime, sortNewestFirst, type DiscoveryRail } from '../lib/discoveryViewModel';
import { getCardThemeVars } from '../lib/profileTheme';
import { openExternalNavigation } from '../lib/externalNavigation';
import { creatorFromItem, useLocalLibrary } from '../lib/localLibrary';

function ctaLabel(item: DiscoverableItem) {
  return displayStateFromItem(item).ctaLabel;
}

function priceLabel(item: DiscoverableItem): string {
  return displayStateFromItem(item).label;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Failed to load content';
}

type CreditItem = {
  participantName?: string | null;
  displayName?: string | null;
  handle?: string | null;
  role?: string | null;
  sharePercent?: number | string | null;
  percent?: number | string | null;
};

async function loadCredits(item: DiscoverableItem): Promise<CreditItem[]> {
  const endpoint = `${item.publicOrigin}/public/content/${encodeURIComponent(item.contentId)}/credits`;
  const res = await fetch(endpoint);
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? (data as CreditItem[]) : [];
}

function watchHrefForItem(item: DiscoverableItem): string {
  return `/watch/${encodeURIComponent(item.contentId)}?origin=${encodeURIComponent(item.publicOrigin)}`;
}

function discoveryItemKey(item: Pick<DiscoverableItem, 'contentId' | 'publicOrigin'> | null | undefined): string {
  return item ? `${item.publicOrigin}::${item.contentId}` : '';
}

type WatchDetailRow = { label: string; value: string; kind?: 'item' | 'heading' };
type ConnectionGroup =
  | {
      key: string;
      title: string;
      reason: string;
      kind: 'works';
      items: DiscoverableItem[];
    }
  | {
      key: string;
      title: string;
      reason: string;
      kind: 'contextWorks';
      items: ContentContextWork[];
    }
  | {
      key: string;
      title: string;
      reason: string;
      kind: 'creators';
      items: ContentContextCreator[];
    }
  | {
      key: string;
      title: string;
      reason: string;
      kind: 'people';
      items: ContentContextPerson[];
    };

function addWatchDetailRow(rows: WatchDetailRow[], label: string, value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return;
  rows.push({ label, value: text });
}

function displayConnectionLabel(value: string | null | undefined, fallback = 'work'): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function groupTitleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function discoverableKey(item: DiscoverableItem): string {
  return `${item.publicOrigin}::${item.contentId}`;
}

function normalizedBadge(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function usefulWorkBadge(item: DiscoverableItem, groupKey: string, groupReason?: string): string {
  const explicitBadge = (item.relationshipBadges || [])
    .map((badge) => displayConnectionLabel(badge, ''))
    .find((badge) => {
      const normalized = normalizedBadge(badge);
      return normalized && normalized !== 'same creator' && normalized !== 'same node' && normalized !== 'related work';
    });
  if (explicitBadge) return explicitBadge;
  if (groupKey === 'same-genre' && item.primaryTopic) return displayConnectionLabel(item.primaryTopic, 'Scene');
  if (groupKey === 'same-type' && item.contentType) return displayConnectionLabel(item.contentType, 'Format');
  if (groupKey === 'trending-new') return itemSortLabel(item) || 'Recent';
  if (groupKey === 'related-works') return 'Connected';
  if (groupKey === 'original-work') return 'Built From';
  if (groupKey === 'derivatives') return 'Built On This';
  if (groupKey === 'more-they-worked-on') return 'Shared Credits';
  if (item.primaryTopic) return displayConnectionLabel(item.primaryTopic, 'Topic');
  if (item.contentType) return displayConnectionLabel(item.contentType, 'Format');
  return groupReason && !['same creator', 'same node', 'related work'].includes(normalizedBadge(groupReason))
    ? displayConnectionLabel(groupReason, 'Related')
    : '';
}

function itemSortLabel(item: DiscoverableItem): string {
  const time = itemSortTime(item);
  if (!time) return '';
  const ageMs = Date.now() - time;
  if (ageMs < 0) return 'Scheduled';
  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs <= dayMs * 14) return 'New';
  if (ageMs <= dayMs * 90) return 'Recent';
  return '';
}

function WatchDiscoveryCard({
  item,
  queue,
  groupKey,
  relationshipLabel,
  onSelect,
  onPlay,
}: {
  item: DiscoverableItem;
  queue: DiscoverableItem[];
  groupKey: string;
  relationshipLabel?: string;
  onSelect: (item: DiscoverableItem) => void;
  onPlay: (item: DiscoverableItem, queue: DiscoverableItem[]) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const playbackDisplay = displayStateFromItem(item);
  const creator = String(item.creatorHandle || 'creator').replace(/^@+/, '');
  const secondaryBadge = usefulWorkBadge(item, groupKey, relationshipLabel);
  const themeVars = useMemo(() => getCardThemeVars(item.profileTheme), [item.profileTheme]);
  return (
    <Link
      to={watchHrefForItem(item)}
      state={{ item }}
      className="creator-themed-card group block overflow-hidden rounded-2xl border p-2"
      style={themeVars}
      onClick={(event) => {
        event.preventDefault();
        onSelect(item);
      }}
    >
      <div className="creator-themed-media relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-800/90 transition duration-300 group-hover:-translate-y-0.5">
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            playbackDisplay.state === 'preview' ? 'creator-themed-badge border' : 'creator-themed-badge-muted border'
          }`}>
            {playbackDisplay.label}
          </span>
          {secondaryBadge ? (
            <span className="creator-themed-badge-muted rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {secondaryBadge}
            </span>
          ) : null}
        </div>
        {item.coverUrl && !imageFailed ? (
          <img
            src={item.coverUrl}
            alt={item.title || 'Content cover'}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 px-4 text-center">
            <p className="line-clamp-2 text-sm font-semibold text-zinc-200">{item.title || 'Untitled'}</p>
            <p className="mt-1 text-xs text-zinc-400">{(item.primaryTopic || 'topic').toUpperCase()} · {item.contentType.toUpperCase()}</p>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <button
          type="button"
          className="absolute bottom-2 right-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-black text-black opacity-0 shadow-lg transition group-hover:opacity-100 focus:opacity-100"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPlay(item, queue);
          }}
          aria-label={`Play ${item.title || 'work'}`}
        >
          Play
        </button>
      </div>
      <div className="mt-2 min-w-0">
        <div className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100">{item.title || 'Untitled'}</div>
        <div className="mt-1 truncate text-xs text-zinc-400">@{creator} • {item.contentType || 'work'}</div>
      </div>
    </Link>
  );
}

function ConnectionGroupSection({
  group,
  onSelectItem,
  onPlayItem,
}: {
  group: ConnectionGroup;
  onSelectItem: (item: DiscoverableItem) => void;
  onPlayItem: (item: DiscoverableItem, queue: DiscoverableItem[]) => void;
}) {
  const count = group.items.length;
  if (!count) return null;
  return (
    <section className="watch-connection-group watch-panel rounded-3xl border p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="mt-1 text-xl font-black tracking-tight text-white">{group.title}</h2>
        </div>
      </div>
      {group.kind === 'works' ? (
        <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          {group.items.map((related) => (
            <WatchDiscoveryCard
              key={`${group.key}:${related.publicOrigin}:${related.contentId}`}
              item={related}
              queue={group.items}
              groupKey={group.key}
              relationshipLabel={group.reason}
              onSelect={onSelectItem}
              onPlay={onPlayItem}
            />
          ))}
        </div>
      ) : null}
      {group.kind === 'contextWorks' ? (
        <WorksList works={group.items} onSelectWork={onSelectItem} onPlayWork={onPlayItem} />
      ) : null}
      {group.kind === 'creators' ? <ConnectedCreators creators={group.items} /> : null}
      {group.kind === 'people' ? <PeopleList people={group.items} /> : null}
    </section>
  );
}

function personKey(person: ContentContextPerson | ContentContextCreator): string {
  return `${person.profileUrl || ''}|${person.handle || ''}|${person.displayName || ''}`.toLowerCase();
}

function workKey(work: ContentContextWork): string {
  return `${work.contentId}|${work.publicUrl || ''}`;
}

function watchHrefForWork(work: ContentContextWork): string {
  let origin: string;
  try {
    origin = work.publicUrl ? new URL(work.publicUrl).origin : '';
  } catch {
    origin = '';
  }
  const params = origin ? `?origin=${encodeURIComponent(origin)}` : '';
  return `/watch/${encodeURIComponent(work.contentId)}${params}`;
}

function workToDiscoverableItem(work: ContentContextWork): DiscoverableItem | null {
  let publicOrigin = (work as ContentContextWork & { publicOrigin?: string | null }).publicOrigin || '';
  try {
    publicOrigin = publicOrigin || (work.publicUrl ? new URL(work.publicUrl).origin : '');
  } catch {
    publicOrigin = publicOrigin || '';
  }
  if (!work.contentId || !publicOrigin) return null;
  const buyUrl = contentboxBuyUrlForItem({ contentId: work.contentId, publicOrigin });
  const normalizedTopic = normalizeTopic(work.primaryTopic || 'all');
  return {
    contentId: work.contentId,
    title: work.title || 'Untitled work',
    description: null,
    creatorHandle: work.creator?.handle || work.creator?.displayName || null,
    contentType: work.contentType || 'work',
    primaryTopic: normalizedTopic === 'all' ? null : normalizedTopic,
    coverUrl: work.coverUrl || '',
    previewUrl: work.previewUrl || '',
    buyUrl,
    offerUrl: `${publicOrigin}/buy/content/${encodeURIComponent(work.contentId)}/offer`,
    priceSats: 0,
    accessMode: 'unlocked',
    publicOrigin,
    profileTheme: work.profileTheme || work.creator?.profileTheme || null,
  };
}

function lineageSourceLink(work: ContentContextWork): { href: string; external: boolean } {
  const playable = workToDiscoverableItem(work);
  if (playable) return { href: watchHrefForItem(playable), external: false };
  return { href: work.publicUrl || '', external: true };
}

function compactPersonLabel(person: ContentContextPerson | ContentContextCreator | null | undefined): string {
  if (!person) return '';
  return person.displayName || person.handle || 'Creator';
}

function dedupePeople<T extends ContentContextPerson | ContentContextCreator>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = personKey(row);
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function dedupeWorks(rows: ContentContextWork[], exclude = new Set<string>()): ContentContextWork[] {
  const seen = new Set<string>(exclude);
  const out: ContentContextWork[] = [];
  for (const row of rows) {
    const key = workKey(row);
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function isLowValueGenericPerson(person: ContentContextPerson | ContentContextCreator): boolean {
  const display = String(person.displayName || '').trim().toLowerCase();
  const handle = String(person.handle || '').trim().replace(/^@+/, '').toLowerCase();
  const profileUrl = String(person.profileUrl || '').trim().toLowerCase();
  const isPlaceholderContributor = display === 'contributor' && (!handle || handle === 'contributor');
  const hasPlaceholderProfile = /\/u\/contributor(?:[/?#]|$)/i.test(profileUrl);
  const hasRealPublicIdentity = Boolean(person.avatarUrl || (person.profileUrl && !hasPlaceholderProfile));
  return isPlaceholderContributor && !hasRealPublicIdentity;
}

function filterDisplayPeople(rows: ContentContextPerson[]): ContentContextPerson[] {
  return rows.filter((person) => !isLowValueGenericPerson(person));
}

function filterDisplayCreators(rows: ContentContextCreator[]): ContentContextCreator[] {
  return rows.filter((creator) => !isLowValueGenericPerson(creator));
}

function PeopleList({ people }: { people: ContentContextPerson[] }) {
  if (!people.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {people.map((person) => {
        const label = person.displayName || person.handle || 'Contributor';
        const handle = person.handle ? `@${String(person.handle).replace(/^@+/, '')}` : null;
        const profileUrl = canonicalCreatorProfileUrlForPerson(person);
        const body = (
          <div className="watch-card watch-card-hover flex min-w-0 items-center gap-3 rounded-xl border p-3 transition">
            {person.avatarUrl ? (
              <img src={person.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-zinc-700 object-cover" loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <div className="watch-card flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-xs font-bold watch-accent-text">
                {label.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-100">{label}</div>
              <div className="truncate text-xs text-zinc-400">
                {person.relationshipLabel || person.role || 'Contributor'}{handle ? ` • ${handle}` : ''}
              </div>
            </div>
          </div>
        );
        return profileUrl ? (
          <a key={personKey(person)} href={profileUrl} target="_blank" rel="noreferrer" className="block">
            {body}
          </a>
        ) : (
          <div key={personKey(person)}>{body}</div>
        );
      })}
    </div>
  );
}

function WorksList({
  works,
  onSelectWork,
  onPlayWork,
}: {
  works: ContentContextWork[];
  onSelectWork?: (item: DiscoverableItem) => void;
  onPlayWork?: (item: DiscoverableItem, queue: DiscoverableItem[]) => void;
}) {
  const { playItem } = useStage1APlayer();
  const playableWorks = useMemo(
    () => works.map((work) => workToDiscoverableItem(work)).filter((work): work is DiscoverableItem => Boolean(work)),
    [works]
  );
  if (!works.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {works.map((work) => {
        const creator = work.creator?.displayName || work.creator?.handle || 'Creator';
        const playableWork = workToDiscoverableItem(work);
        const card = (
          <div className="watch-card watch-card-hover group overflow-hidden rounded-xl border text-left transition">
            <div className="relative aspect-video bg-zinc-950">
              {work.coverUrl ? (
                <img src={work.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex h-full items-center justify-center px-3 text-center text-xs uppercase tracking-[0.18em] text-zinc-500">
                  {work.contentType || 'Work'}
                </div>
              )}
              {playableWork ? (
                <button
                  type="button"
                  className="absolute bottom-2 right-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-black text-black opacity-0 shadow-lg transition group-hover:opacity-100 focus:opacity-100"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (onPlayWork) {
                      onPlayWork(playableWork, playableWorks);
                      return;
                    }
                    void playItem(playableWork, { queue: playableWorks, queueSource: 'watch' });
                  }}
                  aria-label={`Play ${work.title || 'work'}`}
                >
                  Play
                </button>
              ) : null}
            </div>
            <div className="space-y-1 p-3">
              <div className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100">{work.title || 'Untitled work'}</div>
              <div className="truncate text-xs text-zinc-400">{creator} • {work.contentType || 'work'}</div>
              <div className="watch-accent-text truncate text-xs font-semibold">{work.relationshipLabel || 'Related work'}</div>
            </div>
          </div>
        );
        return playableWork ? (
          onSelectWork ? (
            <div
              key={workKey(work)}
              role="button"
              tabIndex={0}
              className="block w-full text-left"
              onClick={() => onSelectWork(playableWork)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onSelectWork(playableWork);
              }}
            >
              {card}
            </div>
          ) : (
            <Link
              key={workKey(work)}
              to={watchHrefForItem(playableWork)}
              state={{ item: playableWork }}
              className="block"
            >
              {card}
            </Link>
          )
        ) : work.contentId ? (
          <Link
            key={workKey(work)}
            to={watchHrefForWork(work)}
            className="block"
          >
            {card}
          </Link>
        ) : work.publicUrl ? (
          <a key={workKey(work)} href={work.publicUrl} target="_blank" rel="noreferrer" className="block">{card}</a>
        ) : (
          <div key={workKey(work)}>{card}</div>
        );
      })}
    </div>
  );
}

function ConnectedCreators({ creators }: { creators: ContentContextCreator[] }) {
  const rows = dedupePeople(creators).slice(0, 8);
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((creator) => {
        const label = creator.displayName || creator.handle || 'Creator';
        const profileUrl = canonicalCreatorProfileUrlForPerson(creator);
        const chip = (
          <span className="watch-card watch-card-hover inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm text-zinc-200">
            {creator.avatarUrl ? <img src={creator.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : null}
            <span>{label}</span>
          </span>
        );
        return profileUrl ? (
          <a key={personKey(creator)} href={profileUrl} target="_blank" rel="noreferrer">
            {chip}
          </a>
        ) : (
          <span key={personKey(creator)}>{chip}</span>
        );
      })}
    </div>
  );
}

function buildWatchConnectionGroups({
  item,
  relationshipContext,
  explorationRails,
  discoveryItems,
}: {
  item: DiscoverableItem;
  relationshipContext: ContentRelationshipContext | null;
  explorationRails: DiscoveryRail[];
  discoveryItems: DiscoverableItem[];
}): ConnectionGroup[] {
  const groups: ConnectionGroup[] = [];
  const currentKey = discoverableKey(item);
  const usedDiscoverableKeys = new Set<string>([currentKey]);
  const railByKey = new Map(explorationRails.map((rail) => [rail.key, rail]));
  const pushDiscoverableGroup = (key: string, title: string, reason: string, rows: DiscoverableItem[], minItems = 2) => {
    const items: DiscoverableItem[] = [];
    for (const row of dedupeDiscoveryItems(rows)) {
      const keyForRow = discoverableKey(row);
      if (!keyForRow || usedDiscoverableKeys.has(keyForRow)) continue;
      items.push(row);
      usedDiscoverableKeys.add(keyForRow);
      if (items.length >= 9) break;
    }
    if (items.length < minItems) return;
    groups.push({
      key,
      title,
      reason,
      kind: 'works',
      items,
    });
  };
  const pushContextWorkGroup = (key: string, title: string, reason: string, rows: ContentContextWork[], minItems = 2) => {
    const items: ContentContextWork[] = [];
    for (const work of dedupeWorks(rows)) {
      const playable = workToDiscoverableItem(work);
      const keyForWork = playable ? discoverableKey(playable) : workKey(work);
      if (!keyForWork || usedDiscoverableKeys.has(keyForWork)) continue;
      items.push(work);
      usedDiscoverableKeys.add(keyForWork);
      if (items.length >= 9) break;
    }
    if (items.length < minItems) return;
    groups.push({
      key,
      title,
      reason,
      kind: 'contextWorks',
      items,
    });
  };
  const pushCreatorGroup = (key: string, title: string, reason: string, rows: ContentContextCreator[], minItems = 2) => {
    const items = filterDisplayCreators(dedupePeople(rows)).slice(0, 12);
    if (items.length < minItems) return;
    groups.push({
      key,
      title,
      reason,
      kind: 'creators',
      items,
    });
  };
  const pushPeopleGroup = (key: string, title: string, reason: string, rows: ContentContextPerson[], minItems = 2) => {
    const items = filterDisplayPeople(dedupePeople(rows)).slice(0, 12);
    if (items.length < minItems) return;
    groups.push({
      key,
      title,
      reason,
      kind: 'people',
      items,
    });
  };

  const sameCreator = railByKey.get('more-from-creator');
  if (sameCreator) {
    pushDiscoverableGroup(
      'same-creator',
      'More from this creator',
      'Same creator',
      sameCreator.items,
    );
  }

  if (relationshipContext) {
    pushContextWorkGroup(
      'related-works',
      'Related works',
      'Related work',
      relationshipContext.relatedWorks || [],
    );
    pushCreatorGroup(
      'connected-creators',
      'Connected creators',
      'Connected creator',
      relationshipContext.connectedCreators || [],
    );
    const primaryCreatorKey = relationshipContext.creator ? personKey(relationshipContext.creator) : '';
    const collaborators = [...(relationshipContext.peopleBehindThis || []), ...(relationshipContext.createdWith || []), ...(relationshipContext.featuring || [])]
      .filter((person) => personKey(person) !== primaryCreatorKey);
    pushPeopleGroup(
      'collaborators',
      'Collaborators',
      'Collaborator',
      collaborators,
    );
    pushContextWorkGroup(
      'original-work',
      'Original work',
      'Original work',
      [...(relationshipContext.derivedFrom || []), ...(relationshipContext.builtFrom || [])],
      1,
    );
    pushContextWorkGroup(
      'derivatives',
      'Derivatives',
      'Derived work',
      relationshipContext.worksThatBuiltOnThis || [],
    );
    pushContextWorkGroup(
      'more-they-worked-on',
      'More they worked on',
      'Collaborator',
      relationshipContext.moreTheyWorkedOn || [],
    );
  }

  const sameGenre = railByKey.get('more-like-this');
  if (sameGenre) {
    pushDiscoverableGroup(
      'same-genre',
      'From the same scene',
      displayConnectionLabel(item.primaryTopic, 'Same scene'),
      sameGenre.items,
    );
  }

  const sameType = railByKey.get('same-format');
  if (sameType) {
    pushDiscoverableGroup(
      'same-type',
      `More ${groupTitleCase(displayConnectionLabel(item.contentType, 'works'))}`,
      displayConnectionLabel(item.contentType, 'Same type'),
      sameType.items,
    );
  }

  const sameNode = railByKey.get('same-source');
  if (sameNode) {
    pushDiscoverableGroup(
      'same-node',
      'Same Node',
      'Same node',
      sameNode.items,
    );
  }

  const recent = sortNewestFirst(discoveryItems)
    .filter((row) => discoverableKey(row) !== currentKey)
    .slice(0, 12);
  pushDiscoverableGroup(
    'trending-new',
    'Trending / New',
    'Trending / New',
    recent,
  );

  return groups;
}

function HeroAttributionLineage({
  context,
  credits,
}: {
  context: ContentRelationshipContext | null;
  credits: CreditItem[];
}) {
  const creator = context?.creator || null;
  const creatorProfileUrl = canonicalCreatorProfileUrlForPerson(creator);
  const source = dedupeWorks([...(context?.derivedFrom || []), ...(context?.builtFrom || [])])[0] || null;
  const sourceLink = source ? lineageSourceLink(source) : null;
  const people = filterDisplayPeople(
    dedupePeople([...(context?.peopleBehindThis || []), ...(context?.createdWith || [])]),
  ).slice(0, 4);
  const creditRows = credits.slice(0, 3).map((credit) => {
    const name = credit.displayName || credit.participantName || credit.handle || 'Contributor';
    const handle = credit.handle ? `@${String(credit.handle).replace(/^@+/, '')}` : '';
    const role = credit.role || 'credit';
    const share = credit.sharePercent ?? credit.percent;
    return `${name}${handle ? ` ${handle}` : ''} · ${role}${share != null ? ` · ${share}%` : ''}`;
  });

  if (!creator && !source && people.length === 0 && creditRows.length === 0) return null;

  return (
    <div className="watch-hero-lineage">
      <div className="watch-hero-lineage-head">
        <div>
          <div className="watch-hero-lineage-heading">Attribution & Lineage</div>
          <p>Where this work comes from and who is publicly connected to it.</p>
        </div>
      </div>
      <div className="watch-hero-lineage-grid">
        {creator ? (
          <a
            className="watch-hero-lineage-card watch-hero-lineage-person"
            href={creatorProfileUrl || undefined}
            target={creatorProfileUrl ? '_blank' : undefined}
            rel={creatorProfileUrl ? 'noreferrer' : undefined}
          >
            <span>Created by</span>
            <div>
              {creator.avatarUrl ? <img src={creator.avatarUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
              <strong>{compactPersonLabel(creator)}</strong>
              {creator.handle ? <small>@{String(creator.handle).replace(/^@+/, '')}</small> : null}
            </div>
          </a>
        ) : null}
        {source ? (
          sourceLink?.href && sourceLink.external ? (
            <a className="watch-hero-lineage-card" href={sourceLink.href} target="_blank" rel="noreferrer">
              <span>{source.relationshipLabel || 'Built from'}</span>
              <strong>{source.title || 'Untitled work'}</strong>
              <small>{compactPersonLabel(source.creator)}</small>
            </a>
          ) : sourceLink?.href ? (
            <Link to={sourceLink.href} className="watch-hero-lineage-card">
              <span>{source.relationshipLabel || 'Built from'}</span>
              <strong>{source.title || 'Untitled work'}</strong>
              <small>{compactPersonLabel(source.creator)}</small>
            </Link>
          ) : (
            <div className="watch-hero-lineage-card">
              <span>{source.relationshipLabel || 'Built from'}</span>
              <strong>{source.title || 'Untitled work'}</strong>
              <small>{compactPersonLabel(source.creator)}</small>
            </div>
          )
        ) : null}
        {people.length ? (
          <div className="watch-hero-lineage-card">
            <span>People involved</span>
            <div className="watch-hero-lineage-chips">
              {people.map((person) => {
                const profileUrl = canonicalCreatorProfileUrlForPerson(person);
                const chip = (
                  <small>
                    {person.avatarUrl ? <img src={person.avatarUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
                    <b>{compactPersonLabel(person)}</b>
                    {person.handle ? <em>@{String(person.handle).replace(/^@+/, '')}</em> : null}
                  </small>
                );
                return profileUrl ? (
                  <a key={personKey(person)} href={profileUrl} target="_blank" rel="noreferrer">
                    {chip}
                  </a>
                ) : (
                  <span key={personKey(person)}>{chip}</span>
                );
              })}
            </div>
          </div>
        ) : null}
        {creditRows.length ? (
          <div className="watch-hero-lineage-card">
            <span>Credits</span>
            <div className="watch-hero-lineage-list">
              {creditRows.map((row) => <small key={row}>{row}</small>)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StandardWatch({
  contentId,
  originHint,
  stateItem,
}: {
  contentId: string;
  originHint: string | null;
  stateItem: DiscoverableItem | null;
}) {
  const { item: activePlaybackItem, playItem, setDrawerContent } = useStage1APlayer();
  const { savedWorkKeys, followedCreatorKeys, toggleSavedWork, toggleFollowedCreator } = useLocalLibrary();
  const navigate = useNavigate();
  const [item, setItem] = useState<DiscoverableItem | null>(stateItem && isRenderableDiscoveryItem(stateItem) ? stateItem : null);
  const [loading, setLoading] = useState(!(stateItem && isRenderableDiscoveryItem(stateItem)));
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditItem[]>([]);
  const [discoveryItems, setDiscoveryItems] = useState<DiscoverableItem[]>(stateItem && isRenderableDiscoveryItem(stateItem) ? [stateItem] : []);
  const [relationshipContextState, setRelationshipContextState] = useState<{ key: string; context: ContentRelationshipContext | null } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canonicalHydrationKeys = useRef<Set<string>>(new Set());
  const lastPlaybackSelectionKey = useRef(discoveryItemKey(activePlaybackItem));

  useEffect(() => {
    let active = true;
    if (!contentId) return undefined;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await loadDiscoverableById(contentId, originHint);
        if (!active) return;
        if (!res) {
          setError('Content not found in configured origins.');
          return;
        }
        if (!isRenderableDiscoveryItem(res)) {
          setError("This creator’s node is temporarily offline.");
          return;
        }
        setItem(res);
        setDiscoveryItems((current) => dedupeDiscoveryItems([res, ...current]));
      } catch (e: unknown) {
        if (!active) return;
        setError(toErrorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [contentId, originHint, stateItem]);

  useEffect(() => {
    let active = true;
    if (!item) return;
    const topic = normalizeTopic(item.primaryTopic || 'all');
    void loadDiscoveryItems(topic)
      .then((rows) => {
        if (!active) return;
        setDiscoveryItems(dedupeDiscoveryItems([item, ...rows]));
      })
      .catch(() => {
        if (!active) return;
        setDiscoveryItems((current) => dedupeDiscoveryItems([item, ...current]));
      });
    return () => {
      active = false;
    };
  }, [item]);

  useEffect(() => {
    let active = true;
    if (!item) return;
    void loadCredits(item)
      .then((rows) => {
        if (!active) return;
        setCredits(rows);
      })
      .catch(() => {
        if (!active) return;
        setCredits([]);
      });
    return () => {
      active = false;
    };
  }, [item]);

  useEffect(() => {
    let active = true;
    if (!item) return;
    const key = `${item.publicOrigin}::${item.contentId}`;
    void fetchContentContext({ origin: item.publicOrigin, contentId: item.contentId })
      .then((context) => {
        if (!active) return;
        setRelationshipContextState({ key, context });
      })
      .catch(() => {
        if (!active) return;
        setRelationshipContextState({ key, context: null });
      });
    return () => {
      active = false;
    };
  }, [item]);

  useEffect(() => {
    let active = true;
    if (!item) return;
    const key = `${item.publicOrigin}::${item.contentId}`;
    if (canonicalHydrationKeys.current.has(key)) return;
    canonicalHydrationKeys.current.add(key);
    void hydrateCanonicalOfferForItem(item)
      .then((hydrated) => {
        if (!active || hydrated === item) return;
        setItem(hydrated);
        setDiscoveryItems((current) =>
          dedupeDiscoveryItems([hydrated, ...current.filter((row) => row.contentId !== hydrated.contentId || row.publicOrigin !== hydrated.publicOrigin)]),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [item]);

  const rehydrateCurrentItem = useCallback(async () => {
    if (!item) return;
    const hydrated = await hydrateCanonicalOfferForItem(item);
    if (hydrated === item) return;
    setItem(hydrated);
    setDiscoveryItems((current) =>
      dedupeDiscoveryItems([hydrated, ...current.filter((row) => row.contentId !== hydrated.contentId || row.publicOrigin !== hydrated.publicOrigin)]),
    );
  }, [item]);

  useEffect(() => {
    if (!item) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void rehydrateCurrentItem().catch(() => undefined);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [item, rehydrateCurrentItem]);

  const explorationRails = useMemo(() => {
    if (!item) return [];
    return buildWatchDiscoveryRails(item, discoveryItems);
  }, [item, discoveryItems]);
  const activePlaybackSourceItem = activePlaybackItem?.sourceItem && isRenderableDiscoveryItem(activePlaybackItem.sourceItem)
    ? activePlaybackItem.sourceItem
    : null;
  const activePlaybackKey = discoveryItemKey(activePlaybackItem);
  const selectedContentKey = discoveryItemKey(item);
  const selectionIsDetachedFromPlayback = Boolean(item && activePlaybackItem && selectedContentKey !== activePlaybackKey);
  const returnToNowPlaying = useCallback(() => {
    if (!activePlaybackSourceItem) return;
    setItem(activePlaybackSourceItem);
    setDiscoveryItems((current) => dedupeDiscoveryItems([activePlaybackSourceItem, ...current]));
    navigate(watchHrefForItem(activePlaybackSourceItem), { state: { item: activePlaybackSourceItem } });
  }, [activePlaybackSourceItem, navigate]);
  const selectContentItem = useCallback((nextItem: DiscoverableItem) => {
    const nextContentKey = discoveryItemKey(nextItem);
    setItem(nextItem);
    setDiscoveryItems((current) => dedupeDiscoveryItems([nextItem, ...current]));
    if (nextContentKey === selectedContentKey) return;
    navigate(watchHrefForItem(nextItem), { state: { item: nextItem } });
  }, [navigate, selectedContentKey]);
  const playContentItem = useCallback((nextItem: DiscoverableItem, queue: DiscoverableItem[]) => {
    const nextQueue = queue.length ? queue : [nextItem];
    selectContentItem(nextItem);
    void playItem(nextItem, { queue: nextQueue, queueSource: 'watch' });
  }, [playItem, selectContentItem]);

  useEffect(() => {
    if (!activePlaybackSourceItem) return;
    const nextPlaybackKey = discoveryItemKey(activePlaybackSourceItem);
    if (!nextPlaybackKey || lastPlaybackSelectionKey.current === nextPlaybackKey) return;
    lastPlaybackSelectionKey.current = nextPlaybackKey;
    if (selectedContentKey === nextPlaybackKey) return;
    setItem(activePlaybackSourceItem);
    setDiscoveryItems((current) => dedupeDiscoveryItems([activePlaybackSourceItem, ...current]));
    navigate(watchHrefForItem(activePlaybackSourceItem), { state: { item: activePlaybackSourceItem } });
  }, [activePlaybackSourceItem, navigate, selectedContentKey]);
  const relationshipContext = item && relationshipContextState?.key === `${item.publicOrigin}::${item.contentId}`
    ? relationshipContextState.context
    : null;
  const connectionGroups = useMemo(() => {
    if (!item) return [];
    return buildWatchConnectionGroups({
      item,
      relationshipContext,
      explorationRails,
      discoveryItems,
    });
  }, [discoveryItems, explorationRails, item, relationshipContext]);
  const themeVars = useMemo(() => getCardThemeVars(item?.profileTheme), [item?.profileTheme]);
  const creatorLabel = item?.creatorHandle ? item.creatorHandle.replace(/^@+/, '') : 'creator';
  const selectedCreatorProfileUrl = item ? canonicalCreatorProfileUrlForItem(item) : '';
  const canRestoreAccess = Boolean(item && Number(item.priceSats || 0) > 0 && displayStateFromItem(item).state === 'preview');
  const buyWithReturnUrl = item ? buyUrlWithFanReturnUrl(item.buyUrl, item) : '#';
  const selectedBuyUrl = item?.buyUrl && item.buyUrl !== '#' ? item.buyUrl : '';
  const currentWorkKey = item ? `${item.publicOrigin}::${item.contentId}` : '';
  const currentCreator = item ? creatorFromItem(item) : null;
  const isCurrentSaved = Boolean(currentWorkKey && savedWorkKeys.has(currentWorkKey));
  const isCurrentFollowed = Boolean(currentCreator?.key && followedCreatorKeys.has(currentCreator.key));
  const toggleCurrentSaved = useCallback(() => {
    if (item) toggleSavedWork(item);
  }, [item, toggleSavedWork]);
  const toggleCurrentFollowed = useCallback(() => {
    toggleFollowedCreator(currentCreator);
  }, [currentCreator, toggleFollowedCreator]);
  const shareCurrent = useCallback(async () => {
    if (!item) return;
    const url = selectedBuyUrl || selectedCreatorProfileUrl || window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title || 'Certifyd work', url });
        return;
      }
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
  }, [item, selectedBuyUrl, selectedCreatorProfileUrl]);
  const detailRows = useMemo(() => {
    if (!item) return [];
    const rows: WatchDetailRow[] = [];
    addWatchDetailRow(rows, 'Title', item.title || 'Untitled');
    addWatchDetailRow(rows, 'Creator', creatorLabel ? `@${creatorLabel}` : null);
    addWatchDetailRow(rows, 'Media', item.contentType);
    addWatchDetailRow(rows, 'State', priceLabel(item));
    addWatchDetailRow(rows, 'Type', item.contentType);
    addWatchDetailRow(rows, 'Topic', item.primaryTopic);
    if (Number(item.priceSats || 0) > 0) addWatchDetailRow(rows, 'Price', `${Number(item.priceSats || 0).toLocaleString()} sats`);
    addWatchDetailRow(rows, 'Access', item.accessMode);
    if (item.owned) addWatchDetailRow(rows, 'Ownership', 'owned');
    if (item.hasFullAccess) addWatchDetailRow(rows, 'Playback access', 'full access');
    if (item.isLocked) addWatchDetailRow(rows, 'Lock state', 'locked');
    if (Array.isArray(item.relationshipBadges)) item.relationshipBadges.forEach((badge) => addWatchDetailRow(rows, 'Signal', badge));

    if (relationshipContext) {
      rows.push({ label: 'Connections', value: '', kind: 'heading' });
      addWatchDetailRow(rows, 'Connected creators', relationshipContext.connectedCreators.length ? `${relationshipContext.connectedCreators.length} connected creators` : null);
      addWatchDetailRow(rows, 'Collaborators', credits.length ? `${credits.length} collaborators` : null);
      addWatchDetailRow(rows, 'Attribution', item.attributionLabel || item.relationshipSummary?.attributionLabel);
      addWatchDetailRow(rows, 'Lineage', item.lineageLabel || item.relationshipSummary?.lineageLabel);
      rows.push({ label: 'Attribution & lineage', value: '', kind: 'heading' });
      addWatchDetailRow(rows, 'Created by', relationshipContext.creator ? `${compactPersonLabel(relationshipContext.creator)}${relationshipContext.creator.handle ? ` @${String(relationshipContext.creator.handle).replace(/^@+/, '')}` : ''}` : null);
      filterDisplayPeople(dedupePeople([...(relationshipContext.peopleBehindThis || []), ...(relationshipContext.createdWith || [])]))
        .slice(0, 6)
        .forEach((person) => {
          const handle = person.handle ? ` @${String(person.handle).replace(/^@+/, '')}` : '';
          const role = person.relationshipLabel || person.role || '';
          addWatchDetailRow(rows, 'Person', `${compactPersonLabel(person)}${handle}${role ? ` · ${role}` : ''}`);
        });
    }

    rows.push({ label: 'Proofs & credits', value: '', kind: 'heading' });
    credits.slice(0, 8).forEach((credit) => {
      const name = credit.displayName || credit.participantName || credit.handle || 'Contributor';
      const handle = credit.handle ? ` @${String(credit.handle).replace(/^@+/, '')}` : '';
      const role = credit.role ? ` · ${credit.role}` : '';
      const percent = credit.sharePercent ?? credit.percent;
      addWatchDetailRow(rows, 'Credit', `${name}${handle}${role}${percent != null ? ` · ${percent}%` : ''}`);
    });
    addWatchDetailRow(rows, 'Payment state', item.paymentAccessProof?.paymentState);
    addWatchDetailRow(rows, 'Entitlement', item.paymentAccessProof?.entitlementState);
    addWatchDetailRow(rows, 'Payment receipt', item.paymentAccessProof?.paymentReceiptId);
    addWatchDetailRow(rows, 'Content ID', item.contentId);
    addWatchDetailRow(rows, 'Origin', item.publicOrigin);
    addWatchDetailRow(rows, 'Offer', item.offerUrl || `${item.publicOrigin}/buy/content/${encodeURIComponent(item.contentId)}/offer`);
    return rows;
  }, [credits, creatorLabel, item, relationshipContext]);
  const heroStyle = item?.coverUrl
    ? {
      ...themeVars,
      '--watch-cover-url': `url("${item.coverUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`,
    } as CSSProperties
    : themeVars;
  const watchContextQueue = useMemo(() => {
    if (!item) return [];
    const moreFromCreator = explorationRails.find((rail) => rail.key === 'more-from-creator')?.items || [];
    return dedupeDiscoveryItems([item, ...moreFromCreator]);
  }, [explorationRails, item]);

  useEffect(() => {
    if (!item) return;
    const railItems = dedupeDiscoveryItems(explorationRails.flatMap((rail) => rail.items || []))
      .filter((row) => row.contentId !== item.contentId || row.publicOrigin !== item.publicOrigin);
    const creatorWorks = railItems
      .filter((row) => row.creatorHandle === item.creatorHandle)
      .slice(0, 12);
    const relatedWorks = railItems.slice(0, 12);
    const creditRows = credits.map((credit) => {
      const name = credit.displayName || credit.participantName || 'Contributor';
      const handle = credit.handle ? `@${String(credit.handle).replace(/^@+/, '')}` : '';
      const role = credit.role ? ` • ${credit.role}` : '';
      const pct = credit.sharePercent ?? credit.percent;
      return `${name}${handle ? ` (${handle})` : ''}${role}${pct != null ? ` • ${pct}%` : ''}`;
    });
    const connectionRows = relationshipContext
      ? [
        relationshipContext.creator ? 'Creator relationship context available.' : '',
        Array.isArray(relationshipContext.connectedCreators) && relationshipContext.connectedCreators.length ? `${relationshipContext.connectedCreators.length} connected creators` : '',
        Array.isArray(relationshipContext.relatedWorks) && relationshipContext.relatedWorks.length ? `${relationshipContext.relatedWorks.length} related works` : '',
        Array.isArray(relationshipContext.moreTheyWorkedOn) && relationshipContext.moreTheyWorkedOn.length ? `${relationshipContext.moreTheyWorkedOn.length} works they also worked on` : '',
      ].filter(Boolean)
      : [];
    const sourceWorks = relationshipContext ? dedupeWorks([...(relationshipContext.derivedFrom || []), ...(relationshipContext.builtFrom || [])]).slice(0, 3) : [];
    const peopleRows = relationshipContext
      ? filterDisplayPeople(dedupePeople([...(relationshipContext.peopleBehindThis || []), ...(relationshipContext.createdWith || [])]))
        .slice(0, 6)
        .map((person) => {
          const handle = person.handle ? ` @${String(person.handle).replace(/^@+/, '')}` : '';
          const role = person.relationshipLabel ? ` · ${person.relationshipLabel}` : '';
          return `Person: ${compactPersonLabel(person)}${handle}${role}`;
        })
      : [];
    const lineageRows = [
      relationshipContext?.creator ? `Created by: ${compactPersonLabel(relationshipContext.creator)}${relationshipContext.creator.handle ? ` @${String(relationshipContext.creator.handle).replace(/^@+/, '')}` : ''}` : '',
      ...sourceWorks.map((work) => `${work.relationshipLabel || 'Built from'}: ${work.title || 'Untitled work'}${work.creator ? ` · ${compactPersonLabel(work.creator)}` : ''}`),
      ...peopleRows,
      ...(creditRows.length ? ['Credits', ...creditRows] : []),
    ].filter(Boolean);
    setDrawerContent({
      moreFromCreator: creatorWorks.length ? creatorWorks : relatedWorks,
      moreTheyWorkedOn: relatedWorks,
      relatedWorks,
      connections: connectionRows,
      lineage: lineageRows.length ? lineageRows : connectionRows,
      credits: creditRows,
    });
    return () => setDrawerContent(null);
  }, [credits, explorationRails, item, relationshipContext, setDrawerContent]);

  return (
    <main className="watch-shell min-h-screen text-zinc-100" style={themeVars}>
      <div className="watch-page mx-auto max-w-7xl px-4 py-5 lg:px-6">
        <Link to="/" className="watch-back-link text-sm">← Back</Link>

        {loading ? <div className="watch-panel mt-4 rounded-xl border p-4">Loading…</div> : null}
        {error ? (
          <div className="watch-panel mt-4 rounded-xl border p-6 text-zinc-100">
            <div className="text-lg font-semibold">This creator’s node is temporarily offline.</div>
            <div className="mt-2 text-sm text-zinc-400">Try again shortly or return to discovery.</div>
            <Link
              to="/"
              className="watch-action-secondary mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-semibold"
            >
              Back to Discovery
            </Link>
          </div>
        ) : null}

        {item ? (
          <section className="watch-detail-space mt-4 space-y-5">
            {selectionIsDetachedFromPlayback ? (
              <div className="watch-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Now playing</div>
                  <div className="truncate text-sm font-bold text-zinc-100">{activePlaybackItem?.title || 'Current work'}</div>
                </div>
                {activePlaybackSourceItem ? (
                  <button type="button" className="watch-action-secondary rounded-xl px-3 py-2 text-sm font-bold" onClick={returnToNowPlaying}>
                    Return to Now Playing
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="watch-hero-card relative overflow-hidden rounded-[28px] border" style={heroStyle}>
              {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="watch-hero-backdrop" loading="eager" decoding="async" referrerPolicy="no-referrer" />
              ) : null}
              <div className="watch-hero-content relative z-10">
                <div className="watch-hero-copy">
                  <div className="watch-hero-control-deck">
                    <div className="watch-hero-status-row">
                      <span className="watch-pill">{priceLabel(item)}</span>
                      {item.primaryTopic ? <span className="watch-topic">{item.primaryTopic}</span> : null}
                      {item.contentType ? <span className="watch-topic">{item.contentType}</span> : null}
                    </div>
                    <div className="watch-hero-action-row">
                      <button type="button" className="watch-pill watch-details-pill" onClick={() => setDetailsOpen(true)}>
                        Details
                      </button>
                      {selectedCreatorProfileUrl ? (
                        <a className="watch-pill watch-details-pill" href={selectedCreatorProfileUrl} target="_blank" rel="noreferrer" onClick={(event) => openExternalNavigation(event, selectedCreatorProfileUrl)}>
                          Visit Creator
                        </a>
                      ) : null}
                      {canRestoreAccess ? (
                        <a className="watch-action-primary rounded-xl px-4 py-2 text-sm font-bold" href={buyWithReturnUrl} target="_blank" rel="noreferrer" onClick={(event) => openExternalNavigation(event, buyWithReturnUrl)}>
                          {ctaLabel(item)}
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="watch-hero-main">
                    <h1 className="watch-title text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">{item.title || 'Untitled'}</h1>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-lg font-semibold text-zinc-100">
                      {selectedCreatorProfileUrl ? (
                        <a href={selectedCreatorProfileUrl} target="_blank" rel="noreferrer" className="hover:underline" onClick={(event) => openExternalNavigation(event, selectedCreatorProfileUrl)}>
                          {creatorLabel}
                        </a>
                      ) : (
                        <span>{creatorLabel}</span>
                      )}
                      <span className="watch-verified-dot" aria-hidden="true">●</span>
                    </div>
                    {item.description ? (
                      <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-zinc-100 sm:text-base">{item.description}</p>
                    ) : null}
                  </div>
                </div>

                <div className="watch-preview-stack">
                  <div className="watch-preview-frame group overflow-hidden rounded-2xl border text-left">
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover" loading="eager" decoding="async" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="flex aspect-video h-full w-full items-center justify-center bg-black text-xs uppercase tracking-[0.22em] text-zinc-500">
                        {item.contentType || 'Work'}
                      </div>
                    )}
                    <button
                      type="button"
                      className="absolute bottom-3 right-3 rounded-full bg-white/90 px-4 py-2 text-sm font-black text-black shadow-lg"
                      onClick={() => void playContentItem(item, watchContextQueue)}
                      aria-label={`Play ${item.title || 'work'}`}
                    >
                      Play
                    </button>
                  </div>
                </div>
                <HeroAttributionLineage context={relationshipContext} credits={credits} />
                <div className="watch-hero-mobile-actions">
                  <button type="button" className="watch-details-pill" onClick={toggleCurrentSaved}>
                    {isCurrentSaved ? 'Saved' : 'Save Work'}
                  </button>
                  <button type="button" className="watch-details-pill" onClick={() => void shareCurrent()}>
                    Share
                  </button>
                  <button type="button" className="watch-details-pill" onClick={toggleCurrentFollowed} disabled={!currentCreator}>
                    {isCurrentFollowed ? 'Following' : 'Follow'}
                  </button>
                  {selectedBuyUrl ? (
                    <a className="watch-details-pill" href={selectedBuyUrl} target="_blank" rel="noreferrer" onClick={(event) => openExternalNavigation(event, selectedBuyUrl)}>
                      Visit Work
                    </a>
                  ) : <span aria-hidden="true" />}
                </div>
              </div>
              {detailsOpen ? (
                <div className="watch-details-modal" role="dialog" aria-modal="true" aria-label="Work details" onClick={() => setDetailsOpen(false)}>
                  <div className="watch-details-modal-panel" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="watch-hero-lineage-heading">Details</div>
                      <h2 className="mt-1 text-xl font-black text-white">{item.title || 'Untitled'}</h2>
                    </div>
                    <button type="button" className="watch-details-close" onClick={() => setDetailsOpen(false)} aria-label="Close details">×</button>
                  </div>
                  <div className="watch-details-list">
                    {detailRows.map((row, index) => row.kind === 'heading' ? (
                      <div key={`${row.label}:${index}`} className="watch-details-heading">{row.label}</div>
                    ) : (
                      <div key={`${row.label}:${row.value}:${index}`} className="watch-details-row">
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                      </div>
                    ))}
                  </div>
                  {item.description ? <p className="mt-4 text-sm leading-6 text-zinc-300">{item.description}</p> : null}
                  </div>
                </div>
              ) : null}

            </div>

            <section className="watch-graph-explorer space-y-6">
              {connectionGroups.map((group) => (
                <ConnectionGroupSection
                  key={group.key}
                  group={group}
                  onSelectItem={selectContentItem}
                  onPlayItem={playContentItem}
                />
              ))}
            </section>


          </section>
        ) : null}
      </div>
    </main>
  );
}

export function WatchPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const rawStateItem = (location.state as { item?: DiscoverableItem } | null)?.item || null;
  const contentId = String(params.contentId || '').trim();
  const originHint = normalizeCanonicalOrigin(search.get('origin')) || null;
  const stateItem = originHint && rawStateItem?.contentId === contentId
    ? {
      ...rawStateItem,
      publicOrigin: originHint,
      buyUrl: `${originHint}/buy/${encodeURIComponent(contentId)}`,
      offerUrl: `${originHint}/buy/content/${encodeURIComponent(contentId)}/offer`,
    }
    : rawStateItem;
  return <StandardWatch contentId={contentId} originHint={originHint} stateItem={stateItem} />;
}
