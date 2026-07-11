import { createContext, useContext } from 'react';
import type { DiscoverableItem } from '../lib/types';
import type { PlayerCommerceState } from '../lib/playbackDisplay';

export type Stage1APlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type Stage1APlaybackMode = 'full' | 'preview' | 'none';
export type Stage1APlayerDrawerPanel = 'details' | 'creator' | 'more' | 'worked' | 'lineage' | 'connections' | 'proofs' | null;
export type Stage1APlayerMediaAspect = 'landscape' | 'portrait' | 'square' | 'unknown';

export type Stage1APlayerItem = {
  sourceItem?: DiscoverableItem;
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
  connectedLabels: string[];
  detailLabels: string[];
  creditLabels: string[];
  proofLabels: string[];
  description: string;
  mediaKind: 'audio' | 'video';
  playback: {
    mode: Stage1APlaybackMode;
    streamUrl: string | null;
    previewLimitSeconds: number | null;
    canPlayFull: boolean;
    reason?: string;
  };
};

export type Stage1APlayerDrawerContent = {
  moreFromCreator?: DiscoverableItem[];
  moreTheyWorkedOn?: DiscoverableItem[];
  relatedWorks?: DiscoverableItem[];
  connections?: string[];
  lineage?: string[];
  credits?: string[];
};

export type Stage1APlayerOptions = {
  autoPlay?: boolean;
  muted?: boolean;
  openPlayer?: boolean;
  drawer?: Stage1APlayerDrawerPanel;
  mediaAspect?: Stage1APlayerMediaAspect;
  queue?: DiscoverableItem[];
};

export type Stage1APlayerContextValue = {
  playItem: (item: DiscoverableItem, options?: Stage1APlayerOptions) => Promise<void>;
  setMobilePlayerOpen: (open: boolean) => void;
  setPlayerChromeHidden: (hidden: boolean) => void;
  pausePlayback: () => void;
  setFreeDropQueue: (items: DiscoverableItem[]) => void;
  setDrawerContent: (content: Stage1APlayerDrawerContent | null) => void;
  openDrawer: (panel: Stage1APlayerDrawerPanel) => void;
  togglePlay: () => void;
  playNextFreeDrop: () => void;
  playPreviousFreeDrop: () => void;
  seek: (value: number) => void;
  resetIdle: () => void;
  recentItems: DiscoverableItem[];
  playerQueue: DiscoverableItem[];
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
    setMobilePlayerOpen: () => undefined,
    setPlayerChromeHidden: () => undefined,
    pausePlayback: () => undefined,
    setFreeDropQueue: () => undefined,
    setDrawerContent: () => undefined,
    openDrawer: () => undefined,
    togglePlay: () => undefined,
    playNextFreeDrop: () => undefined,
    playPreviousFreeDrop: () => undefined,
    seek: () => undefined,
    resetIdle: () => undefined,
    recentItems: [],
    playerQueue: [],
    state: 'idle' as const,
    item: null,
    message: 'Tap Play to start listening',
    progress: 0,
    duration: 0,
    canPlayNextFreeDrop: false,
    canPlayPreviousFreeDrop: false,
  };
}
