import { createContext, useContext } from 'react';
import type { DiscoverableItem } from '../lib/types';

export type Stage1APlayerContextValue = {
  playItem: (item: DiscoverableItem) => Promise<void>;
};

export const Stage1APlayerContext = createContext<Stage1APlayerContextValue | null>(null);

export function useStage1APlayer() {
  const value = useContext(Stage1APlayerContext);
  return value || { playItem: async () => undefined };
}
