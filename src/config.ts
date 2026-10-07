





import { join } from 'path';





export interface ActivityPubConfig {
  siteBaseUrl: string;
  /** Personal actor authority; omitted values preserve the siteBaseUrl origin. */
  userActorBaseUrl?: string;
  /** Released 0.3.2 per-read legacy actor view; does not change URI helpers. */
  liveUserActorBaseUrl?: string;
  federationEnabled: boolean;
  defaultVisibility: 'public' | 'unlisted' | 'followers' | 'private';
  autoApproveFollows: boolean;
  maxDeliveryRetries: number;
  federationTimeout: number;
  signatureVerificationEnabled: boolean;
  actorKeyCacheTtl: number;
  maxContentLength: number;
  maxTags: number;
  maxMentions: number;
  maxAttachments: number;
  maxUploadSize: number;
  defaultPageSize: number;
  maxPageSize: number;
  activitypubDir: string;
  contentDir: string;
  
  softwareVersion?: string;

  resolveUser?: (handle: string) => Promise<{
    handle: string;
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
  } | null>;

  // TIN-1952 / GAP#6 B3: optional injected counter for NodeInfo localPosts.
  // The package must not assume a content layout (the legacy NodeInfoService scan
  // of src/content/blog never existed under the user-content model and always
  // returned 0). When provided, the host app supplies the public post count from
  // its own content loader; when absent, NodeInfo falls back to the legacy scan.
  resolvePublicPostCount?: () => number;
}





const defaults: ActivityPubConfig = {
  // TIN-1456: preserve the hub as the default broker/brand authority. Personal
  // actors may explicitly use userActorBaseUrl without moving brand identities.
  // Ignore PUBLIC_SITE_URL / SITE_URL, which historically pointed at the apex.
  siteBaseUrl:
    process.env.TINYLAND_FEDERATION_ORIGIN || 'https://hub.tinyland.dev',
  federationEnabled: true,
  defaultVisibility: 'public',
  autoApproveFollows: false,
  maxDeliveryRetries: 3,
  federationTimeout: 10000,
  signatureVerificationEnabled: true,
  actorKeyCacheTtl: 3600,
  maxContentLength: 500000,
  maxTags: 50,
  maxMentions: 50,
  maxAttachments: 10,
  maxUploadSize: 10485760, 
  defaultPageSize: 20,
  maxPageSize: 100,
  activitypubDir: '.activitypub',
  contentDir: 'content',
};





let _config: ActivityPubConfig | null = null;

// TIN-1456: unconfigured-visibility canary. TIN-1952 B1 originally kept the
// package default on the apex so a missing configureActivityPub() call would
// fail visibly — but that canary's failure mode was the leak itself (apex ids
// delivered to remote instances are cached irreversibly). The default is now
// fail-safe (hub origin, never the apex), and visibility is preserved by
// warning once when the config is read without configureActivityPub() ever
// having been called.
let _warnedUnconfigured = false;




export function configureActivityPub(config: Partial<ActivityPubConfig>): void {
  _config = { ...defaults, ...config };
}




export function getActivityPubConfig(): ActivityPubConfig {
  if (!_config) {
    if (!_warnedUnconfigured) {
      _warnedUnconfigured = true;
      console.warn(
        `tinyland-activitypub: configureActivityPub() was never called; defaulting siteBaseUrl to the hub origin (${defaults.siteBaseUrl})`
      );
    }
    _config = { ...defaults };
  }
  return _config;
}




export function resetActivityPubConfig(): void {
  _config = null;
  _warnedUnconfigured = false;
}








export function getSiteBaseUrl(): string {
  return getActivityPubConfig().siteBaseUrl.replace(/\/$/, '');
}

/** Released 0.3.2 view override, deliberately independent of userActorBaseUrl. */
export function getLiveUserActorBaseUrl(): string {
  const config = getActivityPubConfig();
  return (config.liveUserActorBaseUrl ?? config.siteBaseUrl).replace(/\/$/, '');
}

/** Keep personal actor routing independent of the broker/brand origin. */
export function getUserActorBaseUrl(): string {
  return (getActivityPubConfig().userActorBaseUrl ?? getSiteBaseUrl()).replace(/\/$/, '');
}

export function getUserActorDomain(): string {
  try {
    return new URL(getUserActorBaseUrl()).hostname;
  } catch {
    return getInstanceDomain();
  }
}




export function getInstanceDomain(): string {
  const config = getActivityPubConfig();
  try {
    return new URL(config.siteBaseUrl).hostname;
  } catch {
    // TIN-1456: fall back to the hub, never the apex.
    return 'hub.tinyland.dev';
  }
}




export function getActivityPubDir(): string {
  const config = getActivityPubConfig();
  const dir = config.activitypubDir;
  return dir.startsWith('/') ? dir : join(process.cwd(), dir);
}




export function getContentDir(): string {
  const config = getActivityPubConfig();
  const dir = config.contentDir;
  return dir.startsWith('/') ? dir : join(process.cwd(), dir);
}




export function getUsersContentDir(): string {
  return join(getContentDir(), 'users');
}




export function getActorsDir(): string {
  return join(getActivityPubDir(), 'actors');
}




export function getFollowersDir(): string {
  return join(getActivityPubDir(), 'followers');
}




export function getFollowingDir(): string {
  return join(getActivityPubDir(), 'following');
}




export function getLikesDir(): string {
  return join(getActivityPubDir(), 'likes');
}




export function getBoostsDir(): string {
  return join(getActivityPubDir(), 'boosts');
}




export function getNotificationsDir(): string {
  return join(getActivityPubDir(), 'notifications');
}




export function getDeliveryQueueDir(): string {
  return join(getActivityPubDir(), 'delivery-queue');
}




export function getRemoteActorsCacheDir(): string {
  return join(getActivityPubDir(), 'remote-actors');
}








export const CONTENT_TYPE_MAPPING: Record<string, string> = {
  blog: 'Article',
  product: 'Page',
  profile: 'Article',
  event: 'Event',
  comment: 'Note',
  image: 'Image',
  video: 'Video',
  audio: 'Audio'
};




export const REPLYABLE_TYPES = new Set([
  'Note',
  'Article',
  'Page',
  'Question'
]);




export const LIKABLE_TYPES = new Set([
  'Note',
  'Article',
  'Page',
  'Image',
  'Video',
  'Audio',
  'Event'
]);




export const BOOSTABLE_TYPES = new Set([
  'Note',
  'Article',
  'Image',
  'Video',
  'Audio'
]);








export function getActorUri(handle: string): string {
  return `${getUserActorBaseUrl()}/@${handle}`;
}




export function getInboxUri(handle: string): string {
  return `${getActorUri(handle)}/inbox`;
}




export function getOutboxUri(handle: string): string {
  return `${getActorUri(handle)}/outbox`;
}




export function getFollowersUri(handle: string): string {
  return `${getActorUri(handle)}/followers`;
}




export function getFollowingUri(handle: string): string {
  return `${getActorUri(handle)}/following`;
}




export function getLikedUri(handle: string): string {
  return `${getActorUri(handle)}/liked`;
}




export function getWebFingerResource(handle: string): string {
  return `acct:${handle}@${getUserActorDomain()}`;
}




export const AS_PUBLIC_COLLECTION =
  'https://www.w3.org/ns/activitystreams#Public';

/**
 * TIN-1456: central audience gate for every legacy emitter in this package.
 *
 * The legacy per-user AP surface must NOT address the public collection
 * (as#Public) until the TIN-1429 public federation launch lands — emitted
 * audiences are controlled collections only. `public`, `unlisted`, and
 * `followers` all downgrade to the actor's followers collection; anything
 * else gets an empty audience. This is deliberately a single reversible
 * choke point: when the public launch ships, restore as#Public here instead
 * of editing every emitter.
 */
export function gatedAudience(
  followersUri: string,
  visibility?: string,
): { to: string[]; cc: string[] } {
  switch (visibility ?? 'public') {
    case 'public':
    case 'unlisted':
    case 'followers':
      return { to: followersUri ? [followersUri] : [], cc: [] };
    default:
      return { to: [], cc: [] };
  }
}




export function isLocalUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.hostname === getInstanceDomain() || url.hostname === getUserActorDomain();
  } catch {
    return false;
  }
}




export function extractHandleFromUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    // The broker is local, but is not a second identity for a personal actor.
    if (url.hostname !== getUserActorDomain()) {
      return null;
    }

    
    const match = url.pathname.match(/^\/@([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}




export function getInternalContentType(internalType: string): string {
  return CONTENT_TYPE_MAPPING[internalType] || 'Note';
}




export function isReplyable(type: string): boolean {
  return REPLYABLE_TYPES.has(type);
}




export function isLikable(type: string): boolean {
  return LIKABLE_TYPES.has(type);
}




export function isBoostable(type: string): boolean {
  return BOOSTABLE_TYPES.has(type);
}
