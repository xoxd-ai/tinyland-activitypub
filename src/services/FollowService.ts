




import crypto from 'crypto';
import { getActorUri, getActivityPubConfig } from '../config.js';
import { queueForDelivery } from './ActivityDeliveryService.js';
import { addFollowing, removeFollowing, getFollowing } from './FollowersService.js';
import type { Follow, Undo } from '../types/activitystreams.js';
import type { Following } from './FollowersService.js';
import { publicFederationFetch } from '../utils/publicFederationFetch.js';





export interface RemoteActor {
  id: string;
  preferredUsername: string;
  name?: string;
  icon?: { url: string };
  inbox: string;
  type: string;
}

export interface FollowStatus {
  following: boolean;
  status: 'pending' | 'accepted' | null;
}











export async function followActor(
  localHandle: string,
  remoteActorUri: string
): Promise<{ activityId: string; status: 'pending' | 'accepted' }> {
  
  const remoteActor = await fetchRemoteActor(remoteActorUri);

  if (!remoteActor) {
    throw new Error(`Could not fetch remote actor: ${remoteActorUri}`);
  }

  
  const activityId = `${getActorUri(localHandle)}/activities/${crypto.randomUUID()}`;
  const followActivity: Follow = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityId,
    type: 'Follow',
    actor: getActorUri(localHandle),
    object: remoteActorUri,
    published: new Date().toISOString()
  };

  
  const following: Following = {
    actorUri: remoteActorUri,
    handle: remoteActor.preferredUsername,
    domain: new URL(remoteActorUri).hostname,
    displayName: remoteActor.name,
    avatarUrl: remoteActor.icon?.url,
    followingSince: new Date().toISOString(),
    status: 'pending'
  };

  addFollowing(localHandle, following);

  
  await queueForDelivery(followActivity, [remoteActor.inbox], localHandle);

  return {
    activityId,
    status: 'pending'
  };
}






export async function unfollowActor(
  localHandle: string,
  remoteActorUri: string
): Promise<void> {
  
  const followingList = getFollowing(localHandle);
  const existing = followingList.find(f => f.actorUri === remoteActorUri);

  if (!existing) {
    throw new Error(`Not following actor: ${remoteActorUri}`);
  }

  
  const remoteActor = await fetchRemoteActor(remoteActorUri);

  if (!remoteActor) {
    
    removeFollowing(localHandle, remoteActorUri);
    return;
  }

  
  const originalFollowId = `${getActorUri(localHandle)}/activities/${crypto.randomUUID()}`;
  const undoActivityId = `${getActorUri(localHandle)}/activities/${crypto.randomUUID()}`;

  const undoActivity: Undo = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: undoActivityId,
    type: 'Undo',
    actor: getActorUri(localHandle),
    object: {
      id: originalFollowId,
      type: 'Follow',
      actor: getActorUri(localHandle),
      object: remoteActorUri
    },
    published: new Date().toISOString()
  };

  
  removeFollowing(localHandle, remoteActorUri);

  
  await queueForDelivery(undoActivity, [remoteActor.inbox], localHandle);
}







export function isFollowingActor(localHandle: string, remoteActorUri: string): FollowStatus {
  const followingList = getFollowing(localHandle);
  const existing = followingList.find(f => f.actorUri === remoteActorUri);

  if (!existing) {
    return {
      following: false,
      status: null
    };
  }

  return {
    following: true,
    status: existing.status
  };
}








export function acceptFollow(localHandle: string, remoteActorUri: string): boolean {
  const followingList = getFollowing(localHandle);
  const existing = followingList.find(f => f.actorUri === remoteActorUri);

  if (!existing) {
    console.warn(`[FollowService] Cannot accept follow - not in following list: ${remoteActorUri}`);
    return false;
  }

  if (existing.status === 'accepted') {
    console.log(`[FollowService] Follow already accepted: ${remoteActorUri}`);
    return true;
  }

  
  existing.status = 'accepted';
  addFollowing(localHandle, existing);
  console.log(`[FollowService] Follow accepted: ${remoteActorUri}`);
  return true;
}








export function rejectFollow(localHandle: string, remoteActorUri: string): boolean {
  const followingList = getFollowing(localHandle);
  const existing = followingList.find(f => f.actorUri === remoteActorUri);

  if (!existing) {
    console.warn(`[FollowService] Cannot reject follow - not in following list: ${remoteActorUri}`);
    return false;
  }

  
  removeFollowing(localHandle, remoteActorUri);
  console.log(`[FollowService] Follow rejected and removed: ${remoteActorUri}`);
  return true;
}










export async function fetchRemoteActor(actorUri: string): Promise<RemoteActor | null> {
  const config = getActivityPubConfig();

  try {
    const response = await publicFederationFetch(actorUri, {
      headers: {
        'Accept': 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
      },
      signal: AbortSignal.timeout(config.federationTimeout)
    });

    if (!response.ok) {
      console.error(`[FollowService] Failed to fetch actor ${actorUri}: HTTP ${response.status}`);
      return null;
    }

    const actor = await response.json();

    
    if (!actor.id || !actor.inbox || !actor.preferredUsername) {
      console.error('[FollowService] Invalid remote actor document');
      return null;
    }

    return {
      id: actor.id,
      preferredUsername: actor.preferredUsername,
      name: actor.name,
      icon: actor.icon,
      inbox: actor.inbox,
      type: actor.type
    };
  } catch {
    console.error('[FollowService] Failed to fetch or validate remote actor');
    return null;
  }
}






export function getFollowedActors(localHandle: string): Following[] {
  return getFollowing(localHandle);
}







export { getFollowingCount } from './FollowersService.js';
