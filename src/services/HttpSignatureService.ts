




import crypto from 'crypto';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync
} from 'fs';
import { join } from 'path';
import { getActivityPubConfig, getRemoteActorsCacheDir } from '../config.js';
import { publicFederationFetch } from '../utils/publicFederationFetch.js';





export interface SignatureHeader {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
}

export interface PublicKeyInfo {
  id: string;
  owner: string;
  publicKeyPem: string;
  cachedAt: number;
  ttl: number;
}





const DEFAULT_SIGNATURE_HEADERS = ['(request-target)', 'host', 'date'];
const DEFAULT_SIGNATURE_HEADERS_WITH_DIGEST = ['(request-target)', 'host', 'date', 'digest'];
const SIGNATURE_ALGORITHM = 'rsa-sha256';

function getPublicKeysCacheDir(): string {
  return join(getRemoteActorsCacheDir(), 'public-keys');
}

function ensurePublicKeysCacheDir(): void {
  const dir = getPublicKeysCacheDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}








export function generateDigest(body: string): string {
  const hash = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
  return `SHA-256=${hash}`;
}




export function verifyDigest(body: string, digestHeader: string): boolean {
  const digestParts = digestHeader.split(',').map(d => d.trim());

  for (const part of digestParts) {
    const match = part.match(/^SHA-256=(.+)$/i);
    if (match) {
      const providedHash = match[1];
      const computedHash = crypto.createHash('sha256').update(body, 'utf8').digest('base64');

      try {
        return crypto.timingSafeEqual(
          Buffer.from(providedHash, 'base64'),
          Buffer.from(computedHash, 'base64')
        );
      } catch {
        return false;
      }
    }
  }

  console.warn('[HttpSignatureService] No SHA-256 digest found in Digest header');
  return false;
}








export function parseSignatureHeader(signatureHeader: string): SignatureHeader | null {
  if (!signatureHeader) {
    return null;
  }

  const pattern = /keyId="([^"]+)",\s*algorithm="([^"]+)",\s*headers="([^"]+)",\s*signature="([^"]+)"/;
  const match = signatureHeader.match(pattern);

  if (!match) {
    console.error('[HttpSignatureService] Invalid Signature header format');
    return null;
  }

  const [, keyId, algorithm, headers, signature] = match;

  return {
    keyId,
    algorithm: algorithm.toLowerCase(),
    headers: headers.split(/\s+/),
    signature
  };
}




export async function getPublicKey(keyId: string): Promise<PublicKeyInfo | null> {
  const actorUri = keyId.split('#')[0];
  const cachedKey = getCachedPublicKey(keyId);
  const config = getActivityPubConfig();

  if (cachedKey && cachedKey.id === keyId && cachedKey.owner === actorUri && !isKeyExpired(cachedKey)) {
    return cachedKey;
  }

  try {
    const response = await publicFederationFetch(actorUri, {
      headers: {
        'Accept': 'application/activity+json'
      },
      signal: AbortSignal.timeout(config.federationTimeout)
    });

    if (!response.ok) {
      console.error(`[HttpSignatureService] Failed to fetch actor: ${response.status}`);
      return null;
    }

    const actor = await response.json();
    const publicKeyPem = extractPublicKeyFromActor(actor, keyId);

    if (!publicKeyPem) {
      console.error('[HttpSignatureService] Public key not found in actor');
      return null;
    }

    const keyInfo: PublicKeyInfo = {
      id: keyId,
      owner: actorUri,
      publicKeyPem,
      cachedAt: Date.now(),
      ttl: config.actorKeyCacheTtl * 1000
    };

    cachePublicKey(keyId, keyInfo);

    return keyInfo;
  } catch {
    console.error('[HttpSignatureService] Failed to fetch or validate actor key');
    return null;
  }
}





function extractPublicKeyFromActor(actor: any, keyId: string): string | null {
  const actorUri = keyId.split('#')[0];
  const publicKey = actor?.publicKey;
  if (actor?.id === actorUri && publicKey?.id === keyId &&
      publicKey.owner === actorUri && typeof publicKey.publicKeyPem === 'string' &&
      publicKey.publicKeyPem.length > 0) {
    return publicKey.publicKeyPem;
  }

  return null;
}




export async function verifyHttpSignature(
  request: Request,
  signatureHeader: string
): Promise<boolean> {
  const signature = parseSignatureHeader(signatureHeader);

  if (!signature) {
    console.error('[HttpSignatureService] Failed to parse Signature header');
    return false;
  }

  if (signature.algorithm !== 'rsa-sha256' && signature.algorithm !== 'hs2019') {
    console.error(`[HttpSignatureService] Unsupported algorithm: ${signature.algorithm}`);
    return false;
  }

  const keyInfo = await getPublicKey(signature.keyId);

  if (!keyInfo) {
    console.error('[HttpSignatureService] Failed to get public key');
    return false;
  }

  const signatureString = buildSignatureString(request, signature.headers);

  const verifier = crypto.createVerify('SHA256');
  verifier.update(signatureString, 'utf8');

  const isValid = verifier.verify(
    keyInfo.publicKeyPem,
    Buffer.from(signature.signature, 'base64')
  );

  if (isValid) {
    console.log(`[HttpSignatureService] Signature verified for ${signature.keyId}`);
  } else {
    console.error(`[HttpSignatureService] Signature verification failed for ${signature.keyId}`);
  }

  return isValid;
}

export type VerifyFailureReason =
  | 'missing-signature-header'
  | 'unparseable-signature-header'
  | 'unsupported-algorithm'
  | 'public-key-unavailable'
  | 'signature-mismatch'
  | 'digest-mismatch'
  | 'missing-digest-for-body'
  | 'date-out-of-window';

export interface VerifyResult {
  ok: boolean;
  keyId: string | null;
  reason: VerifyFailureReason | null;
}

export interface VerifyOptions {

  request: Request;

  rawBody?: string;

  publicKeyResolver?: (keyId: string) => Promise<PublicKeyInfo | null> | PublicKeyInfo | null;

  clockSkewSeconds?: number;
}




export async function verify(options: VerifyOptions): Promise<VerifyResult> {
  const { request, rawBody, publicKeyResolver, clockSkewSeconds = 3600 } = options;
  const signatureHeader = request.headers.get('signature');

  if (!signatureHeader) {
    return { ok: false, keyId: null, reason: 'missing-signature-header' };
  }

  const signature = parseSignatureHeader(signatureHeader);

  if (!signature) {
    return { ok: false, keyId: null, reason: 'unparseable-signature-header' };
  }

  if (signature.algorithm !== 'rsa-sha256' && signature.algorithm !== 'hs2019') {
    return { ok: false, keyId: signature.keyId, reason: 'unsupported-algorithm' };
  }

  if (signature.headers.includes('digest')) {
    const digestHeader = request.headers.get('digest');

    if (!digestHeader) {
      return { ok: false, keyId: signature.keyId, reason: 'missing-digest-for-body' };
    }

    if (rawBody !== undefined && !verifyDigest(rawBody, digestHeader)) {
      return { ok: false, keyId: signature.keyId, reason: 'digest-mismatch' };
    }
  }

  if (signature.headers.includes('date')) {
    const dateHeader = request.headers.get('date');

    if (dateHeader) {
      const parsed = Date.parse(dateHeader);

      if (!Number.isNaN(parsed)) {
        const skew = Math.abs(Date.now() - parsed) / 1000;

        if (skew > clockSkewSeconds) {
          return { ok: false, keyId: signature.keyId, reason: 'date-out-of-window' };
        }
      }
    }
  }

  const resolver = publicKeyResolver ?? getPublicKey;
  const keyInfo = await resolver(signature.keyId);

  if (!keyInfo) {
    return { ok: false, keyId: signature.keyId, reason: 'public-key-unavailable' };
  }

  const signatureString = buildSignatureString(request, signature.headers);
  const verifier = crypto.createVerify('SHA256');
  verifier.update(signatureString, 'utf8');

  let isValid = false;

  try {
    isValid = verifier.verify(
      keyInfo.publicKeyPem,
      Buffer.from(signature.signature, 'base64')
    );
  } catch {
    isValid = false;
  }

  return {
    ok: isValid,
    keyId: signature.keyId,
    reason: isValid ? null : 'signature-mismatch',
  };
}




function buildSignatureString(request: Request, headers: string[]): string {
  const lines: string[] = [];

  for (const header of headers) {
    if (header === '(request-target)') {
      const url = new URL(request.url);
      const method = request.method.toLowerCase();
      const path = url.pathname + url.search;
      lines.push(`(request-target): ${method} ${path}`);
    } else {
      const value = request.headers.get(header);
      if (value !== null) {
        lines.push(`${header}: ${value}`);
      }
    }
  }

  return lines.join('\n');
}








export function signRequest(
  method: string,
  url: string,
  privateKeyPem: string,
  keyId: string,
  headers: string[] = DEFAULT_SIGNATURE_HEADERS,
  headerValues: Record<string, string> = {}
): string {
  const parsedUrl = new URL(url);
  const signatureString = buildSignatureStringForSigning(
    method,
    parsedUrl,
    headers,
    headerValues
  );

  const signer = crypto.createSign('SHA256');
  signer.update(signatureString, 'utf8');

  const signature = signer.sign(privateKeyPem, 'base64');

  const signatureHeader = [
    `keyId="${keyId}"`,
    `algorithm="${SIGNATURE_ALGORITHM}"`,
    `headers="${headers.join(' ')}"`,
    `signature="${signature}"`
  ].join(',');

  return signatureHeader;
}




function buildSignatureStringForSigning(
  method: string,
  url: URL,
  headers: string[],
  headerValues: Record<string, string> = {}
): string {
  const lines: string[] = [];

  for (const header of headers) {
    if (header === '(request-target)') {
      const path = url.pathname + url.search;
      lines.push(`(request-target): ${method.toLowerCase()} ${path}`);
    } else if (header === 'host') {
      lines.push(`host: ${url.host}`);
    } else if (header === 'date') {
      const dateValue = headerValues['date'] || new Date().toUTCString();
      lines.push(`date: ${dateValue}`);
    } else if (header === 'digest') {
      const digestValue = headerValues['digest'];
      if (digestValue) {
        lines.push(`digest: ${digestValue}`);
      } else {
        console.warn('[HttpSignatureService] Digest header requested but no value provided');
      }
    } else if (header === 'content-type') {
      const contentTypeValue = headerValues['content-type'] || 'application/activity+json';
      lines.push(`content-type: ${contentTypeValue}`);
    } else {
      const value = headerValues[header.toLowerCase()];
      if (value) {
        lines.push(`${header.toLowerCase()}: ${value}`);
      }
    }
  }

  return lines.join('\n');
}




export async function createSignedRequest(
  method: string,
  url: string,
  privateKeyPem: string,
  keyId: string,
  body?: unknown,
  includeDigest: boolean = ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())
): Promise<Request> {
  const parsedUrl = new URL(url);
  const dateValue = new Date().toUTCString();
  const config = getActivityPubConfig();

  const requestHeaders: Record<string, string> = {
    'Date': dateValue,
    'Host': parsedUrl.host,
    'Content-Type': 'application/activity+json',
    'Accept': 'application/activity+json'
  };

  let bodyString: string | undefined;
  let digestValue: string | undefined;
  const headerValues: Record<string, string> = {
    'date': dateValue
  };

  if (body) {
    bodyString = JSON.stringify(body);

    if (includeDigest) {
      digestValue = generateDigest(bodyString);
      requestHeaders['Digest'] = digestValue;
      headerValues['digest'] = digestValue;
    }
  }

  const signatureHeaders = (includeDigest && digestValue)
    ? DEFAULT_SIGNATURE_HEADERS_WITH_DIGEST
    : DEFAULT_SIGNATURE_HEADERS;

  const signatureHeader = signRequest(
    method,
    url,
    privateKeyPem,
    keyId,
    signatureHeaders,
    headerValues
  );

  requestHeaders['Signature'] = signatureHeader;

  const requestInit: RequestInit = {
    method,
    headers: requestHeaders,
    signal: AbortSignal.timeout(config.federationTimeout)
  };

  if (bodyString) {
    requestInit.body = bodyString;
  }

  return new Request(url, requestInit);
}





function cachePublicKey(keyId: string, keyInfo: PublicKeyInfo): void {
  ensurePublicKeysCacheDir();
  const cacheKey = getCacheKey(keyId);
  const cachePath = join(getPublicKeysCacheDir(), `${cacheKey}.json`);

  writeFileSync(cachePath, JSON.stringify(keyInfo, null, 2), 'utf-8');
}

function getCachedPublicKey(keyId: string): PublicKeyInfo | null {
  ensurePublicKeysCacheDir();
  const cacheKey = getCacheKey(keyId);
  const cachePath = join(getPublicKeysCacheDir(), `${cacheKey}.json`);

  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const content = readFileSync(cachePath, 'utf-8');
    return JSON.parse(content) as PublicKeyInfo;
  } catch (err) {
    console.error(`[HttpSignatureService] Failed to read cached key:`, err);
    return null;
  }
}

function isKeyExpired(keyInfo: PublicKeyInfo): boolean {
  const now = Date.now();
  const keyAge = now - keyInfo.cachedAt;

  return keyAge > keyInfo.ttl;
}

function getCacheKey(keyId: string): string {
  const [actorUri] = keyId.split('#');

  return actorUri
    .replace(/^https?:\/\//, '')
    .replace(/[^\w.-]/g, '_');
}




export function cleanupExpiredKeys(): void {
  const cacheDir = getPublicKeysCacheDir();
  if (!existsSync(cacheDir)) {
    return;
  }

  const files = readdirSync(cacheDir).filter(file => file.endsWith('.json'));

  for (const file of files) {
    try {
      const cachePath = join(cacheDir, file);
      const content = readFileSync(cachePath, 'utf-8');
      const keyInfo = JSON.parse(content) as PublicKeyInfo;

      if (isKeyExpired(keyInfo)) {
        unlinkSync(cachePath);
        console.log(`[HttpSignatureService] Cleaned up expired key: ${file}`);
      }
    } catch (err) {
      console.error(`[HttpSignatureService] Failed to cleanup key ${file}:`, err);
    }
  }
}




export function clearKeyCache(): void {
  const cacheDir = getPublicKeysCacheDir();
  if (!existsSync(cacheDir)) {
    return;
  }

  const files = readdirSync(cacheDir).filter(file => file.endsWith('.json'));

  for (const file of files) {
    try {
      const cachePath = join(cacheDir, file);
      unlinkSync(cachePath);
    } catch (err) {
      console.error(`[HttpSignatureService] Failed to delete key ${file}:`, err);
    }
  }

  console.log('[HttpSignatureService] Cleared all cached keys');
}
