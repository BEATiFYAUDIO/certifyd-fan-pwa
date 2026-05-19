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
  discoveryStatus?: 'live' | 'relegated' | 'unpublished' | 'unavailable' | null;
  originTrust?: 'stable' | 'ephemeral' | 'provider' | null;
  originHealth?: 'healthy' | 'failed' | 'cooldown' | 'unknown' | null;
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

export type ContentContextCreator = {
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  publicOrigin: string | null;
};

export type ContentContextPerson = ContentContextCreator & {
  role: string | null;
  relationshipLabel: string;
};

export type ContentContextWork = {
  contentId: string;
  title: string;
  contentType: string;
  primaryTopic: string | null;
  coverUrl: string | null;
  previewUrl: string | null;
  publicUrl: string | null;
  creator: ContentContextCreator | null;
  relationshipLabel: string;
};

export type ContentRelationshipContext = {
  contentId: string;
  publicOrigin: string | null;
  title: string;
  contentType: string;
  primaryTopic: string | null;
  creator: ContentContextCreator | null;
  peopleBehindThis: ContentContextPerson[];
  featuring: ContentContextPerson[];
  createdWith: ContentContextPerson[];
  builtFrom: ContentContextWork[];
  derivedFrom: ContentContextWork[];
  worksThatBuiltOnThis: ContentContextWork[];
  moreTheyWorkedOn: ContentContextWork[];
  relatedWorks: ContentContextWork[];
  connectedCreators: ContentContextCreator[];
  provenance?: {
    hasManifest?: boolean;
    hasLockedProof?: boolean;
    proofVersion?: number | null;
    lockedAt?: string | null;
  } | null;
  origin?: {
    origin?: string | null;
    displayHost?: string | null;
    health?: string | null;
    trust?: string | null;
  } | null;
  generatedAt?: string;
};
