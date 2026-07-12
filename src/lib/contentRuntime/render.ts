import type { DiscoverableItem } from '../types';

export type RuntimeRenderKind = 'video' | 'audio' | 'image' | 'document' | 'fallback';

// TODO: Replace this heuristic with canonical Contentbox renderType metadata.
export function inferRuntimeRenderKind(item: DiscoverableItem, streamUrl: string): RuntimeRenderKind {
  const contentType = `${item.contentType || ''}`.toLowerCase();
  const topic = `${item.primaryTopic || ''}`.toLowerCase();
  const mime = `${item.primaryFileMime || ''}`.toLowerCase();
  const mediaUrl = `${streamUrl || ''}`.toLowerCase();
  const coverUrl = `${item.coverUrl || ''}`.toLowerCase();
  const explicitHints = `${contentType} ${mime} ${mediaUrl}`;
  const artworkHints = `${contentType} ${mime} ${coverUrl}`;

  if (explicitHints.includes('video/') || /\.(mp4|webm|mov|m4v)(?:$|[?&#])/.test(mediaUrl) || /\b(video|movie|film|short|reel)\b/.test(contentType)) return 'video';
  if (explicitHints.includes('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac)(?:$|[?&#])/.test(mediaUrl) || /\b(audio|song|podcast)\b/.test(contentType)) return 'audio';
  if (explicitHints.includes('application/pdf') || /\.(pdf|txt|md)(?:$|[?&#])/.test(mediaUrl) || /\b(document|article|pdf|text)\b/.test(contentType)) return 'document';
  if (artworkHints.includes('image/') || /\.(png|jpe?g|webp|gif|avif)(?:$|[?&#])/.test(coverUrl) || /\b(image|photo|artwork|poster)\b/.test(contentType)) return 'image';
  if (/\b(music)\b/.test(topic) && streamUrl) return 'audio';
  return streamUrl ? 'audio' : item.coverUrl ? 'image' : 'fallback';
}
