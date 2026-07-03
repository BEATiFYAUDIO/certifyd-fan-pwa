import { Link } from 'react-router-dom';
import { memo, useMemo, useState } from 'react';
import type { DiscoverableItem } from '../lib/types';
import { canOpenCreator } from '../lib/discoveryGuard';
import { displayStateFromItem } from '../lib/playbackDisplay';
import { getCardThemeVars } from '../lib/profileTheme';
import { useStage1APlayer } from './stage1APlayerContext';

function modeMetaText(mode: DiscoverableItem['accessMode'], priceSats: number) {
  if (mode === 'locked' || Number(priceSats || 0) > 0) return `${priceSats} sats`;
  if (mode === 'owned') return 'Owned';
  return 'Free';
}

function ctaLabel(item: DiscoverableItem) {
  return displayStateFromItem(item).ctaLabel;
}

function sourceLabel(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function avatarInitials(handle: string | null): string {
  const raw = String(handle || '').replace(/^@+/, '').trim();
  if (!raw) return 'CF';
  const tokens = raw.split(/[\s._-]+/).filter(Boolean);
  if (tokens.length >= 2) return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
  return raw.slice(0, 2).toUpperCase();
}

export const FeedCard = memo(function FeedCard({ item }: { item: DiscoverableItem }) {
  const { playItem } = useStage1APlayer();
  const [imageFailed, setImageFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const watchHref = `/watch/${encodeURIComponent(item.contentId)}?origin=${encodeURIComponent(item.publicOrigin)}`;
  const creator = item.creatorHandle || 'creator';
  const creatorHandleClean = String(item.creatorHandle || '').trim().replace(/^@+/, '');
  const creatorProfileUrl =
    creatorHandleClean && item.publicOrigin
      ? `${String(item.publicOrigin).replace(/\/+$/, '')}/u/${encodeURIComponent(creatorHandleClean)}`
      : null;
  const source = sourceLabel(item.publicOrigin);
  const playbackDisplay = displayStateFromItem(item);
  const metadata = `${item.primaryTopic || 'topic'} · ${item.contentType} · ${modeMetaText(item.accessMode, item.priceSats)}`;
  const canShowImage = Boolean(item.coverUrl) && !imageFailed;
  const hasMedia = canShowImage;
  const avatarUrl =
    item.creatorAvatarUrl ||
    item.creatorProfileImageUrl ||
    item.profileImageUrl ||
    item.avatarUrl ||
    '';
  const canShowAvatar = Boolean(avatarUrl) && !avatarFailed;
  const mediaHref = watchHref;
  const mediaIsExternal = mediaHref === item.buyUrl;
  const themeVars = useMemo(() => getCardThemeVars(item.profileTheme), [item.profileTheme]);
  const playFromCardOpen = () => {
    void playItem(item);
  };
  const avatarGradient = useMemo(() => {
    const seed = creator.toLowerCase().charCodeAt(0) || 0;
    const gradients = [
      'from-slate-500/45 via-zinc-500/40 to-slate-600/45',
      'from-amber-500/40 via-orange-500/35 to-yellow-500/40',
      'from-fuchsia-500/40 via-violet-500/35 to-indigo-500/40',
      'from-amber-500/45 via-orange-500/35 to-rose-500/35',
    ];
    return gradients[seed % gradients.length];
  }, [creator]);

  return (
    <article className="creator-themed-card group overflow-hidden rounded-2xl border p-2" style={themeVars}>
      {mediaIsExternal ? (
        <a href={mediaHref} target="_blank" rel="noreferrer" className="block">
          <div className="creator-themed-media relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-800/90 transition duration-300 group-hover:-translate-y-0.5">
            <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                playbackDisplay.state === 'preview'
                  ? 'creator-themed-badge border'
                  : 'creator-themed-badge-muted border'
              }`}>
                {playbackDisplay.label}
              </span>
              <span className="creator-themed-badge rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                Lightning
              </span>
            </div>
            {hasMedia ? (
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
                <p className="mt-1 text-xs text-zinc-400">
                  {(item.primaryTopic || 'topic').toUpperCase()} · {item.contentType.toUpperCase()}
                </p>
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          </div>
        </a>
      ) : (
      <Link to={watchHref} state={{ item }} className="block" onClick={playFromCardOpen}>
        <div className="creator-themed-media relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-800/90 transition duration-300 group-hover:-translate-y-0.5">
          <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              playbackDisplay.state === 'preview'
                ? 'creator-themed-badge border'
                : 'creator-themed-badge-muted border'
            }`}>
              {playbackDisplay.label}
            </span>
            <span className="creator-themed-badge rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              Lightning
            </span>
          </div>
          {hasMedia ? (
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
              <p className="mt-1 text-xs text-zinc-400">
                {(item.primaryTopic || 'topic').toUpperCase()} · {item.contentType.toUpperCase()}
              </p>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        </div>
      </Link>
      )}
      <div className="mt-2 flex gap-2.5">
        {creatorProfileUrl ? (
          <a
            href={creatorProfileUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${creatorHandleClean || creator} profile`}
            className="mt-0.5 block h-8 w-8 shrink-0 rounded-full ring-1 ring-white/15 transition hover:ring-[color:var(--profile-accent)]"
          >
            {canShowAvatar ? (
              <img
                src={avatarUrl}
                alt={`${creator} avatar`}
                className="h-8 w-8 rounded-full object-cover"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-semibold text-zinc-100 ${avatarGradient}`}
                aria-hidden="true"
              >
                {avatarInitials(creator)}
              </div>
            )}
          </a>
        ) : canShowAvatar ? (
          <img
            src={avatarUrl}
            alt={`${creator} avatar`}
            className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/15"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-semibold text-zinc-100 ring-1 ring-white/15 ${avatarGradient}`}
            aria-hidden="true"
          >
            {avatarInitials(creator)}
          </div>
        )}
        <div className="min-w-0">
          <Link to={watchHref} state={{ item }} className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100 hover:underline" onClick={playFromCardOpen}>
            {item.title || 'Untitled'}
          </Link>
          <p className="mt-0.5 text-xs text-zinc-400">@{creator}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{metadata}</p>
          {source ? <p className="mt-0.5 truncate text-[11px] text-zinc-600">from {source}</p> : null}
          <a
            href={canOpenCreator(item) ? item.buyUrl : undefined}
            target={canOpenCreator(item) ? "_blank" : undefined}
            rel={canOpenCreator(item) ? "noreferrer" : undefined}
            className={`mt-1.5 inline-block text-xs font-medium ${
              canOpenCreator(item) ? "creator-themed-link hover:underline" : "text-zinc-500 cursor-not-allowed"
            }`}
            aria-disabled={!canOpenCreator(item)}
            onClick={(e) => {
              if (!canOpenCreator(item)) e.preventDefault();
            }}
          >
            {ctaLabel(item)}
          </a>
        </div>
      </div>
    </article>
  );
});
