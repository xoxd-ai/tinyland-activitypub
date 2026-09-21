




import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import type { Actor, ActorImage, ActorPublicKey, ActorPropertyValue } from '../types/actor.js';
import { getSiteBaseUrl, getActorsDir, getLiveUserActorBaseUrl } from '../config.js';

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

  const [, ivHex, tagHex, encHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(AP_KEY_ALGO, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}








export interface ActorUser {
  handle: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
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
  const publicKeyId = `${getSiteBaseUrl()}/@${actorId}#main-key`;

  return {
    publicKeyId,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey
  };
}




export function createActorFromUser(user: ActorUser, profile?: ActorProfile): Actor {
  const baseUrl = getSiteBaseUrl();
  const actorId = `${baseUrl}/@${user.handle}`;

  
  let keyPair: {
    publicKeyId: string;
    publicKeyPem: string;
    privateKeyPem: string;
  };

  const storedActor = getStoredActor(user.handle);

  if (storedActor) {
    keyPair = {
      // TIN-1456: re-anchor persisted (possibly apex-bound) key ids on the
      // configured federation origin; key material itself is reused as-is.
      publicKeyId: `${actorId}#main-key`,
      publicKeyPem: storedActor.publicKeyPem,
      privateKeyPem: storedActor.privateKeyPem
    };
  } else {
    keyPair = generateKeyPair();
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

  return actor;
}




export function getActorByHandle(
  handle: string,
  options?: { useLiveUserActorBaseUrl?: boolean }
): Actor | null {
  const storedActor = getStoredActor(handle);

  if (!storedActor) {
    return null;
  }

  // TIN-2111 (ratified 2026-09-20): the live user actor is a second,
  // deliberately separate public identity from the broker-projection actor
  // and anchors on liveUserActorBaseUrl (see config.ts) rather than
  // siteBaseUrl. This is opt-in per call, off by default, so the broker
  // path -- every existing caller: content publishing, generic WebFinger,
  // the outbox/following/featured/liked collection routes -- is
  // byte-for-byte unchanged when this option is omitted.
  const baseUrl = options?.useLiveUserActorBaseUrl
    ? getLiveUserActorBaseUrl()
    : getSiteBaseUrl();

  // TIN-1456: never trust the persisted actor id as an AP authority. Actors
  // minted before the hub cutover carry apex (tinyland.dev) ids on disk;
  // re-anchor id, key id, and every derived collection URI on the configured
  // federation origin (siteBaseUrl, or liveUserActorBaseUrl above) at read
  // time.
  const actorId = `${baseUrl}/@${storedActor.handle}`;
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
  ensureActorsDir();
  const filePath = join(getActorsDir(), `${handle}.json`);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as StoredActor;
  } catch (err) {
    console.error(`Failed to load actor ${handle}:`, err);
    return null;
  }
}




function storeActor(handle: string, actor: StoredActor): void {
  ensureActorsDir();
  const filePath = join(getActorsDir(), `${handle}.json`);

  try {
    // Encrypt private key before writing to disk
    const toStore = { ...actor };
    if (toStore.privateKeyPem) {
      toStore.privateKeyPem = encryptPrivateKey(toStore.privateKeyPem);
    }
    writeFileSync(filePath, JSON.stringify(toStore, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Failed to store actor ${handle}:`, err);
  }
}




export function getActorPrivateKey(handle: string): string | null {
  const storedActor = getStoredActor(handle);
  if (!storedActor?.privateKeyPem) return null;
  return decryptPrivateKey(storedActor.privateKeyPem);
}




export function deleteActor(handle: string): void {
  ensureActorsDir();
  const filePath = join(getActorsDir(), `${handle}.json`);

  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
    } catch (err) {
      console.error(`Failed to delete actor ${handle}:`, err);
    }
  }
}
