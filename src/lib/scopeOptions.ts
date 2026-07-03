import type { ExtraScope } from '../components/TopicRail';
import type { Topic } from './types';

export const TOPIC_SCOPE_OPTIONS: Array<{ key: Topic; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'music', label: 'Music' },
  { key: 'news', label: 'News' },
  { key: 'gaming', label: 'Gaming' },
  { key: 'sports', label: 'Sports' },
  { key: 'technology', label: 'Technology' },
];

export const EXTRA_SCOPE_OPTIONS: Array<{ key: ExtraScope; label: string }> = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'live', label: 'Live' },
  { key: 'following', label: 'Following' },
];
