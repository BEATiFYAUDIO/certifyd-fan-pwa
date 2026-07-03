import type { Topic } from '../lib/types';
import { EXTRA_SCOPE_OPTIONS, TOPIC_SCOPE_OPTIONS } from '../lib/scopeOptions';

export type ExtraScope = 'trending' | 'new' | 'live' | 'following';

export function TopicRail(props: {
  active: Topic;
  activeExtra?: ExtraScope | null;
  onChange: (t: Topic) => void;
  onExtraChange?: (scope: ExtraScope) => void;
}) {
  return (
    <div className="rail-scroll topic-rail-toolbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
      {TOPIC_SCOPE_OPTIONS.map((t) => {
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
      {EXTRA_SCOPE_OPTIONS.map((scope) => {
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
