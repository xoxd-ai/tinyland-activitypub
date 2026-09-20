import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureActivityPub, resetActivityPubConfig } from '../src/config.js';
import { handleFollowActivity } from '../src/services/SocialActivityService.js';
import { getFollowers } from '../src/services/FollowersService.js';
import type { Follow } from '../src/types/activitystreams.js';

vi.mock('../src/utils/publicFederationFetch.js', () => ({
  publicFederationFetch: (input: string | URL | Request, init?: RequestInit) => fetch(input, init),
}));

// TIN-2645: inbound Follow handling must fail closed — an inbound Follow is only
// auto-accepted when autoApproveFollows is explicitly `true`. Any other value
// (unset default, undefined, or truthy-but-not-true) leaves it pending.

function makeFollow(): Follow {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: 'https://remote.example/activities/follow-1',
    type: 'Follow',
    actor: 'https://remote.example/@bob',
    object: 'https://example.com/@alice',
  } as Follow;
}

describe('inbound Follow auto-approval (fail-closed)', () => {
  let activitypubDir: string;

  beforeEach(() => {
    activitypubDir = mkdtempSync(join(tmpdir(), 'tinyland-ap-follow-'));
    resetActivityPubConfig();
    // Stub delivery transport so the async Accept delivery kicked off by the
    // auto-approve path never touches the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 202 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetActivityPubConfig();
    rmSync(activitypubDir, { recursive: true, force: true });
  });

  it('leaves the follow pending when autoApproveFollows is unset (default false)', async () => {
    configureActivityPub({ siteBaseUrl: 'https://example.com', activitypubDir });

    await handleFollowActivity(makeFollow(), 'alice');

    expect(getFollowers('alice', 'pending')).toHaveLength(1);
    expect(getFollowers('alice', 'accepted')).toHaveLength(0);
  });

  it('does not auto-accept when autoApproveFollows is a truthy non-true value', async () => {
    configureActivityPub({
      siteBaseUrl: 'https://example.com',
      activitypubDir,
      // Simulate a mis-typed host config; only strict `true` may auto-approve.
      autoApproveFollows: 'true' as unknown as boolean,
    });

    await handleFollowActivity(makeFollow(), 'alice');

    expect(getFollowers('alice', 'accepted')).toHaveLength(0);
    expect(getFollowers('alice', 'pending')).toHaveLength(1);
  });

  it('auto-accepts only when autoApproveFollows is explicitly true', async () => {
    configureActivityPub({
      siteBaseUrl: 'https://example.com',
      activitypubDir,
      autoApproveFollows: true,
    });

    await handleFollowActivity(makeFollow(), 'alice');

    expect(getFollowers('alice', 'accepted')).toHaveLength(1);
    expect(getFollowers('alice', 'pending')).toHaveLength(0);
  });
});
