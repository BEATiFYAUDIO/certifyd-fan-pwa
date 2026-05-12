import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import type { DiscoverableItem } from '../lib/types';

function avatarInitials(handle: string | null): string {
  const raw = String(handle || '').replace(/^@+/, '').trim();
  if (!raw) return 'CF';
  const tokens = raw.split(/[\s._-]+/).filter(Boolean);
  if (tokens.length >= 2) return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
  return raw.slice(0, 2).toUpperCase();
}

export function ShortsCard({ item, watchParams }: { item: DiscoverableItem; watchParams?: string }) {
  const fallbackLogo = `${import.meta.env.BASE_URL}header-logo.png`;
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const query = watchParams || `origin=${encodeURIComponent(item.publicOrigin)}&mode=freebies&topic=all`;
  const watchHref = `/watch/${encodeURIComponent(item.contentId)}?${query}`;
  const creator = item.creatorHandle || 'creator';
  const creatorHandleClean = String(item.creatorHandle || '').trim().replace(/^@+/, '');
  const creatorProfileUrl =
    creatorHandleClean && item.publicOrigin
      ? `${String(item.publicOrigin).replace(/\/+$/, '')}/u/${encodeURIComponent(creatorHandleClean)}`
      : null;

  const avatarUrl =
    item.creatorAvatarUrl ||
    item.creatorProfileImageUrl ||
    item.profileImageUrl ||
    item.avatarUrl ||
    '';
  const canShowAvatar = Boolean(avatarUrl) && !avatarFailed;
  const normalizedType = String(item.contentType || '').toLowerCase();
  const isVideo = normalizedType === 'video';

  const canShowVideo = isVideo && Boolean(item.previewUrl) && !videoFailed;
  const canShowImage = Boolean(item.coverUrl) && !imageFailed;

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
    <article className="group relative aspect-[9/16] w-[78vw] max-w-[340px] shrink-0 snap-start overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-zinc-800/90 transition duration-300 hover:-translate-y-0.5 hover:ring-zinc-600 md:w-[280px] md:max-w-[280px] lg:w-[300px] lg:max-w-[300px]">
      <Link to={watchHref} state={{ item }} className="absolute inset-0 block">
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-1.5">
          <span className="rounded-full border border-slate-300/45 bg-slate-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-100">
            Free
          </span>
          <span className="rounded-full border border-amber-300/35 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
            Lightning
          </span>
        </div>
        {canShowVideo ? (
          <video
            src={item.previewUrl}
            className="h-full w-full object-cover"
            muted
            autoPlay
            loop
            playsInline
            preload="metadata"
            onError={() => setVideoFailed(true)}
          />
        ) : canShowImage ? (
          <img
            src={item.coverUrl}
            alt={item.title || 'Content cover'}
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 text-sm text-zinc-400">
            <img src={fallbackLogo} alt="" className="mb-3 h-10 w-auto opacity-70" />
            <span>No media</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/95 via-black/55 to-transparent" />
      </Link>

      <div className="absolute inset-x-0 bottom-0 z-10 p-4">
        <div className="flex items-end gap-3">
          {creatorProfileUrl ? (
            <a
              href={creatorProfileUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${creatorHandleClean || creator} profile`}
              className="pointer-events-auto block h-10 w-10 shrink-0 rounded-full ring-1 ring-white/25 transition hover:ring-amber-400/90"
            >
              {canShowAvatar ? (
                <img
                  src={avatarUrl}
                  alt={`${creator} avatar`}
                  className="h-10 w-10 rounded-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-xs font-semibold text-zinc-100 ${avatarGradient}`}
                  aria-hidden="true"
                >
                  {avatarInitials(creator)}
                </div>
              )}
            </a>
          ) : (
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-semibold text-zinc-100 ring-1 ring-white/25 ${avatarGradient}`}
              aria-hidden="true"
            >
              {avatarInitials(creator)}
            </div>
          )}
          <div className="min-w-0">
            <Link to={watchHref} state={{ item }} className="line-clamp-2 text-base font-semibold leading-5 text-white hover:underline">
              {item.title || 'Untitled'}
            </Link>
            <p className="mt-1 text-sm text-zinc-200">@{creator}</p>
          </div>
        </div>
      </div>
    </article>
  );
}
