// TIN-1456 regression tests: the apex (tinyland.dev) must never be an
// ActivityPub id authority, and the legacy emitters in this package must
// never address the public collection (as#Public) — controlled audiences
// (the actor's followers collection) only.
//
// Doctrine: hub.tinyland.dev (via TINYLAND_FEDERATION_ORIGIN) is the SOLE
// public AP authority. The apex is tailnet-only.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  configureActivityPub,
  resetActivityPubConfig,
  getActorUri,
  getSiteBaseUrl,
  getInstanceDomain,
  gatedAudience,
} from "../src/config.js";
import {
  convertBlogPostToArticle,
  convertNoteToNoteObject,
  convertProfileToObject,
} from "../src/services/ContentObjectService.js";
import { getAddressingForVisibility } from "../src/federation/index.js";
import { buildMentionAddressing } from "../src/utils/mentions.js";
import { buildAddressing } from "../src/utils/activity.js";
import { getActorByHandle } from "../src/services/ActorService.js";
import type { BlogPost, ContentNote } from "../src/types/content.js";

const AS_PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const APEX_ORIGIN = "https://tinyland.dev";
const HUB_ORIGIN = "https://hub.tinyland.dev";

// AP id-bearing keys: any URI under one of these keys is an AP identifier
// (or audience) and must never be minted on the apex origin.
const ID_KEYS = new Set([
  "id",
  "attributedTo",
  "actor",
  "to",
  "cc",
  "bto",
  "bcc",
  "inReplyTo",
  "url",
  "href",
  "inbox",
  "outbox",
  "followers",
  "following",
  "liked",
  "featured",
  "likes",
  "shares",
  "replies",
  "owner",
  "partOf",
  "first",
  "last",
  "next",
  "prev",
  "sharedInbox",
]);

function collectIdValues(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectIdValues(item, out);
    return out;
  }

  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (ID_KEYS.has(key)) {
        if (typeof value === "string") out.push(value);
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string") out.push(item);
          }
        }
      }
      collectIdValues(value, out);
    }
  }

  return out;
}

function expectNoApexNoPublic(emitted: unknown): void {
  const ids = collectIdValues(emitted);

  for (const id of ids) {
    expect(id).not.toBe(AS_PUBLIC);
    expect(id === APEX_ORIGIN || id.startsWith(`${APEX_ORIGIN}/`)).toBe(false);
  }
}

function makeBlogPost(overrides: Partial<BlogPost> = {}): BlogPost {
  return {
    type: "blog-post",
    slug: "hello-world",
    title: "Hello World",
    excerpt: "An intro",
    content: "# Hello\n\nWorld",
    tags: ["intro"],
    categories: [],
    authorHandle: "jesssullivan",
    visibility: "public",
    date: "2026-01-01T00:00:00Z",
    publishedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeNote(overrides: Partial<ContentNote> = {}): ContentNote {
  return {
    type: "note",
    slug: "a-note",
    content: "Hello, fediverse!",
    tags: [],
    categories: [],
    authorHandle: "jesssullivan",
    visibility: "public",
    date: "2026-01-01T00:00:00Z",
    publishedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("TIN-1456: package default anchors on the hub origin, never the apex", () => {
  beforeEach(() => {
    resetActivityPubConfig();
  });

  afterEach(() => {
    resetActivityPubConfig();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults siteBaseUrl to the hub origin without any configuration", () => {
    expect(getSiteBaseUrl()).toBe(HUB_ORIGIN);
    expect(getActorUri("jesssullivan")).toBe(`${HUB_ORIGIN}/@jesssullivan`);
    expect(getInstanceDomain()).toBe("hub.tinyland.dev");
  });

  it("ignores apex-bound PUBLIC_SITE_URL / SITE_URL when minting AP ids", async () => {
    vi.resetModules();
    vi.stubEnv("PUBLIC_SITE_URL", APEX_ORIGIN);
    vi.stubEnv("SITE_URL", APEX_ORIGIN);
    vi.stubEnv("TINYLAND_FEDERATION_ORIGIN", "");

    const config = await import("../src/config.js");
    config.resetActivityPubConfig();

    expect(config.getSiteBaseUrl()).toBe(HUB_ORIGIN);
    expect(config.getActorUri("jesssullivan")).toBe(
      `${HUB_ORIGIN}/@jesssullivan`,
    );
  });

  it("honors TINYLAND_FEDERATION_ORIGIN as the single AP authority knob", async () => {
    vi.resetModules();
    vi.stubEnv("TINYLAND_FEDERATION_ORIGIN", "https://fed.example.test");

    const config = await import("../src/config.js");
    config.resetActivityPubConfig();

    expect(config.getSiteBaseUrl()).toBe("https://fed.example.test");
  });
});

describe("TIN-1456: gatedAudience never emits as#Public", () => {
  const followers = `${HUB_ORIGIN}/@jesssullivan/followers`;

  it("downgrades public/unlisted/followers to the followers collection", () => {
    for (const visibility of ["public", "unlisted", "followers", undefined]) {
      const { to, cc } = gatedAudience(followers, visibility);
      expect(to).not.toContain(AS_PUBLIC);
      expect(cc).not.toContain(AS_PUBLIC);
      expect(to).toEqual([followers]);
      expect(cc).toEqual([]);
    }
  });

  it("keeps private/unknown audiences empty", () => {
    for (const visibility of ["private", "direct", "weird"]) {
      expect(gatedAudience(followers, visibility)).toEqual({ to: [], cc: [] });
    }
  });
});

describe("TIN-1456: legacy emitters mint hub ids and controlled audiences only", () => {
  beforeEach(() => {
    resetActivityPubConfig();
  });

  afterEach(() => {
    resetActivityPubConfig();
  });

  it("convertBlogPostToArticle: no apex id, no as#Public, hub-anchored identity", () => {
    const article = convertBlogPostToArticle(makeBlogPost(), "jesssullivan");

    expectNoApexNoPublic(article);
    expect(String(article.id).startsWith(`${HUB_ORIGIN}/`)).toBe(true);
    expect(article.attributedTo).toBe(`${HUB_ORIGIN}/@jesssullivan`);
    expect(article.to).toEqual([`${HUB_ORIGIN}/@jesssullivan/followers`]);
  });

  it("convertNoteToNoteObject: no apex id, no as#Public", () => {
    const note = convertNoteToNoteObject(makeNote(), "jesssullivan");

    expectNoApexNoPublic(note);
    expect(String(note.id).startsWith(`${HUB_ORIGIN}/`)).toBe(true);
    expect(note.to).toEqual([`${HUB_ORIGIN}/@jesssullivan/followers`]);
  });

  it("convertProfileToObject: no apex id, no as#Public", () => {
    const profile = convertProfileToObject(
      {
        type: "profile",
        slug: "jesssullivan",
        name: "Jess Sullivan",
        content: "Bio",
        tags: [],
        categories: [],
        authorHandle: "jesssullivan",
        visibility: "public",
        date: "2026-01-01T00:00:00Z",
        publishedAt: "2026-01-01T00:00:00Z",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      "jesssullivan",
    );

    expectNoApexNoPublic(profile);
    expect(profile.to).toEqual([`${HUB_ORIGIN}/@jesssullivan/followers`]);
  });

  it("getAddressingForVisibility: never as#Public for any visibility", () => {
    const followers = `${HUB_ORIGIN}/@jesssullivan/followers`;

    for (const visibility of [
      "public",
      "unlisted",
      "followers",
      "private",
      "direct",
      "anything-else",
    ]) {
      const { to, cc } = getAddressingForVisibility(
        visibility,
        `${HUB_ORIGIN}/@jesssullivan`,
        followers,
      );
      expect(to).not.toContain(AS_PUBLIC);
      expect(cc).not.toContain(AS_PUBLIC);
    }
  });

  it("buildMentionAddressing: never as#Public for any visibility", () => {
    const followers = `${HUB_ORIGIN}/@jesssullivan/followers`;

    for (const visibility of [
      "public",
      "unlisted",
      "followers",
      "private",
    ] as const) {
      const { to, cc } = buildMentionAddressing(
        visibility,
        `${HUB_ORIGIN}/@jesssullivan`,
        followers,
        [],
      );
      expect(to).not.toContain(AS_PUBLIC);
      expect(cc).not.toContain(AS_PUBLIC);
    }
  });

  it("buildAddressing: never as#Public, followers collection only", () => {
    const followers = `${HUB_ORIGIN}/@jesssullivan/followers`;

    for (const params of [
      { public: true, followersUri: followers },
      { followers: true, followersUri: followers },
      { public: true, followers: true, followersUri: followers },
      { public: true },
      { mentions: [`${HUB_ORIGIN}/@other`] },
    ]) {
      const { to, cc } = buildAddressing(params);
      expect(to).not.toContain(AS_PUBLIC);
      expect(cc).not.toContain(AS_PUBLIC);
    }
  });
});

describe("TIN-1456: stored actors are re-anchored on the federation origin", () => {
  beforeEach(() => {
    resetActivityPubConfig();
  });

  afterEach(() => {
    resetActivityPubConfig();
  });

  it("getActorByHandle re-mints apex-bound persisted ids on the hub origin", async () => {
    // Simulate an actor persisted before the hub cutover: its stored id and
    // key id are apex-bound. The emitted actor document must not leak them.
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const dir = mkdtempSync(join(tmpdir(), "tin-1456-actors-"));
    mkdirSync(join(dir, "actors"), { recursive: true });
    writeFileSync(
      join(dir, "actors", "jesssullivan.json"),
      JSON.stringify({
        handle: "jesssullivan",
        id: `${APEX_ORIGIN}/@jesssullivan`,
        actorType: "Person",
        displayName: "Jess Sullivan",
        bio: "",
        publicKeyId: `${APEX_ORIGIN}/@jesssullivan#main-key`,
        publicKeyPem:
          "-----BEGIN PUBLIC KEY-----\nstub\n-----END PUBLIC KEY-----",
        privateKeyPem: "",
        discoverable: true,
        indexable: true,
        manuallyApprovesFollowers: false,
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      }),
      "utf-8",
    );

    configureActivityPub({ activitypubDir: dir });

    const actor = getActorByHandle("jesssullivan");

    expect(actor).not.toBeNull();
    expectNoApexNoPublic(actor);
    expect(actor!.id).toBe(`${HUB_ORIGIN}/@jesssullivan`);
    expect(actor!.publicKey.id).toBe(`${HUB_ORIGIN}/@jesssullivan#main-key`);
    expect(actor!.outbox).toBe(`${HUB_ORIGIN}/@jesssullivan/outbox`);
    expect(actor!.followers).toBe(`${HUB_ORIGIN}/@jesssullivan/followers`);
  });
});

describe("TIN-2111 (ratified 2026-09-20): the live user actor gets its own ids", () => {
  const MOTHERSHIP_ORIGIN = "https://mothership.xoxd.ai";

  beforeEach(() => {
    resetActivityPubConfig();
  });

  afterEach(() => {
    resetActivityPubConfig();
  });

  async function seedStoredActor(dir: string): Promise<void> {
    const { mkdirSync, writeFileSync } = await import("fs");
    const { join } = await import("path");

    mkdirSync(join(dir, "actors"), { recursive: true });
    writeFileSync(
      join(dir, "actors", "jesssullivan.json"),
      JSON.stringify({
        handle: "jesssullivan",
        id: `${APEX_ORIGIN}/@jesssullivan`,
        actorType: "Person",
        displayName: "Jess Sullivan",
        bio: "",
        publicKeyId: `${APEX_ORIGIN}/@jesssullivan#main-key`,
        publicKeyPem:
          "-----BEGIN PUBLIC KEY-----\nstub\n-----END PUBLIC KEY-----",
        privateKeyPem: "",
        discoverable: true,
        indexable: true,
        manuallyApprovesFollowers: false,
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      }),
      "utf-8",
    );
  }

  it("without the option, getActorByHandle is unchanged: still the broker/siteBaseUrl origin", async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const dir = mkdtempSync(join(tmpdir(), "tin-2111-actors-"));
    await seedStoredActor(dir);
    configureActivityPub({ activitypubDir: dir });

    const actor = getActorByHandle("jesssullivan");

    expect(actor!.id).toBe(`${HUB_ORIGIN}/@jesssullivan`);
  });

  it("with useLiveUserActorBaseUrl, re-anchors on liveUserActorBaseUrl instead of siteBaseUrl", async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const dir = mkdtempSync(join(tmpdir(), "tin-2111-actors-"));
    await seedStoredActor(dir);
    configureActivityPub({
      activitypubDir: dir,
      liveUserActorBaseUrl: MOTHERSHIP_ORIGIN,
    });

    const actor = getActorByHandle("jesssullivan", {
      useLiveUserActorBaseUrl: true,
    });

    expect(actor).not.toBeNull();
    expectNoApexNoPublic(actor);
    expect(actor!.id).toBe(`${MOTHERSHIP_ORIGIN}/@jesssullivan`);
    expect(actor!.publicKey.id).toBe(`${MOTHERSHIP_ORIGIN}/@jesssullivan#main-key`);
    expect(actor!.inbox).toBe(`${MOTHERSHIP_ORIGIN}/@jesssullivan/inbox`);
    expect(actor!.outbox).toBe(`${MOTHERSHIP_ORIGIN}/@jesssullivan/outbox`);
    expect(actor!.followers).toBe(`${MOTHERSHIP_ORIGIN}/@jesssullivan/followers`);
  });

  it("with useLiveUserActorBaseUrl but no liveUserActorBaseUrl configured, falls back to siteBaseUrl", async () => {
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const dir = mkdtempSync(join(tmpdir(), "tin-2111-actors-"));
    await seedStoredActor(dir);
    configureActivityPub({ activitypubDir: dir });

    const actor = getActorByHandle("jesssullivan", {
      useLiveUserActorBaseUrl: true,
    });

    expect(actor!.id).toBe(`${HUB_ORIGIN}/@jesssullivan`);
  });
});
