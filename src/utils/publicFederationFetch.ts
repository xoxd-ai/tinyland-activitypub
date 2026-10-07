import { lookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';

const MAX_BODY_BYTES = 1024 * 1024;
const DEADLINE_MS = 10_000;

export class PublicFederationFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicFederationFetchError';
  }
}

// Public federation is not an internal HTTP client. Deliberately exclude
// special-purpose ranges, including transition/translation IPv6 addresses.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) ||
        (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6 || address.includes('%')) return false;
  const [first, second = '0'] = address.toLowerCase().split(':');
  const high = parseInt(first, 16);
  const next = parseInt(second || '0', 16);
  return high >= 0x2000 && high <= 0x3fff &&
    !(high === 0x2001 && (next <= 0x1ff || next === 0xdb8)) &&
    high !== 0x2002 && !(high === 0x3fff && next <= 0xfff);
}

function federationUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicFederationFetchError('Federation destination must be a valid HTTPS URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || !host ||
      (!isIP(host) && (!host.includes('.') ||
        /\.(localhost|local|internal|home\.arpa)$/.test(host))) ||
      (isIP(host) && !isPublicAddress(host))) {
    throw new PublicFederationFetchError('Federation destination must be public HTTPS');
  }
  url.hash = '';
  return url;
}

function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new PublicFederationFetchError('Federation request aborted'));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

async function requestBody(request: Request, signal: AbortSignal): Promise<Buffer | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await untilAborted(reader.read(), signal);
      if (done) return Buffer.concat(chunks);
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        throw new PublicFederationFetchError('Federation request body exceeds limit');
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    void reader.cancel().catch(() => {});
    throw new PublicFederationFetchError('Federation request body failed or exceeds limit');
  } finally {
    reader.releaseLock();
  }
}

/**
 * Node-only, bounded GET/POST transport for untrusted public federation peers.
 * Resolves once, rejects mixed public/private DNS answers and pins that result
 * to the socket while retaining the original TLS hostname and signed Host.
 * Redirects are always rejected, including when init requests otherwise.
 */
export async function publicFederationFetch(
  input: string | URL | Request,
  init?: RequestInit,
  options?: { beforeSend?: () => void | Promise<void> },
): Promise<Response> {
  const url = federationUrl(input instanceof Request ? input.url : String(input));
  const request = new Request(input, init);
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
    throw new PublicFederationFetchError('Unsupported federation request method');
  }
  if (request.headers.has('host') && request.headers.get('host') !== url.host) {
    throw new PublicFederationFetchError('Federation Host must match destination');
  }
  if (['authorization', 'proxy-authorization', 'cookie'].some((name) => request.headers.has(name))) {
    throw new PublicFederationFetchError('Federation transport does not forward ambient credentials');
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DEADLINE_MS)]);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    signal.throwIfAborted();
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await untilAborted(lookup(hostname, { all: true, verbatim: true }), signal);
  } catch {
    throw new PublicFederationFetchError('Federation destination resolution failed');
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new PublicFederationFetchError('Federation destination resolved outside the public network');
  }
  const pinned = addresses[0];
  const pinnedLookup: RequestOptions['lookup'] = (_hostname, options, callback) => {
    if (options.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
  const body = await requestBody(request, signal);
  if (options?.beforeSend) await untilAborted(Promise.resolve(options.beforeSend()), signal);
  signal.throwIfAborted();

  return new Promise<Response>((resolve, reject) => {
    const fail = (message: string) => reject(new PublicFederationFetchError(message));
    const outgoing = httpsRequest(url, {
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      // Never reuse a socket whose resolution was validated by another request.
      agent: false,
      rejectUnauthorized: true,
      lookup: pinnedLookup,
      signal,
      maxHeaderSize: 16 * 1024,
    }, (incoming) => {
      const status = incoming.statusCode ?? 502;
      if (status < 200 || status > 599) {
        incoming.destroy();
        fail('Federation response status is invalid');
        return;
      }
      if (status >= 300 && status < 400) {
        incoming.destroy();
        fail('Federation redirects are not permitted');
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      incoming.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          incoming.destroy();
          outgoing.destroy();
          fail('Federation response body exceeds limit');
        } else {
          chunks.push(chunk);
        }
      });
      incoming.on('error', () => fail('Federation response failed'));
      incoming.on('aborted', () => fail('Federation response interrupted'));
      incoming.on('end', () => {
        if (!incoming.complete) {
          fail('Federation response interrupted');
          return;
        }
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          const noBody = request.method === 'HEAD' || status === 204 || status === 205;
          resolve(new Response(noBody ? null : new Uint8Array(Buffer.concat(chunks)), { status, headers }));
        } catch {
          fail('Federation response is invalid');
        }
      });
    });
    outgoing.on('error', () => fail('Federation transport failed'));
    outgoing.on('upgrade', (_response, socket) => {
      socket.destroy();
      fail('Federation protocol upgrades are not permitted');
    });
    outgoing.end(body);
  });
}
