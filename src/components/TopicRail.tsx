import type { Topic } from '../lib/types';

const topics: Array<{ key: Topic; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'music', label: 'Music' },
  { key: 'news', label: 'News' },
  { key: 'gaming', label: 'Gaming' },
  { key: 'sports', label: 'Sports' },
  { key: 'technology', label: 'Technology' },
];

export function TopicRail(props: { active: Topic; onChange: (t: Topic) => void }) {
  return (
    <div className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-3">
        {topics.map((t) => {
          const active = t.key === props.active;
          return (
            <button
              key={t.key}
              onClick={() => props.onChange(t.key)}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ${
                active
                  ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
