import { createContext, useContext } from 'react';
import type { DiscoverableItem } from '../lib/types';
import type { PlayerCommerceState } from '../lib/playbackDisplay';

export type Stage1APlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type Stage1APlaybackMode = 'full' | 'preview' | 'none';

export type Stage1APlayerItem = {
  contentId: string;
  publicOrigin: string;
  title: string;
  creator: string;
  artwork: string;
  buyUrl: string;
  creatorUrl: string;
  supportLabel: string;
  commerceState: PlayerCommerceState;
  playbackLabel: string;
  mediaKind: 'audio' | 'video';
  playback: {
    mode: Stage1APlaybackMode;
    streamUrl: string | null;
    previewLimitSeconds: number | null;
    canPlayFull: boolean;
    reason?: string;
  };
};

export type Stage1APlayerContextValue = {
  playItem: (item: DiscoverableItem) => Promise<void>;
  setFreeDropQueue: (items: DiscoverableItem[]) => void;
  togglePlay: () => void;
  playNextFreeDrop: () => void;
  playPreviousFreeDrop: () => void;
  seek: (value: number) => void;
  resetIdle: () => void;
  state: Stage1APlayerState;
  item: Stage1APlayerItem | null;
  message: string;
  progress: number;
  duration: number;
  canPlayNextFreeDrop: boolean;
  canPlayPreviousFreeDrop: boolean;
};

export const Stage1APlayerContext = createContext<Stage1APlayerContextValue | null>(null);

export function useStage1APlayer() {
  const value = useContext(Stage1APlayerContext);
  return value || {
    playItem: async () => undefined,
    setFreeDropQueue: () => undefined,
    togglePlay: () => undefined,
    playNextFreeDrop: () => undefined,
    playPreviousFreeDrop: () => undefined,
    seek: () => undefined,
    resetIdle: () => undefined,
    state: 'idle' as const,
    item: null,
    message: 'Tap Play to start listening',
    progress: 0,
    duration: 0,
    canPlayNextFreeDrop: false,
    canPlayPreviousFreeDrop: false,
  };
}
