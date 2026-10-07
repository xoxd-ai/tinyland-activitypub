




import { getSiteBaseUrl, getUserActorDomain, getActorUri } from '../config.js';





export interface ParsedMention {
  type: 'Mention';
  href: string;
  name: string;
  handle: string;
  local: boolean;
  domain?: string;
}

export interface ParsedHashtag {
  type: 'Hashtag';
  href: string;
  name: string;
  tag: string;
}

export interface ParsedContent {
  content: string;
  mentions: ParsedMention[];
  hashtags: ParsedHashtag[];
}









export function parseMentions(content: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];

  
  
  
  
  const mentionRegex = /@([a-zA-Z0-9_-]+(?:@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?)/g;

  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(content)) !== null) {
    const fullMention = match[0];
    const handlePart = match[1];

    let handle: string;
    let domain: string | undefined;
    let local: boolean;

    if (handlePart.includes('@')) {
      
      const [username, remoteDomain] = handlePart.split('@');
      handle = username;
      domain = remoteDomain;
      local = false;
    } else {
      
      handle = handlePart;
      local = true;
      domain = getUserActorDomain();
    }

    mentions.push({
      type: 'Mention',
      href: buildMentionUri(handle, domain, local),
      name: fullMention,
      handle,
      local,
      domain
    });
  }

  return mentions;
}




export function buildMentionUri(
  handle: string,
  domain?: string,
  local = true
): string {
  if (local) {
    return getActorUri(handle);
  }

  return `https://${domain}/@${handle}`;
}




export function linkifyMentions(content: string, mentions: ParsedMention[]): string {
  let linkedContent = content;

  
  for (let i = mentions.length - 1; i >= 0; i--) {
    const mention = mentions[i];
    const mentionRegex = new RegExp(`@${mention.handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');

    linkedContent = linkedContent.replace(mentionRegex, (match, offset) => {
      
      const beforeMatch = linkedContent.substring(0, offset);
      if (beforeMatch.lastIndexOf('<a') > beforeMatch.lastIndexOf('</a>')) {
        
        return match;
      }

      return `<a href="${mention.href}" class="u-url mention">@${mention.handle}</a>`;
    });
  }

  return linkedContent;
}








export function parseHashtags(content: string): ParsedHashtag[] {
  const hashtags: ParsedHashtag[] = [];

  
  
  
  const hashtagRegex = /(?<!\w)#([a-zA-Z0-9_]+)/g;

  let match: RegExpExecArray | null;
  const seenTags = new Set<string>();

  while ((match = hashtagRegex.exec(content)) !== null) {
    const tag = match[1].toLowerCase();

    
    if (seenTags.has(tag)) {
      continue;
    }

    seenTags.add(tag);

    hashtags.push({
      type: 'Hashtag',
      href: buildHashtagUri(tag),
      name: `#${tag}`,
      tag
    });
  }

  return hashtags;
}




export function buildHashtagUri(tag: string): string {
  return `${getSiteBaseUrl()}/tags/${tag}`;
}




export function linkifyHashtags(content: string, hashtags: ParsedHashtag[]): string {
  let linkedContent = content;

  
  for (let i = hashtags.length - 1; i >= 0; i--) {
    const hashtag = hashtags[i];
    const hashtagRegex = new RegExp(`#${hashtag.tag}`, 'g');

    linkedContent = linkedContent.replace(hashtagRegex, (match, offset) => {
      
      const beforeMatch = linkedContent.substring(0, offset);
      if (beforeMatch.lastIndexOf('<a') > beforeMatch.lastIndexOf('</a>')) {
        
        return match;
      }

      return `<a href="${hashtag.href}" class="mention hashtag">#${hashtag.tag}</a>`;
    });
  }

  return linkedContent;
}








export function parseContent(content: string): ParsedContent {
  const mentions = parseMentions(content);
  const hashtags = parseHashtags(content);

  
  const linkedContent = linkifyHashtags(linkifyMentions(content, mentions), hashtags);

  return {
    content: linkedContent,
    mentions,
    hashtags
  };
}




export function extractActorUrisFromMentions(mentions: ParsedMention[]): string[] {
  return Array.from(
    new Set(
      mentions.map(m => m.href)
    )
  );
}




export function buildMentionAddressing(
  visibility: 'public' | 'unlisted' | 'followers' | 'private',
  _actorUri: string,
  actorFollowersUri: string,
  mentions: ParsedMention[]
): { to: string[]; cc: string[] } {
  const to: string[] = [];
  const cc: string[] = [];

  
  const mentionActorUris = extractActorUrisFromMentions(mentions);

  
  switch (visibility) {
    case 'public':
      // TIN-1456: as#Public is gated — downgrade to the followers collection.
      to.push(actorFollowersUri || '');
      break;

    case 'unlisted':
      // TIN-1456: as#Public is gated — followers collection only.
      to.push(actorFollowersUri || '');
      break;

    case 'followers':
      to.push(actorFollowersUri || '');
      break;

    case 'private':
      
      break;
  }

  
  if (visibility === 'public' || visibility === 'unlisted') {
    cc.push(...mentionActorUris);
  } else {
    to.push(...mentionActorUris);
  }

  return { to, cc };
}
