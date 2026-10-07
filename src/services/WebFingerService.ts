






import type { Actor } from '../types/actor.js';
import { getActorByHandle } from './ActorService.js';
import { getUserActorBaseUrl, getUserActorDomain, getActivityPubConfig, getActorUri } from '../config.js';








export interface WebFingerResource {
  subject: string;
  aliases?: string[];
  links: WebFingerLink[];
}




export interface WebFingerLink {
  rel: string;
  type?: string;
  href?: string;
  template?: string;
  properties?: Record<string, string | boolean>;
}








export function parseResource(resource: string): {
  type: 'acct' | 'url';
  handle?: string;
  domain?: string;
} | null {
  
  if (resource.startsWith('acct:')) {
    const match = resource.match(/^acct:([^@]+)@([^@]+)$/);
    if (match) {
      return {
        type: 'acct',
        handle: match[1],
        domain: match[2]
      };
    }
  }

  
  if (resource.startsWith('http://') || resource.startsWith('https://')) {
    try {
      const url = new URL(resource);
      const match = url.pathname.match(/^\/@([^/]+)$/);
      if (match) {
        return {
          type: 'url',
          handle: match[1],
          domain: url.hostname
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}





export async function getWebFingerForResource(resource: string): Promise<WebFingerResource | null> {
  const parsed = parseResource(resource);
  const instanceDomain = getUserActorDomain();
  const baseUrl = getUserActorBaseUrl();

  if (!parsed) {
    return null;
  }

  
  if (parsed.domain !== instanceDomain) {
    return null;
  }

  const { handle } = parsed;

  // This entrypoint is also used without validateWebFingerQuery. Never pass
  // an unchecked resource handle to the filesystem-backed actor lookup.
  if (!handle || !/^[a-zA-Z0-9_-]+$/.test(handle)) {
    return null;
  }

  
  
  const actor = getActorByHandle(handle);

  
  if (!actor) {
    const config = getActivityPubConfig();
    if (config.resolveUser) {
      // Compatibility fallback only: the host must restrict this resolver and
      // public discovery to users whose federation activation is authorized.
      // Resolving a user does not establish private-key custody or activation.
      const user = await config.resolveUser(handle);
      if (!user) {
        return null; 
      }
    } else {
      return null;
    }
  }

  
  const actorId = getActorUri(handle);

  
  const profileUrl = `${baseUrl}/@${handle}`;

  
  const webFingerResponse: WebFingerResource = {
    subject: resource,
    aliases: [actorId, profileUrl],
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: actorId
      },
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: profileUrl
      },
      {
        rel: 'http://ostatus.org/schema/1.0/subscribe',
        template: `${baseUrl}/authorize_interaction?uri={uri}`
      }
    ]
  };

  return webFingerResponse;
}




export function webFingerFromActor(actor: Actor): WebFingerResource {
  // This helper accepts personal and brand actors, including explicit origins.
  // Derive discovery identity from the supplied actor, not a global default.
  const actorUrl = new URL(actor.id);
  const baseUrl = actorUrl.origin;
  const resource = `acct:${actor.preferredUsername}@${actorUrl.hostname}`;

  return {
    subject: resource,
    aliases: [actor.id, actor.url || actor.id],
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: actor.id
      },
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: actor.url || actor.id
      },
      {
        rel: 'http://ostatus.org/schema/1.0/subscribe',
        template: `${baseUrl}/authorize_interaction?uri={uri}`
      }
    ]
  };
}




export function validateWebFingerQuery(params: URLSearchParams): {
  valid: boolean;
  resource?: string;
  error?: string;
} {
  const resource = params.get('resource');
  const instanceDomain = getUserActorDomain();

  if (!resource) {
    return {
      valid: false,
      error: 'Missing required parameter: resource'
    };
  }

  
  const parsed = parseResource(resource);

  if (!parsed) {
    return {
      valid: false,
      error: 'Invalid resource format. Expected: acct:username@domain'
    };
  }

  
  if (parsed.domain !== instanceDomain) {
    return {
      valid: false,
      error: 'Resource domain does not match this instance'
    };
  }

  
  if (parsed.handle && !/^[a-zA-Z0-9_-]+$/.test(parsed.handle)) {
    return {
      valid: false,
      error: 'Invalid handle format. Only alphanumeric, hyphen, and underscore allowed'
    };
  }

  return {
    valid: true,
    resource
  };
}
