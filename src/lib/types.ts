export type Topic =
  | 'all'
  | 'entertainment'
  | 'music'
  | 'news'
  | 'gaming'
  | 'sports'
  | 'technology';

export type AccessMode = 'unlocked' | 'locked' | 'owned';

export type DiscoverableItem = {
  contentId: string;
  title: string;
  description: string | null;
  creatorHandle: string | null;
  contentType: string;
  primaryTopic: Exclude<Topic, 'all'> | null;
  coverUrl: string;
  previewUrl: string;
  buyUrl: string;
  offerUrl: string;
  priceSats: number;
  accessMode: AccessMode;
  publicOrigin: string;
  creatorAvatarUrl?: string | null;
  creatorProfileImageUrl?: string | null;
  profileImageUrl?: string | null;
  avatarUrl?: string | null;
};

export type DiscoverableResponse = {
  items: DiscoverableItem[];
  cursor: string | null;
};

export type OriginFeedState = {
  origin: string;
  cursor: string | null;
  done: boolean;
  loading: boolean;
  error: string | null;
};
