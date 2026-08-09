export function shortsPlaybackAttemptKey(active: boolean, generation: number, streamUrl: string | null | undefined): string {
  const source = String(streamUrl || '').trim();
  if (!active || generation <= 0 || !source) return '';
  return `${generation}::${source}`;
}

export function shouldAttemptShortsPlayback(previousKey: string, nextKey: string): boolean {
  return Boolean(nextKey && previousKey !== nextKey);
}
