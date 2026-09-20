




import {
  readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync,
  openSync, closeSync, fsyncSync, renameSync, statSync,
} from 'fs';
import { dirname, join } from 'path';
import crypto from 'crypto';
import type { Actor, ActorImage, ActorPublicKey, ActorPropertyValue } from '../types/actor.js';
import { getUserActorBaseUrl, getActorsDir, getActorUri } from '../config.js';

// --- Private key encryption at rest (AES-256-GCM) ---
const AP_KEY_ALGO = 'aes-256-gcm';
const AP_KEY_IV_LEN = 12;

function getApEncryptionKey(): Buffer | null {
  const keyHex = process.env.ACTIVITYPUB_KEY_ENCRYPTION_KEY
    || process.env.TOTP_ENCRYPTION_KEY
    || process.env.AUTH_SECRET;

  if (!keyHex || keyHex.length < 16) return null;

  // Derive a 32-byte key from whatever string we have
  return crypto.createHash('sha256').update(keyHex).digest();
}

export function encryptPrivateKey(pem: string): string {
  const key = getApEncryptionKey();
  if (!key) {
    // TIN-2648: fail closed. Refuse to persist a private key we cannot encrypt
    // rather than silently storing it in plaintext. A missing (or too-short)
    // key-encryption secret is an operator misconfiguration, not a dev-mode
    // convenience — surface it here instead of leaking key material at rest.
    throw new Error(
      'Cannot encrypt ActivityPub private key: no key-encryption secret is configured. ' +
        'Set ACTIVITYPUB_KEY_ENCRYPTION_KEY (or TOTP_ENCRYPTION_KEY / AUTH_SECRET) ' +
        'to at least 16 characters. Refusing to store the private key in plaintext.'
    );
  }

  const iv = crypto.randomBytes(AP_KEY_IV_LEN);
  const cipher = crypto.createCipheriv(AP_KEY_ALGO, key, iv);
  let encrypted = cipher.update(pem, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${tag}:${encrypted}`;
}

export function decryptPrivateKey(stored: string): string {
  // Plaintext keys don't start with 'enc:'
  if (!stored.startsWith('enc:')) return stored;

  const key = getApEncryptionKey();
  if (!key) throw new Error('Private key is encrypted but no encryption key is configured');

  if (!/^enc:[a-f0-9]{24}:[a-f0-9]{32}:(?:[a-f0-9]{2})+$/i.test(stored)) {
    throw new Error('Invalid ActivityPub private-key envelope');
  }
  try {
    const [, ivHex, tagHex, encHex] = stored.split(':');
    const decipher = crypto.createDecipheriv(AP_KEY_ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(encHex, 'hex', 'utf8') + decipher.final('utf8');
  } catch {
    // Never include the envelope, key material or crypto exception in diagnostics.
    throw new Error('Cannot decrypt ActivityPub private-key custody');
  }
}








export interface ActorUser {
  /** Stable principal identity; required by the self-service activation API. */
  id?: string;
  handle: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActorActivationUser extends ActorUser {
  id: string;
}




export interface ActorProfile {
  bio?: string;
  avatar?: string;
  coverImage?: string;
  website?: string;
  location?: string;
  pronouns?: string;
  email?: string;
  twitter?: string;
  github?: string;
  linkedin?: string;
  mastodon?: string;
  instagram?: string;
  visibility?: string;
}








export interface StoredActor {
  id: string;
  handle: string;
  /** Immutable principal binding. Absent only for legacy/operator-managed actors. */
  ownerId?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  website?: string;
  location?: string;
  pronouns?: string;
  email?: string;
  mastodon?: string;
  twitter?: string;
  github?: string;
  linkedin?: string;
  instagram?: string;
  discoverable: boolean;
  indexable: boolean;
  manuallyApprovesFollowers: boolean;
  publicKeyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  actorType: 'Person' | 'Organization' | 'Service';
  visibility: 'public' | 'unlisted' | 'followers' | 'private';
  createdAt: string;
  updatedAt: string;
}

// This serializes callers in ONE application process only. It is not a lease,
// shared-filesystem lock, or a cross-node writer guarantee.
const actorActivationTails = new Map<string, Promise<void>>();

function validateHandle(handle: string): void {
  if (typeof handle !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(handle)) {
    throw new Error('Invalid ActivityPub actor handle');
  }
}

function validateOwnerId(ownerId: string): void {
  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    throw new Error('ActivityPub actor activation requires a stable owner identity');
  }
}

function assertOwner(actor: StoredActor, expectedOwnerId: string): void {
  validateOwnerId(expectedOwnerId);
  if (!actor.ownerId) {
    throw new Error('Legacy ActivityPub custody has no owner binding; explicit migration is required');
  }
  if (actor.ownerId !== expectedOwnerId) {
    throw new Error('ActivityPub actor custody owner does not match');
  }
}

function verifiedPrivateKey(actor: StoredActor, requireEncrypted = false): string {
  if (typeof actor.privateKeyPem !== 'string' || !actor.privateKeyPem ||
      typeof actor.publicKeyPem !== 'string' || !actor.publicKeyPem) {
    throw new Error('ActivityPub actor key custody is incomplete');
  }
  if (requireEncrypted && !actor.privateKeyPem.startsWith('enc:')) {
    throw new Error('Owner-bound ActivityPub private-key custody must be encrypted');
  }
  const privateKeyPem = decryptPrivateKey(actor.privateKeyPem);
  try {
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const publicKey = crypto.createPublicKey(actor.publicKeyPem);
    if (privateKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyType !== 'rsa') {
      throw new Error('Invalid key type');
    }
    const derived = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    const expected = publicKey.export({ type: 'spki', format: 'der' });
    if (!derived.equals(expected)) throw new Error('Key mismatch');
  } catch {
    throw new Error('ActivityPub actor public/private key verification failed');
  }
  return privateKeyPem;
}

function verifyOwnedCustody(actor: StoredActor, ownerId: string): void {
  assertOwner(actor, ownerId);
  const actorId = getActorUri(actor.handle);
  if (actor.id !== actorId || actor.publicKeyId !== `${actorId}#main-key`) {
    throw new Error('Owner-bound ActivityPub actor origin does not match configured identity');
  }
  verifiedPrivateKey(actor, true);
}

/**
 * Ensure self-service custody for a stable principal, without adopting legacy
 * files or rotating existing keys. The caller owns current-principal/grant/
 * opt-in checks; this operation does not confer publication permission.
 */
export async function ensureActorForUser(
  user: ActorActivationUser,
  profile?: ActorProfile,
): Promise<Actor> {
  validateHandle(user.handle);
  validateOwnerId(user.id);
  const activationUser = { ...user };
  const activationProfile = { ...profile, visibility: profile?.visibility ?? 'private' };
  const lockKey = join(getActorsDir(), `${user.handle}.json`);
  const previous = actorActivationTails.get(lockKey) ?? Promise.resolve();
  const result = previous.then(() => {
    const existing = getStoredActor(activationUser.handle);
    if (existing) {
      verifyOwnedCustody(existing, activationUser.id);
      // A previous attempt may have renamed successfully but failed its final
      // directory flush. Retry durability without replacing the identity/key.
      flushStoredActor(activationUser.handle);
      // No write on retries, including a changed display/profile payload.
      return actorFromStored(existing);
    }
    createActorFromUser(activationUser, activationProfile);
    const persisted = getActorByHandle(activationUser.handle, activationUser.id);
    if (!persisted) throw new Error('ActivityPub actor custody readback verification failed');
    return persisted;
  });
  const tail = result.then(() => undefined, () => undefined);
  actorActivationTails.set(lockKey, tail);
  try {
    return await result;
  } finally {
    if (actorActivationTails.get(lockKey) === tail) actorActivationTails.delete(lockKey);
  }
}





function ensureActorsDir(): void {
  const dir = getActorsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}








export function generateKeyPair(): {
  publicKeyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  const actorId = crypto.randomUUID();
  const publicKeyId = `${getUserActorBaseUrl()}/@${actorId}#main-key`;

  return {
    publicKeyId,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey
  };
}




export function createActorFromUser(user: ActorUser, profile?: ActorProfile): Actor {
  validateHandle(user.handle);
  if (user.id !== undefined) validateOwnerId(user.id);
  const baseUrl = getUserActorBaseUrl();
  const actorId = getActorUri(user.handle);

  
  let keyPair: {
    publicKeyId: string;
    publicKeyPem: string;
    privateKeyPem: string;
  };

  const storedActor = getStoredActor(user.handle);

  if (storedActor) {
    if (storedActor.ownerId !== undefined || user.id !== undefined) {
      // Legacy sync callers cannot accidentally overwrite a bound identity.
      assertOwner(storedActor, user.id ?? '');
      verifyOwnedCustody(storedActor, user.id!);
    }
    keyPair = {
      // TIN-1456: re-anchor persisted (possibly apex-bound) key ids on the
      // configured federation origin; key material itself is reused as-is.
      publicKeyId: `${actorId}#main-key`,
      publicKeyPem: storedActor.publicKeyPem,
      privateKeyPem: verifiedPrivateKey(storedActor)
    };
  } else {
    keyPair = { ...generateKeyPair(), publicKeyId: `${actorId}#main-key` };
  }

  
  const attachments: ActorPropertyValue[] = [];

  if (profile?.website) {
    attachments.push({
      type: 'PropertyValue',
      name: 'Website',
      value: `<a href="${profile.website}" rel="me nofollow noreferrer" target="_blank">${profile.website}</a>`
    });
  }

  if (profile?.twitter) {
    attachments.push({
      type: 'PropertyValue',
      name: 'Twitter',
      value: `<a href="https://twitter.com/${profile.twitter.replace('@', '')}" rel="me nofollow noreferrer" target="_blank">${profile.twitter}</a>`
    });
  }

  if (profile?.github) {
    attachments.push({
      type: 'PropertyValue',
      name: 'GitHub',
      value: `<a href="https://github.com/${profile.github.replace('@', '')}" rel="me nofollow noreferrer" target="_blank">${profile.github}</a>`
    });
  }

  if (profile?.linkedin) {
    attachments.push({
      type: 'PropertyValue',
      name: 'LinkedIn',
      value: `<a href="https://linkedin.com/in/${profile.linkedin}" rel="me nofollow noreferrer" target="_blank">${profile.linkedin}</a>`
    });
  }

  if (profile?.mastodon) {
    attachments.push({
      type: 'PropertyValue',
      name: 'Mastodon',
      value: `<a href="${profile.mastodon}" rel="me nofollow noreferrer" target="_blank">Fediverse</a>`
    });
  }

  
  const icon: ActorImage | undefined = profile?.avatar ? {
    type: 'Image',
    url: `${baseUrl}${profile.avatar}`,
    mediaType: 'image/jpeg'
  } : undefined;

  
  const image: ActorImage | undefined = profile?.coverImage ? {
    type: 'Image',
    url: `${baseUrl}${profile.coverImage}`,
    mediaType: 'image/jpeg'
  } : undefined;

  
  const publicKey: ActorPublicKey = {
    id: keyPair.publicKeyId,
    owner: actorId,
    publicKeyPem: keyPair.publicKeyPem
  };

  
  const actor: Actor = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
      {
        toot: 'http://joinmastodon.org/ns#',
        discoverable: 'toot:discoverable',
        indexable: 'toot:indexable',
        featured: 'toot:featured',
        manuallyApprovesFollowers: 'as:manuallyApprovesFollowers',
        PropertyValue: 'schema:PropertyValue',
        schema: 'http://schema.org/#'
      }
    ],
    id: actorId,
    type: 'Person',
    inbox: `${actorId}/inbox`,
    outbox: `${actorId}/outbox`,
    following: `${actorId}/following`,
    followers: `${actorId}/followers`,
    liked: `${actorId}/liked`,
    featured: `${actorId}/featured`,
    preferredUsername: user.handle,
    name: user.displayName || user.handle,
    summary: profile?.bio || '',
    url: `${baseUrl}/@${user.handle}`,
    icon,
    image,
    discoverable: profile?.visibility !== 'private',
    indexable: profile?.visibility !== 'private',
    manuallyApprovesFollowers: false,
    attachment: attachments.length > 0 ? attachments : undefined,
    publicKey,
    published: user.createdAt,
    updated: user.updatedAt,
    endpoints: {
      sharedInbox: `${baseUrl}/inbox`
    }
  };

  
  storeActor(user.handle, {
    id: actorId,
    handle: user.handle,
    ownerId: user.id,
    displayName: user.displayName || user.handle,
    bio: profile?.bio || '',
    avatarUrl: profile?.avatar,
    bannerUrl: profile?.coverImage,
    website: profile?.website,
    location: profile?.location,
    pronouns: profile?.pronouns,
    email: profile?.email,
    mastodon: profile?.mastodon,
    twitter: profile?.twitter,
    github: profile?.github,
    linkedin: profile?.linkedin,
    instagram: profile?.instagram,
    discoverable: profile?.visibility !== 'private',
    indexable: profile?.visibility !== 'private',
    manuallyApprovesFollowers: false,
    publicKeyId: keyPair.publicKeyId,
    publicKeyPem: keyPair.publicKeyPem,
    privateKeyPem: keyPair.privateKeyPem,
    actorType: 'Person',
    
    visibility: (profile?.visibility as any) || 'public',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  });

  // A returned actor is proof of persisted, decryptable custody, not merely a
  // successful in-memory key generation. Read errors are not treated as absence.
  const persisted = getStoredActor(user.handle);
  if (!persisted || persisted.id !== actorId || persisted.publicKeyId !== keyPair.publicKeyId ||
      persisted.publicKeyPem !== keyPair.publicKeyPem) {
    throw new Error('ActivityPub actor custody readback verification failed');
  }
  if (user.id !== undefined) verifyOwnedCustody(persisted, user.id);
  else verifiedPrivateKey(persisted, true);
  return actor;
}




export function getActorByHandle(handle: string, expectedOwnerId?: string): Actor | null {
  if (expectedOwnerId !== undefined) validateOwnerId(expectedOwnerId);
  const storedActor = getStoredActor(handle);

  if (!storedActor) {
    return null;
  }
  if (expectedOwnerId !== undefined) assertOwner(storedActor, expectedOwnerId);
  // Legacy callers must not silently re-anchor an owner-bound actor after an
  // origin change, or expose corrupted custody just by omitting an owner ID.
  if (storedActor.ownerId !== undefined) verifyOwnedCustody(storedActor, storedActor.ownerId);
  return actorFromStored(storedActor);
}

function actorFromStored(storedActor: StoredActor): Actor {
  const baseUrl = getUserActorBaseUrl();

  // TIN-1456: never trust the persisted actor id as an AP authority. Actors
  // minted before the hub cutover carry apex (tinyland.dev) ids on disk;
  // re-anchor id, key id, and every derived collection URI on the configured
  // federation origin at read time.
  const actorId = getActorUri(storedActor.handle);
  const publicKeyId = `${actorId}#main-key`;

  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
      {
        toot: 'http://joinmastodon.org/ns#',
        discoverable: 'toot:discoverable',
        indexable: 'toot:indexable',
        featured: 'toot:featured'
      }
    ],
    id: actorId,
    type: storedActor.actorType,
    inbox: `${actorId}/inbox`,
    outbox: `${actorId}/outbox`,
    following: `${actorId}/following`,
    followers: `${actorId}/followers`,
    liked: `${actorId}/liked`,
    featured: `${actorId}/featured`,
    preferredUsername: storedActor.handle,
    name: storedActor.displayName || storedActor.handle,
    summary: storedActor.bio || '',
    url: actorId,
    icon: storedActor.avatarUrl ? {
      type: 'Image',
      url: `${baseUrl}${storedActor.avatarUrl}`
    } : undefined,
    image: storedActor.bannerUrl ? {
      type: 'Image',
      url: `${baseUrl}${storedActor.bannerUrl}`
    } : undefined,
    discoverable: storedActor.discoverable,
    indexable: storedActor.indexable,
    manuallyApprovesFollowers: storedActor.manuallyApprovesFollowers,
    publicKey: {
      id: publicKeyId,
      owner: actorId,
      publicKeyPem: storedActor.publicKeyPem
    },
    published: storedActor.createdAt,
    updated: storedActor.updatedAt,
    endpoints: {
      sharedInbox: `${baseUrl}/inbox`
    }
  };
}




function getStoredActor(handle: string): StoredActor | null {
  validateHandle(handle);
  const filePath = join(getActorsDir(), `${handle}.json`);

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Cannot read ActivityPub actor custody');
  }
  try {
    const actor = JSON.parse(content) as StoredActor;
    if (!actor || typeof actor !== 'object' || actor.handle !== handle ||
        (actor.ownerId !== undefined && (typeof actor.ownerId !== 'string' || !actor.ownerId.trim()))) {
      throw new Error('Invalid actor record');
    }
    return actor;
  } catch {
    throw new Error('Invalid ActivityPub actor custody record');
  }
}




function storeActor(handle: string, actor: StoredActor): void {
  validateHandle(handle);
  // Normalize a legacy plaintext or encrypted input exactly once, and validate
  // before touching the previous record. No ciphertext may be encrypted again.
  const privateKeyPem = verifiedPrivateKey(actor);
  const toStore = { ...actor, privateKeyPem: encryptPrivateKey(privateKeyPem) };
  const directory = getActorsDir();
  const filePath = join(directory, `${handle}.json`);
  const temporaryPath = join(directory, `.${handle}.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  let failed = false;
  try {
    ensureActorsDir();
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, JSON.stringify(toStore, null, 2), 'utf-8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, filePath);
    flushDirectoryChain(directory);
  } catch {
    failed = true;
  } finally {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } catch {
      failed = true;
    }
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('Cannot persist ActivityPub actor custody');
}

/** Flush parent entries too when initializing a custody directory. The mounted
 * filesystem is the durability boundary; this is not a shared-storage lease.
 */
function flushDirectoryChain(directory: string): void {
  const device = statSync(directory).dev;
  let current = directory;
  let descriptor: number | undefined;
  try {
    while (true) {
      descriptor = openSync(current, 'r');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      const parent = dirname(current);
      if (parent === current || statSync(parent).dev !== device) break;
      current = parent;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function flushStoredActor(handle: string): void {
  let descriptor: number | undefined;
  let failed = false;
  try {
    descriptor = openSync(join(getActorsDir(), `${handle}.json`), 'r');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    flushDirectoryChain(getActorsDir());
  } catch {
    failed = true;
  } finally {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('Cannot persist ActivityPub actor custody');
}




export function getActorPrivateKey(handle: string, expectedOwnerId?: string): string | null {
  if (expectedOwnerId !== undefined) validateOwnerId(expectedOwnerId);
  const storedActor = getStoredActor(handle);
  if (storedActor && expectedOwnerId !== undefined) assertOwner(storedActor, expectedOwnerId);
  if (storedActor?.ownerId !== undefined) verifyOwnedCustody(storedActor, storedActor.ownerId);
  if (!storedActor?.privateKeyPem) return null;
  return decryptPrivateKey(storedActor.privateKeyPem);
}




export function deleteActor(handle: string, expectedOwnerId?: string): void {
  if (expectedOwnerId !== undefined) validateOwnerId(expectedOwnerId);
  const actor = getStoredActor(handle);
  if (!actor) {
    // Finish an earlier unlink whose directory flush may have failed.
    try {
      if (existsSync(getActorsDir())) flushDirectoryChain(getActorsDir());
    } catch {
      throw new Error('Cannot delete ActivityPub actor custody');
    }
    return;
  }
  if (actor.ownerId !== undefined || expectedOwnerId !== undefined) {
    assertOwner(actor, expectedOwnerId ?? '');
  }
  const filePath = join(getActorsDir(), `${handle}.json`);
  try {
    unlinkSync(filePath);
    flushDirectoryChain(getActorsDir());
  } catch {
    throw new Error('Cannot delete ActivityPub actor custody');
  }
}
