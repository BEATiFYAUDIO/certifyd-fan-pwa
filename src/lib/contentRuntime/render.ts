import type { DiscoverableItem } from '../types';

export type RuntimeRenderKind = 'video' | 'audio' | 'image' | 'document' | 'fallback';

// TODO: Replace this heuristic with canonical Contentbox renderType metadata.
export function inferRuntimeRenderKind(item: DiscoverableItem, streamUrl: string): RuntimeRenderKind {
  const hints = `${item.contentType || ''} ${item.primaryTopic || ''} ${item.primaryFileMime || ''} ${streamUrl || ''} ${item.coverUrl || ''}`.toLowerCase();
  if (/\b(video|movie|film|short|reel)\b/.test(hints) || hints.includes('video/') || /\.(mp4|webm|mov|m4v)(?:$|[?&#])/.test(hints)) return 'video';
  if (/\b(audio|song|music|podcast)\b/.test(hints) || hints.includes('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac)(?:$|[?&#])/.test(hints)) return 'audio';
  if (/\b(image|photo|artwork|poster)\b/.test(hints) || hints.includes('image/') || /\.(png|jpe?g|webp|gif|avif)(?:$|[?&#])/.test(hints)) return 'image';
  if (/\b(document|article|pdf|text)\b/.test(hints) || hints.includes('application/pdf') || /\.(pdf|txt|md)(?:$|[?&#])/.test(hints)) return 'document';
  return streamUrl ? 'audio' : item.coverUrl ? 'image' : 'fallback';
}
