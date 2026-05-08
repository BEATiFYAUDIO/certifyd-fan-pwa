import { Link } from 'react-router-dom';
import type { DiscoverableItem } from '../lib/types';

function modeText(mode: DiscoverableItem['accessMode'], priceSats: number) {
  if (mode === 'locked') return `${priceSats} sats`;
  if (mode === 'owned') return 'Owned';
  return 'Unlocked';
}

export function FeedCard({ item }: { item: DiscoverableItem }) {
  const watchHref = `/watch/${encodeURIComponent(item.contentId)}?origin=${encodeURIComponent(item.publicOrigin)}`;
  return (
    <article className="group overflow-hidden rounded-xl">
      <Link to={watchHref} state={{ item }} className="block">
        <div className="aspect-video overflow-hidden rounded-xl bg-zinc-900">
          {item.coverUrl ? (
            <img
              src={item.coverUrl}
              alt={item.title || 'Content cover'}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">No cover</div>
          )}
        </div>
      </Link>
      <div className="mt-2 flex gap-3">
        <div className="mt-1 h-9 w-9 shrink-0 rounded-full bg-zinc-800" />
        <div className="min-w-0">
          <Link to={watchHref} state={{ item }} className="line-clamp-2 text-sm font-semibold text-zinc-100 hover:underline">
            {item.title || 'Untitled'}
          </Link>
          <p className="mt-0.5 text-xs text-zinc-400">@{item.creatorHandle || 'creator'}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {(item.primaryTopic || 'topic').toString()} • {item.contentType} • {modeText(item.accessMode, item.priceSats)}
          </p>
        </div>
      </div>
    </article>
  );
}
