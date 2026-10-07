import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureActivityPub, resetActivityPubConfig } from '../src/config.js';
import { createBrandActor } from '../src/services/BrandActorService.js';
import {
  getDeliveryLogEntries,
  getDeliveryTask,
  processDeliveryQueue,
  queueForDelivery,
} from '../src/services/ActivityDeliveryService.js';
import {
  createSignedRequest,
  verifyDigest,
  verifyHttpSignature,
} from '../src/services/HttpSignatureService.js';
import {
  createTombstoneDeleteActivity,
  isTombstoneDeleteActivity,
  validateTombstoneDeleteActivity,
} from '../src/services/TombstoneService.js';
import type { Activity } from '../src/types/activitystreams.js';

// These protocol fixtures deliberately stub transport; public-network policy is
// independently exercised in public-federation-fetch.test.ts without sockets.
vi.mock('../src/utils/publicFederationFetch.js', () => ({
  publicFederationFetch: (input: string | URL | Request, init?: RequestInit) => fetch(input, init),
}));

function generateRsaPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

describe('controlled peer ActivityPub proof harness', () => {
  let activitypubDir: string;

  beforeEach(() => {
    activitypubDir = mkdtempSync(join(tmpdir(), 'tinyland-ap-proof-'));
    resetActivityPubConfig();
    configureActivityPub({
      siteBaseUrl: 'https://tinyland.dev',
      federationTimeout: 1000,
      activitypubDir,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetActivityPubConfig();
    rmSync(activitypubDir, { recursive: true, force: true });
  });

  it('signs outbound brand actor delivery and verifies it as inbound peer traffic', async () => {
    const senderKeys = generateRsaPair();
    const peerKeys = generateRsaPair();

    const sender = createBrandActor({
      slug: 'software-tinyland-dev',
      name: 'Software.tinyland.dev',
      publicKeyPem: senderKeys.publicKeyPem,
      published: '2026-05-10T00:00:00.000Z',
    });

    const peer = createBrandActor({
      slug: 'controlled-peer',
      name: 'Controlled Peer',
      baseUrl: 'https://peer.example',
      publicKeyPem: peerKeys.publicKeyPem,
      published: '2026-05-10T00:00:00.000Z',
    });

    const activity: Activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://tinyland.dev/ap/activities/create/software-proof-001',
      type: 'Create',
      actor: sender.id,
      to: [peer.id],
      object: {
        id: 'https://tinyland.dev/ap/content/services/software-proof-001',
        type: 'Note',
        attributedTo: sender.id,
        content: 'Controlled AP proof fixture.',
        to: [peer.id],
      },
    };

    const signedRequest = await createSignedRequest(
      'POST',
      peer.inbox,
      senderKeys.privateKeyPem,
      sender.publicKey.id,
      activity
    );

    const body = await signedRequest.text();
    const digest = signedRequest.headers.get('digest');
    const signature = signedRequest.headers.get('signature');

    expect(signedRequest.method).toBe('POST');
    expect(signedRequest.url).toBe(peer.inbox);
    expect(digest).toBeTruthy();
    expect(signature).toContain(`keyId="${sender.publicKey.id}"`);
    expect(verifyDigest(body, digest ?? '')).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const requestUrl = url instanceof Request ? url.url : String(url);

      if (requestUrl === sender.id) {
        return Response.json(sender, {
          headers: {
            'content-type': 'application/activity+json',
          },
        });
      }

      return new Response('not found', { status: 404 });
    }));

    const inboundRequest = new Request(signedRequest.url, {
      method: signedRequest.method,
      headers: signedRequest.headers,
      body,
    });

    await expect(verifyHttpSignature(inboundRequest, signature ?? '')).resolves.toBe(true);
  });

  it('records delivery retry evidence before successful controlled-peer delivery', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T00:00:00.000Z'));

    configureActivityPub({
      siteBaseUrl: 'https://tinyland.dev',
      federationTimeout: 1000,
      maxDeliveryRetries: 1,
      activitypubDir,
    });

    const peer = createBrandActor({
      slug: 'controlled-peer',
      name: 'Controlled Peer',
      baseUrl: 'https://peer.example',
      publicKeyPem: generateRsaPair().publicKeyPem,
      published: '2026-05-10T00:00:00.000Z',
    });

    const actorId = 'https://tinyland.dev/ap/actors/brand/software-tinyland-dev';
    const activity: Activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://tinyland.dev/ap/activities/update/software-proof-001',
      type: 'Update',
      actor: actorId,
      to: [peer.id],
      object: {
        id: 'https://tinyland.dev/ap/content/services/software-proof-001',
        type: 'Note',
        attributedTo: actorId,
        content: 'Controlled AP proof fixture updated.',
        to: [peer.id],
      },
    };

    let inboxAttempts = 0;

    vi.stubGlobal('fetch', vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      const requestUrl = url instanceof Request ? url.url : String(url);

      if (requestUrl === peer.id) {
        return Response.json(peer, {
          headers: {
            'content-type': 'application/activity+json',
          },
        });
      }

      if (requestUrl === peer.inbox && init?.method === 'POST') {
        inboxAttempts++;

        if (inboxAttempts === 1) {
          return new Response('retry later', { status: 503 });
        }

        return new Response('', { status: 202 });
      }

      return new Response('not found', { status: 404 });
    }));

    const taskId = await queueForDelivery(activity, [peer.id], undefined, {
      autoProcess: false,
    });

    await processDeliveryQueue();

    const retryTask = getDeliveryTask(taskId);
    expect(retryTask?.status).toBe('pending');
    expect(retryTask?.retryCount).toBe(1);
    expect(retryTask?.nextRetryAt).toBeGreaterThan(Date.now());

    expect(getDeliveryLogEntries(taskId)).toEqual([
      expect.objectContaining({
        taskId,
        activityId: activity.id,
        activityType: 'Update',
        recipient: peer.id,
        status: 'error',
        attempt: 1,
        error: 'HTTP 503',
      }),
    ]);

    vi.setSystemTime((retryTask?.nextRetryAt ?? Date.now()) + 1);
    await processDeliveryQueue();

    expect(getDeliveryTask(taskId)).toBeNull();
    expect(inboxAttempts).toBe(2);
    expect(getDeliveryLogEntries(taskId)).toEqual([
      expect.objectContaining({
        status: 'error',
        attempt: 1,
      }),
      expect.objectContaining({
        taskId,
        activityId: activity.id,
        activityType: 'Update',
        recipient: peer.id,
        status: 'success',
        attempt: 2,
      }),
    ]);
  });

  it('signs a Delete with embedded Tombstone and verifies controlled-peer inbound handling', async () => {
    const senderKeys = generateRsaPair();

    const sender = createBrandActor({
      slug: 'gear-tinyland-dev',
      name: 'Gear.tinyland.dev',
      publicKeyPem: senderKeys.publicKeyPem,
      published: '2026-05-10T00:00:00.000Z',
    });

    const peer = createBrandActor({
      slug: 'controlled-peer',
      name: 'Controlled Peer',
      baseUrl: 'https://peer.example',
      publicKeyPem: generateRsaPair().publicKeyPem,
      published: '2026-05-10T00:00:00.000Z',
    });

    const activity = createTombstoneDeleteActivity({
      activityId: 'https://tinyland.dev/ap/activities/delete/gear-proof-001',
      actor: sender.id,
      id: 'https://tinyland.dev/ap/content/gear/gear-proof-001',
      formerType: 'Page',
      deleted: '2026-05-10T00:10:00.000Z',
      published: '2026-05-10T00:10:00.000Z',
      to: [peer.id],
    });

    expect(isTombstoneDeleteActivity(activity)).toBe(true);
    expect(validateTombstoneDeleteActivity(activity)).toEqual({
      valid: true,
      errors: [],
    });

    const signedRequest = await createSignedRequest(
      'POST',
      peer.inbox,
      senderKeys.privateKeyPem,
      sender.publicKey.id,
      activity
    );

    const body = await signedRequest.text();
    const parsedBody = JSON.parse(body) as Activity;
    const digest = signedRequest.headers.get('digest');
    const signature = signedRequest.headers.get('signature');

    expect(parsedBody.type).toBe('Delete');
    expect(isTombstoneDeleteActivity(parsedBody)).toBe(true);
    expect(validateTombstoneDeleteActivity(parsedBody)).toEqual({
      valid: true,
      errors: [],
    });
    expect(verifyDigest(body, digest ?? '')).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const requestUrl = url instanceof Request ? url.url : String(url);

      if (requestUrl === sender.id) {
        return Response.json(sender, {
          headers: {
            'content-type': 'application/activity+json',
          },
        });
      }

      return new Response('not found', { status: 404 });
    }));

    const inboundRequest = new Request(signedRequest.url, {
      method: signedRequest.method,
      headers: signedRequest.headers,
      body,
    });

    await expect(verifyHttpSignature(inboundRequest, signature ?? '')).resolves.toBe(true);
  });
});
