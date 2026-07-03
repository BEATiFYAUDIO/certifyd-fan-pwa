import type { Topic } from '../lib/types';

export type ExtraScope = 'trending' | 'new' | 'live' | 'following';

const topics: Array<{ key: Topic; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'music', label: 'Music' },
  { key: 'news', label: 'News' },
  { key: 'gaming', label: 'Gaming' },
  { key: 'sports', label: 'Sports' },
  { key: 'technology', label: 'Technology' },
];

const extraPills: Array<{ key: ExtraScope; label: string }> = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'live', label: 'Live' },
  { key: 'following', label: 'Following' },
];

export function TopicRail(props: {
  active: Topic;
  activeExtra?: ExtraScope | null;
  onChange: (t: Topic) => void;
  onExtraChange?: (scope: ExtraScope) => void;
}) {
  return (
    <div className="rail-scroll topic-rail-toolbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
      {topics.map((t) => {
        const active = t.key === props.active;
        return (
          <button
            key={t.key}
            onClick={() => props.onChange(t.key)}
            className={`topic-pill whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ${
              active
                ? 'topic-pill-active border-amber-300/70 bg-amber-300/15 text-amber-100'
                : 'border-zinc-700 bg-zinc-900/85 text-zinc-300 hover:border-amber-300/35 hover:bg-zinc-800/90'
            }`}
          >
            {t.label}
          </button>
        );
      })}
      {extraPills.map((scope) => {
        const active = props.activeExtra === scope.key;
        return (
          <button
            key={scope.key}
            type="button"
            onClick={() => props.onExtraChange?.(scope.key)}
            className={`topic-pill whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ${
              active
                ? 'topic-pill-active border-fuchsia-300/70 bg-fuchsia-300/15 text-fuchsia-100'
                : 'border-zinc-700 bg-zinc-900/85 text-zinc-300 hover:border-fuchsia-300/35 hover:bg-zinc-800/90'
            }`}
          >
            {scope.label}
          </button>
        );
      })}
    </div>
  );
}
