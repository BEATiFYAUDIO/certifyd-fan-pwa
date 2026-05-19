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
  contributors?: DiscoverySignalContributor[];
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

export type DiscoverySignalWork = {
  contentId: string;
  title: string;
  contentType: string;
  primaryTopic: Exclude<Topic, 'all'> | string | null;
  creatorHandle: string | null;
  creatorDisplayName?: string | null;
  creatorAvatarUrl?: string | null;
  publicUrl: string | null;
  coverUrl: string | null;
  previewUrl: string | null;
  accessMode: AccessMode;
  priceSats: number;
  publicOrigin: string | null;
  signals?: {
    support?: string | null;
    unlocks?: string | null;
    views?: string | null;
    collaborators?: number;
    connectedWorks?: number;
  };
  scores?: {
    topConnectedScore?: number;
    supportMomentumScore?: number;
    unlockMomentumScore?: number;
    fastestMovingScore?: number;
  };
  labels?: string[];
  contributors?: DiscoverySignalContributor[];
};

export type DiscoverySignalContributor = {
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  role: string | null;
};

export type DiscoverySignalCreator = {
  creatorHandle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  publicOrigin: string | null;
  workCount: number;
  recentWorkCount: number;
  topicCount: number;
  typeCount: number;
  unlockableWorkCount: number;
  representativeWorks: DiscoverySignalWork[];
  signals?: {
    support?: string | null;
    unlocks?: string | null;
    views?: string | null;
    collaborators?: number;
    connectedWorks?: number;
    originHealth?: 'healthy' | 'failed' | 'cooldown' | 'unknown' | string | null;
    originTrust?: 'stable' | 'ephemeral' | 'provider' | string | null;
  };
  scores?: {
    creatorMomentumScore?: number;
    ecosystemDensityScore?: number;
    supportMomentumScore?: number;
    unlockMomentumScore?: number;
    topConnectedScore?: number;
  };
  labels?: string[];
};

export type DiscoverySignalsResponse = {
  generatedAt: string;
  window: string;
  origin?: {
    publicOrigin?: string | null;
    health?: string | null;
    trust?: string | null;
  } | null;
  creators?: {
    topCreators?: DiscoverySignalCreator[];
  };
  works?: {
    topSelling?: DiscoverySignalWork[];
    mostSupported?: DiscoverySignalWork[];
    fastestMoving?: DiscoverySignalWork[];
    recentlySupported?: DiscoverySignalWork[];
    collaborativeReleases?: DiscoverySignalWork[];
  };
  ecosystems?: DiscoverySignalCreator[];
};
