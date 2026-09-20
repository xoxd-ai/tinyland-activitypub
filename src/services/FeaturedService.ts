







import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { OrderedCollection, Note as NoteObject, Article } from '../types/activitystreams.js';
import { getUserActorBaseUrl, getActorUri, getContentDir } from '../config.js';





export interface FeaturedItem {
  slug: string;
  type: 'blog' | 'note' | 'product';
  title: string;
  summary?: string;
  url: string;
  activityUri: string;
  publishedAt: string;
  featured: boolean;
}





export type FrontmatterParser = (fileContent: string) => {
  data: Record<string, unknown>;
  content: string;
};









let _frontmatterParser: FrontmatterParser | null = null;




export function setFrontmatterParser(parser: FrontmatterParser): void {
  _frontmatterParser = parser;
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; content: string } {
  if (_frontmatterParser) {
    return _frontmatterParser(content);
  }
  
  return { data: {}, content };
}








export function getFeaturedPosts(handle: string, contentDir?: string): FeaturedItem[] {
  const featured: FeaturedItem[] = [];
  const baseUrl = getUserActorBaseUrl();
  // TIN-1931: content lives under <contentDir>/users/<handle>/, not the
  // legacy src/content root.
  const resolvedContentDir = contentDir || getContentDir();
  const userDir = join(resolvedContentDir, 'users', handle);


  const blogDir = join(userDir, 'blog');
  if (existsSync(blogDir)) {
    try {
      const files = readdirSync(blogDir).filter(f => f.endsWith('.md'));

      for (const file of files) {
        const filePath = join(blogDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const { data } = parseFrontmatter(content);

        if (data.featured === true && data.published !== false) {
          const slug = file.replace('.md', '');
          featured.push({
            slug,
            type: 'blog',
            title: (data.title as string) || 'Untitled',
            summary: (data.excerpt as string) || (data.description as string),
            url: `${baseUrl}/@${handle}/blog/${slug}`,
            activityUri: `${getActorUri(handle)}/blog/${slug}`,
            publishedAt: (data.publishedAt as string) || (data.date as string),
            featured: true
          });
        }
      }
    } catch (error) {
      console.error('[Featured] Failed to scan blog posts:', error);
    }
  }

  
  const notesDir = join(userDir, 'notes');
  if (existsSync(notesDir)) {
    try {
      const files = readdirSync(notesDir).filter(f => f.endsWith('.md'));

      for (const file of files) {
        const filePath = join(notesDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const { data } = parseFrontmatter(content);

        if (data.featured === true && data.published !== false) {
          const slug = file.replace('.md', '');
          featured.push({
            slug,
            type: 'note',
            title: (data.title as string) || 'Note',
            summary: typeof data.content === 'string' ? data.content.substring(0, 200) : undefined,
            url: `${baseUrl}/@${handle}/notes/${slug}`,
            activityUri: `${getActorUri(handle)}/notes/${slug}`,
            publishedAt: (data.publishedAt as string) || (data.date as string),
            featured: true
          });
        }
      }
    } catch (error) {
      console.error('[Featured] Failed to scan notes:', error);
    }
  }

  
  const productsDir = join(userDir, 'products');
  if (existsSync(productsDir)) {
    try {
      const files = readdirSync(productsDir).filter(f => f.endsWith('.md'));

      for (const file of files) {
        const filePath = join(productsDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const { data } = parseFrontmatter(content);

        if (data.featured === true && data.published !== false) {
          const slug = file.replace('.md', '');
          featured.push({
            slug,
            type: 'product',
            title: (data.name as string) || 'Product',
            summary: data.description as string,
            url: `${baseUrl}/@${handle}/products/${slug}`,
            activityUri: `${getActorUri(handle)}/products/${slug}`,
            publishedAt: (data.publishedAt as string) || (data.date as string),
            featured: true
          });
        }
      }
    } catch (error) {
      console.error('[Featured] Failed to scan products:', error);
    }
  }

  
  return featured.sort((a, b) => {
    const dateA = new Date(a.publishedAt || 0).getTime();
    const dateB = new Date(b.publishedAt || 0).getTime();
    return dateB - dateA;
  });
}




export function featuredItemToActivity(item: FeaturedItem, handle: string): NoteObject | Article {
  const actorUri = getActorUri(handle);

  if (item.type === 'note') {
    return {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: item.activityUri,
      type: 'Note',
      attributedTo: actorUri,
      content: item.summary || '',
      url: item.url,
      published: item.publishedAt
    };
  }

  
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: item.activityUri,
    type: 'Article',
    attributedTo: actorUri,
    name: item.title,
    content: item.summary || '',
    summary: item.summary,
    url: item.url,
    published: item.publishedAt
  };
}




export function getFeaturedCollection(handle: string, contentDir?: string): OrderedCollection {
  const actorUri = getActorUri(handle);
  const featuredItems = getFeaturedPosts(handle, contentDir);

  
  const orderedItems = featuredItems.map(item =>
    featuredItemToActivity(item, handle)
  );

  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${actorUri}/featured`,
    type: 'OrderedCollection',
    totalItems: orderedItems.length,
    orderedItems
  };
}
