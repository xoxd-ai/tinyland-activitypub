import * as fs from 'fs';
import crypto from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureActivityPub, resetActivityPubConfig } from '../src/config.js';
import {
  createActorFromUser,
  decryptPrivateKey,
  deleteActor,
  encryptPrivateKey,
  ensureActorForUser,
  getActorByHandle,
  getActorPrivateKey,
  type ActorActivationUser,
  type StoredActor,
} from '../src/services/ActorService.js';

// Retain real disk/encryption behavior, replacing only the individual syscall
// under test. Fixture setup and cleanup use the unmocked filesystem below.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    renameSync: vi.fn(actual.renameSync),
    fsyncSync: vi.fn(actual.fsyncSync),
    closeSync: vi.fn(actual.closeSync),
    unlinkSync: vi.fn(actual.unlinkSync),
  };
});

const realFs = await vi.importActual<typeof import('fs')>('fs');
const USER_ORIGIN = 'https://mothership.xoxd.ai';
const OWNER_ID = 'test-principal-alice';
const TEST_SECRET = 'test-only-actor-encryption-secret';
const KEY_ENV_VARS = [
  'ACTIVITYPUB_KEY_ENCRYPTION_KEY',
  'TOTP_ENCRYPTION_KEY',
  'AUTH_SECRET',
] as const;
const USER: ActorActivationUser = {
  id: OWNER_ID,
  handle: 'alice',
  displayName: 'Alice',
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
};

function testKeyPair(): { publicKey: string; privateKey: string } {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('Owner-bound actor activation', () => {
  let directory: string;
  let savedEnvironment: Record<string, string | undefined>;
  let keyPair: ReturnType<typeof testKeyPair>;
  let otherKeyPair: ReturnType<typeof testKeyPair>;

  beforeAll(() => {
    // Generated solely for this test process; never operator/live key material.
    keyPair = testKeyPair();
    otherKeyPair = testKeyPair();
  });

  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReset().mockImplementation(realFs.readFileSync);
    vi.mocked(fs.renameSync).mockReset().mockImplementation(realFs.renameSync);
    vi.mocked(fs.fsyncSync).mockReset().mockImplementation(realFs.fsyncSync);
    vi.mocked(fs.closeSync).mockReset().mockImplementation(realFs.closeSync);
    vi.mocked(fs.unlinkSync).mockReset().mockImplementation(realFs.unlinkSync);
    savedEnvironment = {};
    for (const name of KEY_ENV_VARS) {
      savedEnvironment[name] = process.env[name];
      delete process.env[name];
    }
    process.env.ACTIVITYPUB_KEY_ENCRYPTION_KEY = TEST_SECRET;
    directory = realFs.mkdtempSync(join(tmpdir(), 'tinyland-actor-activation-'));
    resetActivityPubConfig();
    configureActivityPub({
      activitypubDir: directory,
      siteBaseUrl: 'https://hub.tinyland.dev',
      userActorBaseUrl: USER_ORIGIN,
    });
  });

  afterEach(() => {
    resetActivityPubConfig();
    for (const name of KEY_ENV_VARS) {
      if (savedEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnvironment[name];
    }
    realFs.rmSync(directory, { recursive: true, force: true });
  });

  function actorPath(): string {
    return join(directory, 'actors', `${USER.handle}.json`);
  }

  function storedBytes(): string {
    return realFs.readFileSync(actorPath(), 'utf8');
  }

  function storedActor(): StoredActor {
    return JSON.parse(storedBytes()) as StoredActor;
  }

  function fixture(overrides: Partial<StoredActor> = {}): StoredActor {
    const id = `${USER_ORIGIN}/@${USER.handle}`;
    return {
      id,
      handle: USER.handle,
      ownerId: OWNER_ID,
      displayName: USER.displayName,
      discoverable: false,
      indexable: false,
      manuallyApprovesFollowers: false,
      publicKeyId: `${id}#main-key`,
      publicKeyPem: keyPair.publicKey,
      privateKeyPem: encryptPrivateKey(keyPair.privateKey),
      actorType: 'Person',
      visibility: 'private',
      createdAt: USER.createdAt,
      updatedAt: USER.updatedAt,
      ...overrides,
    };
  }

  function seed(record: StoredActor | string): void {
    realFs.mkdirSync(join(directory, 'actors'), { recursive: true });
    realFs.writeFileSync(actorPath(), typeof record === 'string' ? record : JSON.stringify(record), 'utf8');
  }

  it('creates private, encrypted, owner-bound custody with canonical key IDs', async () => {
    const actor = await ensureActorForUser(USER);
    const persisted = storedActor();
    const privateKey = getActorPrivateKey(USER.handle, OWNER_ID)!;

    expect(actor.id).toBe(`${USER_ORIGIN}/@alice`);
    expect(actor.publicKey.id).toBe(`${actor.id}#main-key`);
    expect(actor.publicKey.owner).toBe(actor.id);
    expect(actor.endpoints?.sharedInbox).toBe(`${USER_ORIGIN}/inbox`);
    expect(actor.discoverable).toBe(false);
    expect(actor.indexable).toBe(false);
    expect(persisted.ownerId).toBe(OWNER_ID);
    expect(persisted.visibility).toBe('private');
    expect(persisted.discoverable).toBe(false);
    expect(persisted.indexable).toBe(false);
    expect(persisted.privateKeyPem).toMatch(/^enc:/);
    expect(storedBytes()).not.toContain('BEGIN PRIVATE KEY');
    expect(realFs.statSync(actorPath()).mode & 0o777).toBe(0o600);
    expect(decryptPrivateKey(persisted.privateKeyPem)).toBe(privateKey);
    const message = Buffer.from('test-only custody proof');
    expect(crypto.verify('sha256', message, actor.publicKey.publicKeyPem,
      crypto.sign('sha256', message, privateKey))).toBe(true);
    expect(getActorByHandle(USER.handle, OWNER_ID)?.publicKey).toEqual(actor.publicKey);
  });

  it('converges concurrent retries without rotating keys or rewriting ciphertext/profile', async () => {
    const actors = await Promise.all(Array.from({ length: 6 }, () => ensureActorForUser(USER)));
    const original = storedBytes();
    for (const actor of actors) expect(actor.publicKey).toEqual(actors[0].publicKey);

    const retried = await ensureActorForUser({ ...USER, displayName: 'Changed' }, {
      bio: 'Changed profile',
      visibility: 'public',
    });
    expect(retried.publicKey).toEqual(actors[0].publicKey);
    expect(retried.name).toBe('Alice');
    expect(retried.discoverable).toBe(false);
    expect(storedBytes()).toBe(original);
    expect(fs.renameSync).toHaveBeenCalledTimes(1);
  });

  it('does not let a concurrent different owner take over the same handle', async () => {
    const [first, second] = await Promise.allSettled([
      ensureActorForUser(USER),
      ensureActorForUser({ ...USER, id: 'different-principal' }),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect(storedActor().ownerId).toBe(OWNER_ID);
    expect(fs.renameSync).toHaveBeenCalledTimes(1);
  });

  it('reuses existing custody read from disk without rewriting it', async () => {
    seed(fixture());
    const original = storedBytes();
    const actor = await ensureActorForUser(USER);
    expect(actor.publicKey.publicKeyPem).toBe(keyPair.publicKey);
    expect(getActorPrivateKey(USER.handle, OWNER_ID)).toBe(keyPair.privateKey);
    expect(storedBytes()).toBe(original);
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it.each([
    ['a different owner', () => ({ ownerId: 'different-principal' }), /owner does not match/],
    ['legacy unbound custody', () => ({ ownerId: undefined }), /explicit migration is required/],
    ['a stored handle mismatch', () => ({ handle: 'someone-else' }), /Invalid .* custody record/],
    ['a malformed envelope', () => ({ privateKeyPem: 'enc:bad:envelope' }), /Invalid .* envelope/],
    ['plaintext owner-bound custody', () => ({ privateKeyPem: keyPair.privateKey }), /must be encrypted/],
    ['a mismatched RSA pair', () => ({ publicKeyPem: otherKeyPair.publicKey }), /key verification failed/],
    ['a malformed public key', () => ({ publicKeyPem: 'not-a-public-key' }), /key verification failed/],
    ['an invalid private key', () => ({ privateKeyPem: encryptPrivateKey('not-a-private-key') }), /key verification failed/],
    ['missing private custody', () => ({ privateKeyPem: '' }), /custody is incomplete/],
    ['an old actor origin', () => ({ id: 'https://hub.tinyland.dev/@alice' }), /origin does not match/],
    ['an old key identity', () => ({ publicKeyId: 'https://hub.tinyland.dev/@alice#main-key' }), /origin does not match/],
  ] as const)('rejects %s without overwriting custody', async (_name, overrides, message) => {
    seed(fixture(overrides()));
    const original = storedBytes();
    await expect(ensureActorForUser(USER)).rejects.toThrow(message);
    expect(storedBytes()).toBe(original);
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it.each(['{invalid JSON', 'null', '[]', '{}'])('does not treat corrupt record %s as absence', async (record) => {
    seed(record);
    await expect(ensureActorForUser(USER)).rejects.toThrow(/Invalid .* custody record/);
    expect(storedBytes()).toBe(record);
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it('rejects an incorrect encryption key without replacing existing custody', async () => {
    seed(fixture());
    const original = storedBytes();
    process.env.ACTIVITYPUB_KEY_ENCRYPTION_KEY = 'different-test-only-encryption-secret';
    await expect(ensureActorForUser(USER)).rejects.toThrow('Cannot decrypt ActivityPub private-key custody');
    expect(storedBytes()).toBe(original);
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it('checks expected owner and custody on both actor and private-key reads', () => {
    seed(fixture());
    expect(getActorByHandle(USER.handle, OWNER_ID)?.id).toBe(`${USER_ORIGIN}/@alice`);
    expect(getActorPrivateKey(USER.handle, OWNER_ID)).toBe(keyPair.privateKey);
    expect(() => getActorByHandle(USER.handle, 'different-principal')).toThrow(/owner does not match/);
    expect(() => getActorPrivateKey(USER.handle, 'different-principal')).toThrow(/owner does not match/);
    expect(() => getActorByHandle(USER.handle, '')).toThrow(/stable owner identity/);
    expect(() => getActorPrivateKey(USER.handle, '')).toThrow(/stable owner identity/);
    seed(fixture({ publicKeyPem: otherKeyPair.publicKey }));
    expect(() => getActorByHandle(USER.handle, OWNER_ID)).toThrow(/key verification failed/);
    expect(() => getActorPrivateKey(USER.handle, OWNER_ID)).toThrow(/key verification failed/);
  });

  it('requires the owner before deleting owner-bound custody', () => {
    seed(fixture());
    const original = storedBytes();
    expect(() => deleteActor(USER.handle)).toThrow(/stable owner identity/);
    expect(() => deleteActor(USER.handle, 'different-principal')).toThrow(/owner does not match/);
    expect(storedBytes()).toBe(original);
    deleteActor(USER.handle, OWNER_ID);
    expect(realFs.existsSync(actorPath())).toBe(false);
  });

  it('enforces bound custody integrity even for callers omitting expectedOwnerId', () => {
    seed(fixture({ id: 'https://hub.tinyland.dev/@alice' }));
    expect(() => getActorByHandle(USER.handle)).toThrow(/origin does not match/);
    expect(() => getActorPrivateKey(USER.handle)).toThrow(/origin does not match/);
    seed(fixture({ publicKeyPem: otherKeyPair.publicKey }));
    expect(() => getActorByHandle(USER.handle)).toThrow(/key verification failed/);
    expect(() => getActorPrivateKey(USER.handle)).toThrow(/key verification failed/);
  });

  it('flushes the custody parent entry when initializing a new actor directory', async () => {
    const parent = realFs.statSync(directory);
    let flushedParent = false;
    vi.mocked(fs.fsyncSync).mockImplementation((descriptor) => {
      const stat = realFs.fstatSync(descriptor);
      if (stat.dev === parent.dev && stat.ino === parent.ino) flushedParent = true;
      realFs.fsyncSync(descriptor);
    });
    await ensureActorForUser(USER);
    expect(flushedParent).toBe(true);
  });

  it('rejects an unconfirmed deletion and safely finishes its directory flush on retry', () => {
    seed(fixture());
    vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
      throw new Error('TEST-ONLY sensitive deletion flush detail');
    });
    expect(() => deleteActor(USER.handle, OWNER_ID)).toThrow('Cannot delete ActivityPub actor custody');
    expect(realFs.existsSync(actorPath())).toBe(false);
    expect(() => deleteActor(USER.handle, OWNER_ID)).not.toThrow();
  });

  it('keeps legacy sync refresh compatible without double encryption or key rotation', () => {
    const { id: _ownerId, ...legacyUser } = USER;
    const first = createActorFromUser(legacyUser);
    const privateKey = getActorPrivateKey(USER.handle)!;
    const refreshed = createActorFromUser({ ...legacyUser, displayName: 'Updated Alice' });
    expect(first.publicKey.id).toBe(`${USER_ORIGIN}/@alice#main-key`);
    expect(refreshed.publicKey).toEqual(first.publicKey);
    expect(decryptPrivateKey(storedActor().privateKeyPem)).toBe(privateKey);
    expect(getActorPrivateKey(USER.handle)).toBe(privateKey);
    expect(storedActor().ownerId).toBeUndefined();
    expect(refreshed.name).toBe('Updated Alice');
  });

  it('encrypts legacy plaintext during an explicit sync refresh without adopting an owner', () => {
    seed(fixture({ ownerId: undefined, privateKeyPem: keyPair.privateKey }));
    const { id: _ownerId, ...legacyUser } = USER;
    createActorFromUser(legacyUser);
    expect(storedActor().privateKeyPem).toMatch(/^enc:/);
    expect(getActorPrivateKey(USER.handle)).toBe(keyPair.privateKey);
    expect(storedActor().ownerId).toBeUndefined();
  });

  it('does not allow a legacy sync caller to overwrite bound custody', () => {
    seed(fixture());
    const original = storedBytes();
    const { id: _ownerId, ...legacyUser } = USER;
    expect(() => createActorFromUser(legacyUser)).toThrow(/stable owner identity/);
    expect(storedBytes()).toBe(original);
  });

  it.each(['', '../alice', 'alice/bob', 'alice\\bob', '.', '..', 'alice%2fbob', 'alice@remote', 'alice\0'])
    ('rejects unsafe handle %j before filesystem access', async (handle) => {
      await expect(ensureActorForUser({ ...USER, handle })).rejects.toThrow(/Invalid .* handle/);
      expect(() => createActorFromUser({ ...USER, handle })).toThrow(/Invalid .* handle/);
      expect(() => getActorByHandle(handle)).toThrow(/Invalid .* handle/);
      expect(() => getActorPrivateKey(handle)).toThrow(/Invalid .* handle/);
      expect(() => deleteActor(handle)).toThrow(/Invalid .* handle/);
      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(fs.renameSync).not.toHaveBeenCalled();
    });

  it.each(['', '   '])('rejects missing stable owner %j before filesystem access', async (id) => {
    await expect(ensureActorForUser({ ...USER, id })).rejects.toThrow(/stable owner identity/);
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it('fails closed without an encryption secret, then permits a valid retry', async () => {
    delete process.env.ACTIVITYPUB_KEY_ENCRYPTION_KEY;
    await expect(ensureActorForUser(USER)).rejects.toThrow(/no key-encryption secret is configured/);
    expect(realFs.existsSync(actorPath())).toBe(false);
    process.env.ACTIVITYPUB_KEY_ENCRYPTION_KEY = TEST_SECRET;
    await expect(ensureActorForUser(USER)).resolves.toMatchObject({ id: `${USER_ORIGIN}/@alice` });
  });

  it('does not mistake a read permission error for absent custody', async () => {
    seed(fixture());
    const original = storedBytes();
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('test-only read failure detail'), { code: 'EACCES' });
    });
    await expect(ensureActorForUser(USER)).rejects.toThrow('Cannot read ActivityPub actor custody');
    expect(storedBytes()).toBe(original);
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it.each(['file fsync', 'rename'] as const)('rejects a %s failure and clears the queue for retry', async (phase) => {
    const fault = () => { throw new Error('test-only persistence failure detail'); };
    let failed = false;
    if (phase === 'file fsync') {
      vi.mocked(fs.fsyncSync).mockImplementation((descriptor) => {
        if (!failed && realFs.fstatSync(descriptor).isFile()) {
          failed = true;
          fault();
        }
        realFs.fsyncSync(descriptor);
      });
    } else vi.mocked(fs.renameSync).mockImplementationOnce(fault);

    await expect(ensureActorForUser(USER)).rejects.toThrow('Cannot persist ActivityPub actor custody');
    expect(realFs.existsSync(actorPath())).toBe(false);
    expect(realFs.readdirSync(join(directory, 'actors'))).toEqual([]);
    await expect(ensureActorForUser(USER)).resolves.toMatchObject({ id: `${USER_ORIGIN}/@alice` });
  });

  it('preserves old custody when a sync refresh cannot rename its temporary file', () => {
    seed(fixture({ ownerId: undefined }));
    const original = storedBytes();
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error('test-only rename failure detail');
    });
    const { id: _ownerId, ...legacyUser } = USER;
    expect(() => createActorFromUser(legacyUser)).toThrow('Cannot persist ActivityPub actor custody');
    expect(storedBytes()).toBe(original);
    expect(realFs.readdirSync(join(directory, 'actors'))).toEqual(['alice.json']);
  });

  it('rejects directory fsync failure after rename and preserves committed custody on retry', async () => {
    let committed = false;
    vi.mocked(fs.renameSync).mockImplementation((source, target) => {
      realFs.renameSync(source, target);
      committed = true;
    });
    vi.mocked(fs.fsyncSync).mockImplementation((descriptor) => {
      if (committed && realFs.fstatSync(descriptor).isDirectory()) throw new Error('test-only directory fsync failure');
      realFs.fsyncSync(descriptor);
    });
    await expect(ensureActorForUser(USER)).rejects.toThrow('Cannot persist ActivityPub actor custody');
    const committedBytes = storedBytes();
    const publicKey = storedActor().publicKeyPem;
    vi.mocked(fs.fsyncSync).mockImplementation(realFs.fsyncSync);
    expect((await ensureActorForUser(USER)).publicKey.publicKeyPem).toBe(publicKey);
    expect(storedBytes()).toBe(committedBytes);
    expect(fs.renameSync).toHaveBeenCalledTimes(1);
  });

  it.each(['read error', 'missing record', 'corrupt record', 'mismatched key'] as const)
    ('rejects post-commit readback %s instead of reporting activation success', async (failure) => {
      let committed = false;
      vi.mocked(fs.renameSync).mockImplementation((source, target) => {
        realFs.renameSync(source, target);
        committed = true;
      });
      vi.mocked(fs.readFileSync).mockImplementation(((...args: unknown[]) => {
        if (committed && String(args[0]) === actorPath()) {
          if (failure === 'read error') throw Object.assign(new Error('test-only readback failure'), { code: 'EIO' });
          if (failure === 'missing record') throw Object.assign(new Error('test-only missing readback'), { code: 'ENOENT' });
          if (failure === 'corrupt record') return '{invalid JSON';
          return JSON.stringify({ ...storedActor(), publicKeyPem: otherKeyPair.publicKey });
        }
        return Reflect.apply(realFs.readFileSync, realFs, args);
      }) as typeof fs.readFileSync);

      await expect(ensureActorForUser(USER)).rejects.toThrow(/ActivityPub actor custody/);
      const original = storedBytes();
      vi.mocked(fs.readFileSync).mockImplementation(realFs.readFileSync);
      const retried = await ensureActorForUser(USER);
      expect(retried.publicKey.publicKeyPem).toBe(storedActor().publicKeyPem);
      expect(storedBytes()).toBe(original);
      expect(fs.renameSync).toHaveBeenCalledTimes(1);
    });

  it('does not leak raw cleanup errors when temporary-file removal fails', async () => {
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('test-only rename failure'); });
    vi.mocked(fs.unlinkSync).mockImplementationOnce(() => { throw new Error('TEST-ONLY sensitive cleanup detail'); });
    await expect(ensureActorForUser(USER)).rejects.toThrow('Cannot persist ActivityPub actor custody');
    expect(realFs.existsSync(actorPath())).toBe(false);
  });

  it('does not leak raw cleanup errors when closing a failed write throws', async () => {
    vi.mocked(fs.fsyncSync).mockImplementationOnce(() => { throw new Error('test-only file fsync failure'); });
    vi.mocked(fs.closeSync).mockImplementationOnce((descriptor) => {
      realFs.closeSync(descriptor);
      throw new Error('TEST-ONLY sensitive close detail');
    });
    await expect(ensureActorForUser(USER)).rejects.toThrow('Cannot persist ActivityPub actor custody');
    expect(realFs.existsSync(actorPath())).toBe(false);
  });
});
