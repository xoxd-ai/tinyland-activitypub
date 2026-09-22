# Personal actor activation and custody

Personal actors can use a different authority from broker/brand actors:

```ts
import { configureActivityPub } from '@tummycrypt/tinyland-activitypub';
import {
  ensureActorForUser,
  getActorByHandle,
  getActorPrivateKey,
} from '@tummycrypt/tinyland-activitypub/services';

configureActivityPub({
  siteBaseUrl: 'https://hub.example',
  userActorBaseUrl: 'https://members.example',
});

// First authorize the fresh principal, its own-author grant, and explicit opt-in.
const actor = await ensureActorForUser({
  id: principal.id, // Immutable principal ID, not a handle or email address.
  handle: principal.handle,
  displayName: principal.displayName,
  createdAt: principal.createdAt,
  updatedAt: principal.updatedAt,
});
// Only now may the application persist its activation/public-exposure flag.

// Pass the fresh principal ID when serving/signing for a member-owned actor.
getActorByHandle(principal.handle, principal.id);
getActorPrivateKey(principal.handle, principal.id);
```

Without `userActorBaseUrl`, personal identities retain the configured
`siteBaseUrl` behavior. Brand/group identities and NodeInfo retain the site
origin. Personal actor, collection, object, mention and WebFinger helpers use
the personal origin. Changing the origin of an already owner-bound actor is
not an automatic identity migration: activation and owner-aware reads fail
closed until an explicit migration is performed.

The released 0.3.2 setting `liveUserActorBaseUrl` has a separate, narrower
meaning: it selects the view for an unbound legacy actor only when a read uses
`getActorByHandle(handle, { useLiveUserActorBaseUrl: true })`. It falls back
to `siteBaseUrl`, not `userActorBaseUrl`; it does not change generic personal
URI helpers. Unbound reads without that option retain the broker/site view.
Applications that serve a legacy operator actor on the same origin as new
personal actors should explicitly configure both settings to that origin and
select the live view for the operator path.

Member reads accept either the owner-ID string shown above or
`{ expectedOwnerId: principal.id, useLiveUserActorBaseUrl: true }`. Both enforce
the same binding. Owner-bound records are never alternate-origin views: a live
option whose origin differs from persisted canonical identity rejects, even
if the owner ID matches. Omitting the option never bypasses key/custody checks.

## Successful activation

`ensureActorForUser` returns only after the actor record is persisted, flushed,
reread, decrypted, and its public/private RSA keys and canonical IDs verified.
The new actor defaults to private visibility. An existing record must already
have the same `ownerId`; retrying returns that custody without rewriting its
metadata or generating another key. Different-owner and unbound legacy records
are never adopted. An existing operator/environment-custodied actor remains
the application's explicit legacy path, not a self-service enrollment target.

Private keys retain the released AES-256-GCM `enc:` envelope. Configure
`ACTIVITYPUB_KEY_ENCRYPTION_KEY` (at least 16 characters); the legacy fallback
order remains `TOTP_ENCRYPTION_KEY`, then `AUTH_SECRET`. Losing or changing the
effective encryption secret makes existing custody unreadable. Retain that
secret with backups; changing it requires an explicit re-encryption migration.
Never log keys or envelopes. Read, decryption, write and readback errors are
failures, not missing actors eligible for replacement.

Persistence uses a mode-0600 temporary file in the actor directory, file flush,
atomic rename and directory flush. A failure after rename may leave valid
custody on disk but still rejects activation; retry verifies and flushes that
same record without rotation. The per-handle activation queue serializes only
one application process. This is not a distributed lock, multi-process writer
contract, cross-node filesystem guarantee, or storage-HA design.

## Application responsibilities

- Authorize activation, public discovery, content exposure and delivery from
  the current durable principal, explicit own-author grants and opt-in.
- Keep private users private. Actor custody itself is not a permission grant.
- Gate public GETs; never call a create/ensure operation to satisfy discovery.
- Restrict the backward-compatible `resolveUser` WebFinger fallback to users
  authorized for public discovery. It does not prove persisted custody.
- Pass `expectedOwnerId` to member actor/key reads and deletion. A legacy
  caller cannot overwrite or delete owner-bound custody without that identity.
- Preserve actor identity/custody for retained tombstones and pending delivery;
  do not interpret account removal as permission to discard those obligations.

The synchronous `createActorFromUser` API remains available for legacy callers
and explicit same-owner profile updates. It now propagates persistence errors,
decrypts existing ciphertext before re-encryption, verifies readback and uses
the canonical actor's `#main-key` ID immediately. Self-service activation must
use the owner-bound ensure API, not implicit legacy record adoption.

## Validation

`//:test` includes the activation and origin regression tests through the
existing test glob. `//:pkg` checks the published TypeScript surface.
`//:package_artifact_test` checks that actual package directory's manifest,
declared ESM/declaration files and locked `publint` results without repacking.
Remote GloriousFlywheel-backed package CI remains landing authority; local Vitest and
TypeScript runs are development diagnostics only.
