













import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import type { Group } from '../types/activitystreams.js';
import { getSiteBaseUrl, getActivityPubDir, getActorUri } from '../config.js';
import { encryptPrivateKey, decryptPrivateKey } from './ActorService.js';





function getGroupsDir(): string {
  return join(getActivityPubDir(), 'groups');
}

function ensureGroupsDir(): void {
  const dir = getGroupsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}








export interface StoredGroup {
  id: string;
  handle: string;
  displayName: string;
  summary: string;
  iconUrl?: string;
  imageUrl?: string;
  visibility: 'public' | 'unlisted' | 'private';
  postingRestrictedToMods: boolean;
  nsfw: boolean;
  publicKeyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAt: string;
  updatedAt: string;
  
  moderators: string[]; 
  categories: string[];
  language?: string;
}




export interface CreateGroupInput {
  handle: string;
  displayName: string;
  summary: string;
  iconUrl?: string;
  imageUrl?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  postingRestrictedToMods?: boolean;
  nsfw?: boolean;
  categories?: string[];
  language?: string;
  moderatorHandles?: string[];
}








function generateGroupKeyPair(handle: string): {
  publicKeyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
} {
  const baseUrl = getSiteBaseUrl();
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

  const groupUri = `${baseUrl}/c/${handle}`;
  const publicKeyId = `${groupUri}#main-key`;

  return {
    publicKeyId,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey
  };
}








export function createGroup(input: CreateGroupInput): StoredGroup {
  const baseUrl = getSiteBaseUrl();
  const groupUri = `${baseUrl}/c/${input.handle}`;

  
  const existing = getStoredGroup(input.handle);
  if (existing) {
    throw new Error(`Group ${input.handle} already exists`);
  }

  
  const keyPair = generateGroupKeyPair(input.handle);

  
  const moderators = (input.moderatorHandles || []).map(
    (handle) => getActorUri(handle)
  );

  const now = new Date().toISOString();

  const group: StoredGroup = {
    id: groupUri,
    handle: input.handle,
    displayName: input.displayName,
    summary: input.summary,
    iconUrl: input.iconUrl,
    imageUrl: input.imageUrl,
    visibility: input.visibility || 'public',
    postingRestrictedToMods: input.postingRestrictedToMods || false,
    nsfw: input.nsfw || false,
    publicKeyId: keyPair.publicKeyId,
    publicKeyPem: keyPair.publicKeyPem,
    privateKeyPem: keyPair.privateKeyPem,
    createdAt: now,
    updatedAt: now,
    moderators,
    categories: input.categories || [],
    language: input.language
  };

  
  storeGroup(input.handle, group);

  return group;
}




export function getGroupByHandle(handle: string): Group | null {
  const stored = getStoredGroup(handle);

  if (!stored) {
    return null;
  }

  return storedGroupToActivityPub(stored);
}




export function listGroups(): StoredGroup[] {
  ensureGroupsDir();
  const groupsDir = getGroupsDir();

  try {
    const files = readdirSync(groupsDir).filter((f) => f.endsWith('.json'));
    const groups: StoredGroup[] = [];

    for (const file of files) {
      const filePath = join(groupsDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const group = JSON.parse(content) as StoredGroup;

      
      if (group.visibility === 'public') {
        groups.push(group);
      }
    }

    return groups;
  } catch (error) {
    console.error('[GroupActor] Failed to list groups:', error);
    return [];
  }
}




export function updateGroup(
  handle: string,
  updates: Partial<CreateGroupInput>
): StoredGroup | null {
  const existing = getStoredGroup(handle);

  if (!existing) {
    return null;
  }

  const updated: StoredGroup = {
    ...existing,
    displayName: updates.displayName ?? existing.displayName,
    summary: updates.summary ?? existing.summary,
    iconUrl: updates.iconUrl ?? existing.iconUrl,
    imageUrl: updates.imageUrl ?? existing.imageUrl,
    visibility: updates.visibility ?? existing.visibility,
    postingRestrictedToMods:
      updates.postingRestrictedToMods ?? existing.postingRestrictedToMods,
    nsfw: updates.nsfw ?? existing.nsfw,
    categories: updates.categories ?? existing.categories,
    language: updates.language ?? existing.language,
    updatedAt: new Date().toISOString()
  };

  if (updates.moderatorHandles) {
    updated.moderators = updates.moderatorHandles.map(
      (h) => getActorUri(h)
    );
  }

  storeGroup(handle, updated);

  return updated;
}




export function deleteGroup(handle: string): boolean {
  ensureGroupsDir();
  const filePath = join(getGroupsDir(), `${handle}.json`);

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error(`[GroupActor] Failed to delete group ${handle}:`, error);
    return false;
  }
}








function getStoredGroup(handle: string): StoredGroup | null {
  ensureGroupsDir();
  const filePath = join(getGroupsDir(), `${handle}.json`);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as StoredGroup;
  } catch (error) {
    console.error(`[GroupActor] Failed to load group ${handle}:`, error);
    return null;
  }
}




function storeGroup(handle: string, group: StoredGroup): void {
  ensureGroupsDir();
  const filePath = join(getGroupsDir(), `${handle}.json`);

  try {
    const toStore = { ...group };
    if (toStore.privateKeyPem) {
      toStore.privateKeyPem = encryptPrivateKey(toStore.privateKeyPem);
    }
    writeFileSync(filePath, JSON.stringify(toStore, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[GroupActor] Failed to store group ${handle}:`, error);
  }
}








export function storedGroupToActivityPub(stored: StoredGroup): Group {
  const baseUrl = getSiteBaseUrl();
  const groupUri = stored.id;

  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
      {
        
        lemmy: 'https://join-lemmy.org/ns#',
        postingRestrictedToMods: 'lemmy:postingRestrictedToMods',
        moderators: 'lemmy:moderators',
        sensitive: 'as:sensitive',
        
        toot: 'http://joinmastodon.org/ns#',
        discoverable: 'toot:discoverable',
        indexable: 'toot:indexable'
      }
    ],
    id: groupUri,
    type: 'Group',
    preferredUsername: stored.handle,
    name: stored.displayName,
    summary: stored.summary,
    inbox: `${groupUri}/inbox`,
    outbox: `${groupUri}/outbox`,
    followers: `${groupUri}/followers`,
    
    attributedTo: stored.moderators, 
    icon: stored.iconUrl
      ? {
          type: 'Image',
          url: stored.iconUrl.startsWith('http')
            ? stored.iconUrl
            : `${baseUrl}${stored.iconUrl}`
        }
      : undefined,
    image: stored.imageUrl
      ? {
          type: 'Image',
          url: stored.imageUrl.startsWith('http')
            ? stored.imageUrl
            : `${baseUrl}${stored.imageUrl}`
        }
      : undefined,
    
    discoverable: stored.visibility === 'public',
    indexable: stored.visibility === 'public',
    
    postingRestrictedToMods: stored.postingRestrictedToMods,
    moderators: stored.moderators,
    sensitive: stored.nsfw,
    
    publicKey: {
      id: stored.publicKeyId,
      owner: groupUri,
      publicKeyPem: stored.publicKeyPem
    },
    
    published: stored.createdAt,
    updated: stored.updatedAt,
    
    endpoints: {
      sharedInbox: `${baseUrl}/inbox`
    }
  } as Group;
}




export function getGroupPrivateKey(handle: string): string | null {
  const stored = getStoredGroup(handle);
  if (!stored?.privateKeyPem) return null;
  return decryptPrivateKey(stored.privateKeyPem);
}
