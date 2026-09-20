import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureActivityPub,
  resetActivityPubConfig,
  getSiteBaseUrl,
  getInstanceDomain,
  getUserActorBaseUrl,
  getUserActorDomain,
  getActorUri,
  getInboxUri,
  getOutboxUri,
  getFollowersUri,
  getFollowingUri,
  getLikedUri,
  getWebFingerResource,
  isLocalUri,
  extractHandleFromUri,
} from '../src/index.js';
import { getActorByHandle } from '../src/services/ActorService.js';
import {
  buildBrandActorUris,
  createBrandActor,
  createBrandWebFinger,
} from '../src/services/BrandActorService.js';
import {
  getWebFingerForResource,
  validateWebFingerQuery,
  webFingerFromActor,
} from '../src/services/WebFingerService.js';
import type { Actor } from '../src/types/actor.js';
import { convertNoteToNoteObject } from '../src/services/ContentObjectService.js';
import { parseMentions } from '../src/utils/mentions.js';
import { createGroup, updateGroup, storedGroupToActivityPub } from '../src/services/GroupActorService.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../src/services/ActorService.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/services/ActorService.js')>(),
  getActorByHandle: vi.fn(),
}));

const BROKER_ORIGIN = 'https://hub.tinyland.dev';
const USER_ORIGIN = 'https://mothership.xoxd.ai';
const PUBLIC_KEY = 'TEST-ONLY-PUBLIC-KEY';

function personalActor(): Actor {
  const id = `${USER_ORIGIN}/@alice`;
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type: 'Person',
    preferredUsername: 'alice',
    name: 'Alice',
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    following: `${id}/following`,
    liked: `${id}/liked`,
    publicKey: {
      id: `${id}#main-key`,
      owner: id,
      publicKeyPem: PUBLIC_KEY,
    },
    published: '2026-09-19T00:00:00.000Z',
  };
}

describe('Personal actor origin', () => {
  beforeEach(() => {
    resetActivityPubConfig();
    configureActivityPub({
      siteBaseUrl: BROKER_ORIGIN,
      userActorBaseUrl: `${USER_ORIGIN}/`,
    });
    vi.mocked(getActorByHandle).mockReset();
    vi.mocked(getActorByHandle).mockReturnValue(null);
  });

  afterEach(() => {
    resetActivityPubConfig();
    vi.unstubAllEnvs();
  });

  it('preserves configured site-origin behavior when the override is omitted', () => {
    configureActivityPub({ siteBaseUrl: 'https://legacy.example/' });

    expect(getUserActorBaseUrl()).toBe('https://legacy.example');
    expect(getUserActorDomain()).toBe('legacy.example');
    expect(getActorUri('alice')).toBe('https://legacy.example/@alice');
    expect(getWebFingerResource('alice')).toBe('acct:alice@legacy.example');
    expect(isLocalUri('https://legacy.example/@alice')).toBe(true);
    expect(extractHandleFromUri('https://legacy.example/@alice')).toBe('alice');
  });

  it('routes personal actor and collection helpers through the personal origin', () => {
    expect(getSiteBaseUrl()).toBe(BROKER_ORIGIN);
    expect(getInstanceDomain()).toBe('hub.tinyland.dev');
    expect(getUserActorBaseUrl()).toBe(USER_ORIGIN);
    expect(getUserActorDomain()).toBe('mothership.xoxd.ai');
    expect(getActorUri('alice')).toBe(`${USER_ORIGIN}/@alice`);
    expect(getInboxUri('alice')).toBe(`${USER_ORIGIN}/@alice/inbox`);
    expect(getOutboxUri('alice')).toBe(`${USER_ORIGIN}/@alice/outbox`);
    expect(getFollowersUri('alice')).toBe(`${USER_ORIGIN}/@alice/followers`);
    expect(getFollowingUri('alice')).toBe(`${USER_ORIGIN}/@alice/following`);
    expect(getLikedUri('alice')).toBe(`${USER_ORIGIN}/@alice/liked`);
    expect(getWebFingerResource('alice')).toBe('acct:alice@mothership.xoxd.ai');
  });

  it('retains hub-based brand identity and brand discovery', () => {
    const actor = createBrandActor({
      slug: 'gear',
      name: 'Gear',
      publicKeyPem: PUBLIC_KEY,
    });

    expect(buildBrandActorUris('gear').actorId).toBe(`${BROKER_ORIGIN}/ap/actors/brand/gear`);
    expect(actor.publicKey.owner).toBe(`${BROKER_ORIGIN}/ap/actors/brand/gear`);
    expect(actor.endpoints?.sharedInbox).toBe(`${BROKER_ORIGIN}/inbox`);
    expect(createBrandWebFinger(actor).subject).toBe('acct:gear@hub.tinyland.dev');
    expect(webFingerFromActor(actor).subject).toBe('acct:gear@hub.tinyland.dev');
    expect(webFingerFromActor(actor).links[2].template).toBe(
      `${BROKER_ORIGIN}/authorize_interaction?uri={uri}`,
    );
  });

  it('keeps personal object attribution, collections and local mentions coherent', () => {
    const note = convertNoteToNoteObject({
      type: 'note',
      slug: 'hello',
      content: 'Hello @bob',
      tags: [],
      categories: [],
      authorHandle: 'alice',
      visibility: 'followers',
      date: '2026-09-19T00:00:00.000Z',
      publishedAt: '2026-09-19T00:00:00.000Z',
    }, 'alice');
    expect(note.id).toBe(`${USER_ORIGIN}/@alice/notes/hello`);
    expect(note.attributedTo).toBe(`${USER_ORIGIN}/@alice`);
    expect(note.to).toEqual([`${USER_ORIGIN}/@alice/followers`]);
    expect(parseMentions('Hello @bob')[0]).toMatchObject({
      href: `${USER_ORIGIN}/@bob`,
      domain: 'mothership.xoxd.ai',
      local: true,
    });
  });

  it('keeps group identity at the broker while its moderators use personal identities', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tinyland-group-origin-'));
    vi.stubEnv('ACTIVITYPUB_KEY_ENCRYPTION_KEY', 'test-only-group-origin-encryption-key');
    configureActivityPub({
      siteBaseUrl: BROKER_ORIGIN,
      userActorBaseUrl: USER_ORIGIN,
      activitypubDir: directory,
    });
    try {
      const group = createGroup({
        handle: 'community',
        displayName: 'Community',
        summary: 'Test fixture',
        moderatorHandles: ['alice'],
      });
      expect(group.id).toBe(`${BROKER_ORIGIN}/c/community`);
      expect(group.moderators).toEqual([`${USER_ORIGIN}/@alice`]);
      expect(storedGroupToActivityPub(group).attributedTo).toEqual([`${USER_ORIGIN}/@alice`]);
      const updated = updateGroup('community', { moderatorHandles: ['bob'] });
      expect(updated?.id).toBe(group.id);
      expect(updated?.moderators).toEqual([`${USER_ORIGIN}/@bob`]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recognizes both local origins without accepting a hub personal identity', () => {
    expect(isLocalUri(`${BROKER_ORIGIN}/ap/actors/brand/gear`)).toBe(true);
    expect(isLocalUri(`${USER_ORIGIN}/@alice`)).toBe(true);
    expect(isLocalUri('https://remote.example/@alice')).toBe(false);
    expect(extractHandleFromUri(`${USER_ORIGIN}/@alice/outbox`)).toBe('alice');
    expect(extractHandleFromUri(`${BROKER_ORIGIN}/@alice`)).toBeNull();
    expect(extractHandleFromUri('https://remote.example/@alice')).toBeNull();
  });

  it('uses the personal domain in resource validation and all discovery links', async () => {
    vi.mocked(getActorByHandle).mockReturnValue(personalActor());
    const resource = getWebFingerResource('alice');

    expect(validateWebFingerQuery(new URLSearchParams({ resource })).valid).toBe(true);
    expect(validateWebFingerQuery(new URLSearchParams({
      resource: 'acct:alice@hub.tinyland.dev',
    })).valid).toBe(false);

    const discovery = await getWebFingerForResource(resource);
    expect(discovery?.subject).toBe(resource);
    expect(discovery?.aliases).toEqual([getActorUri('alice'), getActorUri('alice')]);
    expect(discovery?.links[0].href).toBe(personalActor().id);
    expect(discovery?.links[1].href).toBe(personalActor().id);
    expect(discovery?.links[2].template).toBe(`${USER_ORIGIN}/authorize_interaction?uri={uri}`);
    expect(webFingerFromActor(personalActor()).subject).toBe(resource);
    expect(webFingerFromActor(personalActor()).links[0].href).toBe(personalActor().id);
    expect(await getWebFingerForResource(personalActor().id)).not.toBeNull();
  });

  it('does not look up actors for the old personal origin or invalid handles', async () => {
    for (const resource of [
      'acct:alice@hub.tinyland.dev',
      'acct:../alice@mothership.xoxd.ai',
      'acct:alice/bob@mothership.xoxd.ai',
      'acct:alice\\bob@mothership.xoxd.ai',
      'https://mothership.xoxd.ai/@%2e%2e%2falice',
    ]) {
      expect(await getWebFingerForResource(resource)).toBeNull();
    }
    expect(getActorByHandle).not.toHaveBeenCalled();
  });

  it('preserves the host-controlled user resolver fallback without minting actors', async () => {
    const resolveUser = vi.fn(async (handle: string) => (
      handle === 'alice' ? { handle } : null
    ));
    configureActivityPub({
      siteBaseUrl: BROKER_ORIGIN,
      userActorBaseUrl: USER_ORIGIN,
      resolveUser,
    });

    expect((await getWebFingerForResource(getWebFingerResource('alice')))?.links[0].href)
      .toBe(`${USER_ORIGIN}/@alice`);
    expect(await getWebFingerForResource(getWebFingerResource('private-user'))).toBeNull();
    expect(resolveUser).toHaveBeenCalledWith('alice');
    expect(resolveUser).toHaveBeenCalledWith('private-user');
  });

  it('derives arbitrary actor discovery from the supplied actor authority', () => {
    const actor = createBrandActor({
      slug: 'service',
      name: 'Other service',
      publicKeyPem: PUBLIC_KEY,
      baseUrl: 'https://other.example',
    });
    const discovery = webFingerFromActor(actor);

    expect(discovery.subject).toBe('acct:service@other.example');
    expect(discovery.links[0].href).toBe(actor.id);
    expect(discovery.links[2].template).toBe('https://other.example/authorize_interaction?uri={uri}');
  });
});
