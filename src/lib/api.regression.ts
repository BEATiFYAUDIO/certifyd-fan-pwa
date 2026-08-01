import { fetchContentContext } from './api';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export async function runApiRegressionChecks() {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        contentId: 'content-1',
        publicOrigin: 'https://creator.test',
        title: 'Test Work',
        contentType: 'song',
        primaryTopic: 'music',
        creator: {
          handle: 'primary',
          displayName: 'Primary Creator',
          profileImageUrl: '/profiles/primary.jpg',
          profileUrl: '/u/primary',
          publicOrigin: 'https://creator.test',
        },
        peopleBehindThis: [
          {
            handle: 'second',
            displayName: 'Second Creator',
            profileImageUrl: '/profiles/second.jpg',
            profileUrl: '/u/second',
            publicOrigin: 'https://creator.test',
            relationshipLabel: 'writer',
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const context = await fetchContentContext({ origin: 'https://creator.test', contentId: 'content-1' });
    assert(context?.creator?.avatarUrl === 'https://creator.test/profiles/primary.jpg', 'creator profileImageUrl hydrates as avatarUrl');
    assert(context?.peopleBehindThis[0]?.avatarUrl === 'https://creator.test/profiles/second.jpg', 'participant profileImageUrl hydrates as avatarUrl');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void runApiRegressionChecks();
