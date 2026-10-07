import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureActivityPub, resetActivityPubConfig } from '../src/config.js';
import { getPublicKey } from '../src/services/HttpSignatureService.js';
import { publicFederationFetch } from '../src/utils/publicFederationFetch.js';

const { lookup, httpsRequest } = vi.hoisted(() => ({ lookup: vi.fn(), httpsRequest: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup }));
vi.mock('node:https', () => ({ request: httpsRequest }));

let nextStatus: number;
let nextBody: Buffer;
let nextHeaders: Record<string, string>;
let nextComplete: boolean;
let sentBody: Buffer | undefined;
let responseDestroyed: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  nextStatus = 200;
  nextBody = Buffer.from('{"ok":true}');
  nextHeaders = { 'content-type': 'application/activity+json' };
  nextComplete = true;
  sentBody = undefined;
  responseDestroyed = false;
  lookup.mockResolvedValue([{ address: '93.184.215.14', family: 4 }]);
  httpsRequest.mockImplementation((_url, _options, receive) => {
    const outgoing = new EventEmitter() as EventEmitter & { end: (body?: Buffer) => void; destroy: () => void };
    outgoing.destroy = () => {};
    outgoing.end = (body) => {
      sentBody = body;
      queueMicrotask(() => {
        const incoming = Object.assign(new EventEmitter(), {
          statusCode: nextStatus, headers: nextHeaders, complete: nextComplete,
          destroy: () => { responseDestroyed = true; },
        });
        receive(incoming);
        if (!responseDestroyed) {
          incoming.emit('data', nextBody);
          incoming.emit('end');
        }
      });
    };
    return outgoing;
  });
});

describe('public federation transport', () => {
  it.each([
    'http://peer.example/actor', 'https://user:secret@peer.example/actor',
    'https://localhost/actor', 'https://foo.localhost/actor', 'https://peer.local/actor',
    'https://metadata.google.internal/actor', 'https://peer.home.arpa/actor',
    'https://127.0.0.1/', 'https://127.1/', 'https://2130706433/', 'https://0x7f000001/',
    'https://0.0.0.0/', 'https://10.1.2.3/', 'https://100.125.97.64/',
    'https://169.254.169.254/', 'https://172.16.0.1/', 'https://192.168.1.1/',
    'https://192.0.0.1/', 'https://192.88.99.1/', 'https://198.18.0.1/',
    'https://203.0.113.1/', 'https://224.0.0.1/', 'https://255.255.255.255/',
    'https://[::]/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:8.8.8.8]/', 'https://[fd7a:115c:a1e0::1]/', 'https://[fcff::1]/',
    'https://[febf::1]/', 'https://[ff02::1]/', 'https://[64:ff9b::a00:1]/',
    'https://[2001::1]/', 'https://[2001:db8::1]/', 'https://[2002:7f00:1::1]/',
    'https://[3fff:fff::1]/',
  ])('rejects non-public or ambiguous destination %s before I/O', async (url) => {
    await expect(publicFederationFetch(url)).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '10.2.3.4', '100.64.0.1', '169.254.169.254', '::ffff:7f00:1', 'fd00::1'])
  ('rejects DNS answer %s even mixed with a public answer', async (address) => {
    lookup.mockResolvedValue([{ address: '93.184.215.14', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }]);
    await expect(publicFederationFetch('https://peer.example/actor')).rejects.toThrow('outside the public network');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('pins validated DNS across reconnect lookup without changing signed headers or bytes', async () => {
    const body = '{ "content": "é", "n": 1 }';
    const signed = new Request('https://peer.example:8443/inbox?x=1', {
      method: 'POST', body,
      headers: { host: 'peer.example:8443', signature: 'original-signature', digest: 'original-digest', date: 'original-date' },
    });
    const response = await publicFederationFetch(signed);
    expect(await response.json()).toEqual({ ok: true });
    const [url, options] = httpsRequest.mock.calls[0];
    expect(url.href).toBe(signed.url);
    expect(options).toMatchObject({ agent: false, rejectUnauthorized: true, method: 'POST',
      headers: { host: 'peer.example:8443', signature: 'original-signature', digest: 'original-digest', date: 'original-date' } });
    expect(sentBody?.equals(Buffer.from(body))).toBe(true);
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const callback = vi.fn();
    options.lookup('peer.example', {}, callback);
    expect(callback).toHaveBeenLastCalledWith(null, '93.184.215.14', 4);
    options.lookup('peer.example', { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: '93.184.215.14', family: 4 }]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('permits global IPv6 and uses its pinned family', async () => {
    lookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }]);
    await publicFederationFetch('https://peer.example/actor');
    const callback = vi.fn();
    httpsRequest.mock.calls[0][1].lookup('peer.example', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '2606:4700:4700::1111', 6);
  });

  it.each([301, 302, 303, 307, 308])('rejects HTTP %i without following Location', async (status) => {
    nextStatus = status;
    nextHeaders = { location: 'https://169.254.169.254/secrets' };
    await expect(publicFederationFetch('https://peer.example/actor', { redirect: 'follow' })).rejects.toThrow('redirects');
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    expect(responseDestroyed).toBe(true);
  });

  it('bounds a streamed request before opening the socket', async () => {
    await expect(publicFederationFetch('https://peer.example/inbox', {
      method: 'POST', body: 'x'.repeat(1024 * 1024 + 1),
    })).rejects.toThrow('request body');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('bounds the response and does not leak its contents in errors', async () => {
    nextBody = Buffer.from('secret'.repeat(200_000));
    await expect(publicFederationFetch('https://peer.example/actor')).rejects.toThrow('response body exceeds limit');
    expect(responseDestroyed).toBe(true);
  });

  it('rejects an incomplete response', async () => {
    nextComplete = false;
    await expect(publicFederationFetch('https://peer.example/actor')).rejects.toThrow('interrupted');
  });

  it('rejects invalid response status without an uncaught event exception', async () => {
    nextStatus = 600;
    await expect(publicFederationFetch('https://peer.example/actor')).rejects.toThrow('status is invalid');
  });

  it('honors cancellation during unresolved DNS without creating a socket', async () => {
    lookup.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const result = publicFederationFetch('https://peer.example/actor', { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toThrow('resolution failed');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('rechecks consumer authorization after resolution and before creating a socket', async () => {
    const beforeSend = vi.fn(() => {
      expect(lookup).toHaveBeenCalledOnce();
      expect(httpsRequest).not.toHaveBeenCalled();
      throw new Error('Author grant revoked');
    });
    await expect(publicFederationFetch('https://peer.example/inbox', {
      method: 'POST', body: '{}',
    }, { beforeSend })).rejects.toThrow('Author grant revoked');
    expect(beforeSend).toHaveBeenCalledOnce();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it.each(['authorization', 'cookie', 'proxy-authorization'])('rejects ambient %s credentials', async (name) => {
    await expect(publicFederationFetch('https://peer.example/actor', {
      headers: { [name]: 'secret' },
    })).rejects.toThrow('ambient credentials');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects mismatched signed Host without resolving', async () => {
    await expect(publicFederationFetch('https://peer.example/inbox', {
      method: 'POST', body: '{}', headers: { host: 'internal.example' },
    })).rejects.toThrow('Host must match');
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('untrusted inbound key lookup', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ap-public-key-network-'));
    configureActivityPub({ activitypubDir: directory });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    resetActivityPubConfig();
    rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it.each(['https://127.0.0.1/actor#key', 'https://[::ffff:a00:1]/actor#key', 'https://metadata.google.internal/actor#key'])
  ('fails closed for keyId %s before network access', async (keyId) => {
    await expect(getPublicKey(keyId)).resolves.toBeNull();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('rejects a key document redirect before reading or caching a secret target', async () => {
    nextStatus = 302;
    nextHeaders = { location: 'https://169.254.169.254/credentials' };
    await expect(getPublicKey('https://peer.example/actor#key')).resolves.toBeNull();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  it.each(['id', 'owner', 'actor'])('rejects a substituted public key %s', async (field) => {
    const actor = { id: 'https://peer.example/actor', publicKey: {
      id: 'https://peer.example/actor#key', owner: 'https://peer.example/actor', publicKeyPem: 'test-public-key',
    } };
    if (field === 'actor') actor.id = 'https://other.example/actor';
    else actor.publicKey[field as 'id' | 'owner'] = 'https://other.example/actor';
    nextBody = Buffer.from(JSON.stringify(actor));
    await expect(getPublicKey('https://peer.example/actor#key')).resolves.toBeNull();
  });

  it('accepts and caches only the exact actor-owned requested key', async () => {
    nextBody = Buffer.from(JSON.stringify({ id: 'https://peer.example/actor', publicKey: {
      id: 'https://peer.example/actor#key', owner: 'https://peer.example/actor', publicKeyPem: 'test-public-key',
    } }));
    await expect(getPublicKey('https://peer.example/actor#key')).resolves.toMatchObject({
      id: 'https://peer.example/actor#key', owner: 'https://peer.example/actor', publicKeyPem: 'test-public-key',
    });
    await getPublicKey('https://peer.example/actor#key');
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });
});
