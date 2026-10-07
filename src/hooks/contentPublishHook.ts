




import crypto from 'crypto';
import { queueForDelivery } from '../services/ActivityDeliveryService.js';
import { getActorByHandle } from '../services/ActorService.js';
import { createObject } from '../services/ContentObjectService.js';
import { getFollowerUris } from '../services/FollowersService.js';
import {
  getFollowersUri,
  isLocalUri,
  gatedAudience
} from '../config.js';
import {
  parseMentions,
  extractActorUrisFromMentions,
  type ParsedMention
} from '../utils/mentions.js';
import type { Activity, Tombstone } from '../types/activitystreams.js';
import type {
  BlogPost,
  ContentNote,
  Product,
  ContentEvent,
  ContentImage,
  ContentVideo,
  ContentDocument
} from '../types/content.js';













export type FederatedVisibility = 'public' | 'unlisted' | 'followers' | 'private' | 'direct';




export interface PublishOptions {
  
  visibility: FederatedVisibility;
  
  mentionedActors?: string[];
  
  inReplyTo?: string;
  
  sensitive?: boolean;
  
  contentWarning?: string;
}




export type PublishableContent =
  | BlogPost
  | ContentNote
  | Product
  | ContentEvent
  | ContentImage
  | ContentVideo
  | ContentDocument;




export interface PublishResult {
  
  success: boolean;
  
  deliveryId?: string;
  
  activityId?: string;
  
  error?: string;
}








export async function publishToFediverse(
  content: PublishableContent,
  authorHandle: string,
  options: PublishOptions = { visibility: 'public' }
): Promise<PublishResult> {
  try {
    const actor = getActorByHandle(authorHandle);
    if (!actor) {
      return {
        success: false,
        error: `Actor not found for handle: ${authorHandle}`
      };
    }

    const actorUri = actor.id;
    const followersUri = getFollowersUri(authorHandle);

    const mentions = parseMentions(content.content);

    const { to, cc } = buildAddressing(
      options.visibility,
      actorUri,
      followersUri,
      mentions,
      options.mentionedActors
    );

    const apObject = await createObject(content, authorHandle);
    if (!apObject) {
      return {
        success: false,
        error: `Failed to convert content to ActivityPub object: ${content.slug}`
      };
    }

    apObject.to = to;
    apObject.cc = cc;

    if (options.sensitive) {
      
      (apObject as any).sensitive = true;
    }
    if (options.contentWarning) {
      apObject.summary = options.contentWarning;
    }

    if (options.inReplyTo) {
      apObject.inReplyTo = options.inReplyTo;
    }

    const activityId = `${actorUri}/activities/${crypto.randomUUID()}`;
    const activity: Activity = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1'
      ],
      id: activityId,
      type: 'Create',
      actor: actorUri,
      published: new Date().toISOString(),
      to,
      cc,
      object: apObject
    };

    const deliveryTargets = await getDeliveryTargets(
      authorHandle,
      options.visibility,
      mentions,
      options.mentionedActors
    );

    if (deliveryTargets.length === 0) {
      console.log(`[ContentPublishHook] No delivery targets for ${content.slug}`);
      return {
        success: true,
        activityId,
        deliveryId: undefined
      };
    }

    const deliveryId = await queueForDelivery(
      activity,
      deliveryTargets,
      authorHandle
    );

    console.log(`[ContentPublishHook] Published ${content.type}/${content.slug} to fediverse (${deliveryTargets.length} targets)`);

    return {
      success: true,
      deliveryId,
      activityId
    };
  } catch (error) {
    console.error('[ContentPublishHook] Failed to publish to fediverse:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}








export async function updateOnFediverse(
  content: PublishableContent,
  authorHandle: string
): Promise<PublishResult> {
  try {
    const actor = getActorByHandle(authorHandle);
    if (!actor) {
      return {
        success: false,
        error: `Actor not found for handle: ${authorHandle}`
      };
    }

    const actorUri = actor.id;
    const followersUri = getFollowersUri(authorHandle);

    const mentions = parseMentions(content.content);

    const visibility = content.visibility as FederatedVisibility;
    const { to, cc } = buildAddressing(
      visibility,
      actorUri,
      followersUri,
      mentions
    );

    const apObject = await createObject(content, authorHandle);
    if (!apObject) {
      return {
        success: false,
        error: `Failed to convert content to ActivityPub object: ${content.slug}`
      };
    }

    apObject.to = to;
    apObject.cc = cc;
    apObject.updated = new Date().toISOString();

    const activityId = `${actorUri}/activities/${crypto.randomUUID()}`;
    const activity: Activity = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1'
      ],
      id: activityId,
      type: 'Update',
      actor: actorUri,
      published: new Date().toISOString(),
      to,
      cc,
      object: apObject
    };

    const deliveryTargets = await getDeliveryTargets(
      authorHandle,
      visibility,
      mentions
    );

    if (deliveryTargets.length === 0) {
      return {
        success: true,
        activityId,
        deliveryId: undefined
      };
    }

    const deliveryId = await queueForDelivery(
      activity,
      deliveryTargets,
      authorHandle
    );

    console.log(`[ContentPublishHook] Updated ${content.type}/${content.slug} on fediverse`);

    return {
      success: true,
      deliveryId,
      activityId
    };
  } catch (error) {
    console.error('[ContentPublishHook] Failed to update on fediverse:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}








export async function deleteFromFediverse(
  contentId: string,
  contentType: string,
  authorHandle: string
): Promise<PublishResult> {
  try {
    const actor = getActorByHandle(authorHandle);
    if (!actor) {
      return {
        success: false,
        error: `Actor not found for handle: ${authorHandle}`
      };
    }

    const actorUri = actor.id;
    const followersUri = getFollowersUri(authorHandle);

    // TIN-1456: as#Public is gated — controlled audience only (see gatedAudience).
    const { to, cc } = gatedAudience(followersUri, 'public');

    const tombstone: Tombstone = {
      id: contentId,
      type: 'Tombstone',
      formerType: contentType,
      deleted: new Date().toISOString()
    };

    const activityId = `${actorUri}/activities/${crypto.randomUUID()}`;
    const activity: Activity = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1'
      ],
      id: activityId,
      type: 'Delete',
      actor: actorUri,
      published: new Date().toISOString(),
      to,
      cc,
      object: tombstone
    };

    const followerUris = getFollowerUris(authorHandle, 'accepted');

    if (followerUris.length === 0) {
      return {
        success: true,
        activityId,
        deliveryId: undefined
      };
    }

    const deliveryId = await queueForDelivery(
      activity,
      followerUris,
      authorHandle
    );

    console.log(`[ContentPublishHook] Deleted ${contentId} from fediverse`);

    return {
      success: true,
      deliveryId,
      activityId
    };
  } catch (error) {
    console.error('[ContentPublishHook] Failed to delete from fediverse:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}








export async function announceContent(
  contentUrl: string,
  announcerHandle: string
): Promise<PublishResult> {
  try {
    const actor = getActorByHandle(announcerHandle);
    if (!actor) {
      return {
        success: false,
        error: `Actor not found for handle: ${announcerHandle}`
      };
    }

    const actorUri = actor.id;
    const followersUri = getFollowersUri(announcerHandle);

    // TIN-1456: as#Public is gated — controlled audience only (see gatedAudience).
    const { to, cc } = gatedAudience(followersUri, 'public');

    const activityId = `${actorUri}/activities/${crypto.randomUUID()}`;
    const activity: Activity = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1'
      ],
      id: activityId,
      type: 'Announce',
      actor: actorUri,
      published: new Date().toISOString(),
      to,
      cc,
      object: contentUrl
    };

    const followerUris = getFollowerUris(announcerHandle, 'accepted');
    const deliveryTargets = [...followerUris];

    try {
      const contentUri = new URL(contentUrl);
      if (!isLocalUri(contentUrl)) {
        const authorMatch = contentUri.pathname.match(/^\/@([^/]+)/);
        if (authorMatch) {
          const authorUri = `https://${contentUri.hostname}/@${authorMatch[1]}`;
          if (!deliveryTargets.includes(authorUri)) {
            deliveryTargets.push(authorUri);
          }
        }
      }
    } catch {
      
    }

    if (deliveryTargets.length === 0) {
      return {
        success: true,
        activityId,
        deliveryId: undefined
      };
    }

    const deliveryId = await queueForDelivery(
      activity,
      deliveryTargets,
      announcerHandle
    );

    console.log(`[ContentPublishHook] Announced ${contentUrl} to fediverse`);

    return {
      success: true,
      deliveryId,
      activityId
    };
  } catch (error) {
    console.error('[ContentPublishHook] Failed to announce content:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}








function buildAddressing(
  visibility: FederatedVisibility,
  actorUri: string,
  followersUri: string,
  mentions: ParsedMention[],
  additionalMentions?: string[]
): { to: string[]; cc: string[] } {
  const to: string[] = [];
  const cc: string[] = [];

  const mentionedActorUris = extractActorUrisFromMentions(mentions);

  if (additionalMentions) {
    for (const mention of additionalMentions) {
      if (!mentionedActorUris.includes(mention)) {
        mentionedActorUris.push(mention);
      }
    }
  }

  switch (visibility) {
    case 'public':
      // TIN-1456: as#Public is gated — downgrade to the followers collection.
      to.push(followersUri);
      cc.push(...mentionedActorUris);
      break;

    case 'unlisted':
      // TIN-1456: as#Public is gated — followers collection only.
      to.push(followersUri);
      cc.push(...mentionedActorUris);
      break;

    case 'followers':
      to.push(followersUri);
      cc.push(...mentionedActorUris);
      break;

    case 'private':
      to.push(actorUri);
      break;

    case 'direct':
      to.push(...mentionedActorUris);
      break;
  }

  return {
    to: [...new Set(to)].filter(Boolean),
    cc: [...new Set(cc)].filter(Boolean)
  };
}




async function getDeliveryTargets(
  authorHandle: string,
  visibility: FederatedVisibility,
  mentions: ParsedMention[],
  additionalMentions?: string[]
): Promise<string[]> {
  const targets: string[] = [];

  const mentionedActorUris = mentions
    .filter(m => !m.local)
    .map(m => m.href);

  if (additionalMentions) {
    for (const mention of additionalMentions) {
      if (!mentionedActorUris.includes(mention)) {
        mentionedActorUris.push(mention);
      }
    }
  }

  switch (visibility) {
    case 'public':
    case 'unlisted':
    case 'followers': {
      const followerUris = getFollowerUris(authorHandle, 'accepted');
      targets.push(...followerUris);

      if (visibility !== 'followers') {
        targets.push(...mentionedActorUris);
      }
      break;
    }

    case 'private':
      break;

    case 'direct':
      targets.push(...mentionedActorUris);
      break;
  }

  return [...new Set(targets)].filter(uri => {
    try {
      new URL(uri);
      return !isLocalUri(uri);
    } catch {
      return false;
    }
  });
}
