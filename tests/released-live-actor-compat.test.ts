import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureActivityPub, resetActivityPubConfig, getLiveUserActorBaseUrl,
  getUserActorBaseUrl, getActorUri, getFollowersUri, getWebFingerResource,
} from '../src/config.js';
import { ensureActorForUser, getActorByHandle, type ActorReadOptions } from '../src/services/index.js';

const BROKER = 'https://hub.tinyland.dev';
const LIVE = 'https://mothership.xoxd.ai';
const PERSONAL = 'https://other-personal.example';

describe('released 0.3.2 live actor read compatibility', () => {
  let directory: string;
  let actorPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'tinyland-released-live-actor-'));
    actorPath = join(directory, 'actors', 'jesssullivan.json');
    mkdirSync(join(directory, 'actors'));
    // Legacy public-only fixture, not real operator custody or a signing key.
    writeFileSync(actorPath, JSON.stringify({
      handle: 'jesssullivan',
      id: 'https://old-apex.example/@jesssullivan',
      actorType: 'Person',
      displayName: 'Jess Sullivan',
      publicKeyId: 'https://old-apex.example/@jesssullivan#main-key',
      publicKeyPem: 'TEST-ONLY-LEGACY-PUBLIC-STUB',
      privateKeyPem: '',
      avatarUrl: '/avatar.png',
      bannerUrl: '/banner.png',
      discoverable: true,
      indexable: true,
      manuallyApprovesFollowers: false,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    }));
    configureActivityPub({
      activitypubDir: directory,
      siteBaseUrl: `${BROKER}/`,
      liveUserActorBaseUrl: `${LIVE}/`,
    });
  });

  afterEach(() => {
    resetActivityPubConfig();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each([undefined, {}, { useLiveUserActorBaseUrl: false }] satisfies (ActorReadOptions | undefined)[])
    ('keeps the released default broker view for %j', (options) => {
      const before = readFileSync(actorPath, 'utf8');
      expect(getActorByHandle('jesssullivan', options)?.id).toBe(`${BROKER}/@jesssullivan`);
      expect(readFileSync(actorPath, 'utf8')).toBe(before);
    });

  it('preserves the explicit live view for every derived actor URL without writing custody', () => {
    const before = readFileSync(actorPath, 'utf8');
    const actor = getActorByHandle('jesssullivan', { useLiveUserActorBaseUrl: true });
    const id = `${LIVE}/@jesssullivan`;
    expect(actor).toMatchObject({
      id, url: id,
      inbox: `${id}/inbox`, outbox: `${id}/outbox`,
      following: `${id}/following`, followers: `${id}/followers`,
      liked: `${id}/liked`, featured: `${id}/featured`,
      publicKey: { id: `${id}#main-key`, owner: id },
      icon: { url: `${LIVE}/avatar.png` },
      image: { url: `${LIVE}/banner.png` },
      endpoints: { sharedInbox: `${LIVE}/inbox` },
    });
    expect(readFileSync(actorPath, 'utf8')).toBe(before);
  });

  it('falls back to the site when the released live setting is absent', () => {
    configureActivityPub({ activitypubDir: directory, siteBaseUrl: `${BROKER}/` });
    expect(getLiveUserActorBaseUrl()).toBe(BROKER);
    expect(getActorByHandle('jesssullivan', { useLiveUserActorBaseUrl: true })?.id)
      .toBe(`${BROKER}/@jesssullivan`);
  });

  it('does not let the released live option change generic personal helpers', () => {
    expect(getLiveUserActorBaseUrl()).toBe(LIVE);
    expect(getUserActorBaseUrl()).toBe(BROKER);
    expect(getActorUri('jesssullivan')).toBe(`${BROKER}/@jesssullivan`);
    expect(getFollowersUri('jesssullivan')).toBe(`${BROKER}/@jesssullivan/followers`);
    expect(getWebFingerResource('jesssullivan')).toBe('acct:jesssullivan@hub.tinyland.dev');
  });

  it('keeps the explicit full-personal setting independent of legacy views', () => {
    configureActivityPub({
      activitypubDir: directory, siteBaseUrl: BROKER,
      liveUserActorBaseUrl: LIVE, userActorBaseUrl: PERSONAL,
    });
    expect(getUserActorBaseUrl()).toBe(PERSONAL);
    expect(getActorUri('alice')).toBe(`${PERSONAL}/@alice`);
    expect(getLiveUserActorBaseUrl()).toBe(LIVE);
    expect(getActorByHandle('jesssullivan')?.id).toBe(`${BROKER}/@jesssullivan`);
    expect(getActorByHandle('jesssullivan', { useLiveUserActorBaseUrl: true })?.id)
      .toBe(`${LIVE}/@jesssullivan`);
    configureActivityPub({ activitypubDir: directory, siteBaseUrl: BROKER, userActorBaseUrl: PERSONAL });
    expect(getLiveUserActorBaseUrl()).toBe(BROKER);
  });

  it('does not claim a legacy public-only record through owner options or activation', async () => {
    const before = readFileSync(actorPath, 'utf8');
    for (const options of [
      'principal-jess',
      { expectedOwnerId: 'principal-jess' },
      { expectedOwnerId: 'principal-jess', useLiveUserActorBaseUrl: true },
    ]) {
      expect(() => getActorByHandle('jesssullivan', options)).toThrow(/explicit migration is required/);
    }
    await expect(ensureActorForUser({
      id: 'principal-jess', handle: 'jesssullivan',
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    })).rejects.toThrow(/explicit migration is required/);
    expect(readFileSync(actorPath, 'utf8')).toBe(before);
  });

  it('returns null for absent actors without creating files', () => {
    expect(getActorByHandle('absent', { useLiveUserActorBaseUrl: true })).toBeNull();
    expect(getActorByHandle('absent', { expectedOwnerId: 'absent-principal' })).toBeNull();
    expect(readdirSync(join(directory, 'actors'))).toEqual(['jesssullivan.json']);
  });
});
