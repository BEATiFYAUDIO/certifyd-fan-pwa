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

const extraPills = ['Trending', 'New', 'Live', 'Following'];

export function TopicRail(props: { active: Topic; onChange: (t: Topic) => void }) {
  return (
    <div className="border-b border-zinc-800/70 bg-zinc-950/80 backdrop-blur">
      <div className="rail-scroll mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-1.5">
        {topics.map((t) => {
          const active = t.key === props.active;
          return (
            <button
              key={t.key}
              onClick={() => props.onChange(t.key)}
              className={`topic-pill whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ${
                active
                  ? 'border-amber-300/70 bg-amber-300/15 text-amber-100 shadow-[0_0_0_1px_rgba(255,214,120,0.15)]'
                  : 'border-zinc-700 bg-zinc-900/85 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800/90'
              }`}
            >
              {t.label}
            </button>
          );
        })}
        {extraPills.map((label) => (
          <span
            key={label}
            className="topic-pill whitespace-nowrap rounded-full border border-zinc-700/70 bg-zinc-900/60 px-3 py-1.5 text-sm text-zinc-500"
            aria-hidden="true"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
