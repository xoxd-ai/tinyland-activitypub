# Released 0.3.2 compatibility integration — source prepared, not qualified

## Exact collision

Published tag `v0.3.2` is `ad310df116875d5f0963c4585dce12577c4b9deb`.
Canonical main was `6a15b7289c00847db6b42c32375859af0d4540c4` at the
2026-09-22 read-only audit. The runtime delta from the tag to that main is
empty; those later commits change workflow policy only. The earlier held
source `e2104b81c3bfcf4e686bf348855eac004649e100` was based on 0.3.1 and could
not safely replace 0.3.2 unchanged. The compatibility patch was recorded in
`9dcf42599c0a77f4faa240577f806cb92906595b`; local ancestry reconciliation now
merges that candidate with exact main `6a15b7289c00847db6b42c32375859af0d4540c4`.
No local execution, release or consumer adoption is claimed.

| Surface | Released 0.3.2 | Held owner-bound source before integration |
| --- | --- | --- |
| Config | `liveUserActorBaseUrl?: string` | `userActorBaseUrl?: string` |
| Origin helper | `getLiveUserActorBaseUrl()` in `src/config.ts` | `getUserActorBaseUrl()` and domain helper |
| Actor read | Second argument `{ useLiveUserActorBaseUrl?: boolean }` | Second argument `expectedOwnerId?: string` |
| Override effect | Explicit read only; generic URI/WebFinger helpers stay at site origin | Full personal-actor/collection/object/discovery helpers use personal origin |
| Custody | Unbound file record | Optional stable owner binding; activation and reads verify durable encrypted custody |

The released live-origin helper is not re-exported by `src/index.ts`; restore
its config-module function without claiming it was previously a root export.
The config property and service read option are part of the released surface.

## Prepared integration

1. Retain both config properties with distinct meanings. Restore
   `getLiveUserActorBaseUrl()` exactly as `liveUserActorBaseUrl ?? siteBaseUrl`.
   Do not make the released live option implicitly change generic URI helpers,
   WebFinger, object attribution or default broker reads. The new
   `userActorBaseUrl` remains an explicit whole-personal-authority opt-in.
2. Extend the actor read argument to accept the released options object or the
   owner-ID string used by this branch. An options type can add
   `expectedOwnerId?: string` alongside `useLiveUserActorBaseUrl?: boolean` so
   a caller can request both checks. Normalize either argument once; malformed
   or empty owner IDs still reject rather than silently omitting validation.
3. Preserve released unbound reads: omitted/false live option uses site origin;
   true uses the live-origin helper. Keep the existing Jess/operator unbound
   public-record exception; this path must not enroll, decrypt, rotate or
   silently claim its custody. Pass the selected base to actor rendering so
   all derived actor/key/collection URLs agree.
4. Owner-bound reads remain canonical, not alternate views. Verify stored
   owner, encrypted envelope, RSA key match and personal actor/key IDs before
   rendering. The string owner argument or a matching options owner ID must
   perform the same check. An explicit live-origin request must equal the
   stored canonical origin or reject; it can never re-anchor an owned actor.
   An omitted/false live option does not demote a bound actor to broker origin.
5. Leave activation, key reads/deletion, encryption precedence and in-process
   serialization unchanged. No live option can adopt an unbound actor, bypass
   an owner mismatch, expose invalid custody or alter retention obligations.

The implementation is source-only and still requires review and qualified
tests. It does not reserve or publish 0.3.3, migrate identities, or authorize
app changes.

## Local merge resolution and upstream coverage

- `src/config.ts` and `src/services/ActorService.ts` retain the reviewed
  compatibility implementation from `9dcf425` byte-for-byte: the released
  config/getter/read option plus distinct personal-authority and owner checks.
  Auto-merge's duplicate getter and misplaced legacy rendering block were
  removed during resolution, not left as competing implementations.
- `tests/apex-ap-leak.test.ts` retains the exact upstream blob, including its
  three default/explicit-live/fallback cases. The separate new compatibility
  and owner-integrity suites remain intact; none were executed locally.
- `package.json` adopts upstream's renamed repository/homepage/bugs URLs and
  keeps candidate 0.3.3 with no `publishConfig`. The metadata regression now
  guards those canonical URLs. Root MODULE and Bazel `pkg` remain 0.3.3.
- Modify/delete conflicts for both legacy workflows resolve to deletion;
  their v3.2.1 calls and provider capabilities are not restored. The released
  v5.1.1 candidate remains inert pending admission.
- No dependency or lock bytes change. A signed two-parent commit establishes
  ancestry only; actual qualified tests/artifact checks and lock refresh/replay
  remain required for the integrated candidate.

## App adoption delta to coordinate

Inspected candidate: `tinyland.dev.worktrees/tin-4435-mothership-image-20260919`.
The coordinating app owner has prepared the origin/registry edits below and
an explicit default-vs-live regression in source; they were reviewed by diff,
not executed. Consumer pins remain unchanged pending canonical qualification.

- `src/hooks.server.ts:154` now sets `liveUserActorBaseUrl` and
  `userActorBaseUrl` to the same already-computed mothership origin and retains
  `siteBaseUrl` at the broker origin. This avoids changing an identity hostname.
- `src/lib/activitypub/liveUserActorRegistry.ts:65` and `:181` now use the
  explicit released live option for Jess so a stored legacy record and the
  existing environment-only fallback agree. Other users retain the fresh
  owner-ID string argument, with no reduction in binding checks.
- The ActorService shim re-exports canonical reads: do not duplicate the
  overload or origin logic there. Member settings activation, worker owner
  reads and key custody calls do not otherwise require signature changes.
- `src/routes/@[handle]/+page.server.ts:44` and `+layout.server.ts:62` also
  call the generic actor read without an owner ID. Confirm their intended
  presentation origin and existing privacy guards before altering them;
  switching every generic call to a live view would violate released broker
  semantics. Route authorization is not supplied by a custody read option.
- Update affected mocks/config fixtures in `live-user-actor-webfinger`,
  `live-author-origin-custody`, `content-negotiation`, `pulse-delivery-worker`
  and `follow-approval` tests. Pin adoption waits for the real canonical/BCR
  successor; no alias to this local worktree is release evidence.

## Required regression cases

- Preserve released 0.3.2's three actor-view cases: no option, explicit true,
  and true with no live origin; also explicit false and an empty options object.
- With only the released live config set, generic collection/object/WebFinger
  helpers and broker/brand/NodeInfo remain site-bound.
- With the full personal config set, new activation and personal projections
  stay coherent; setting both origin fields equally works without key rotation.
- Matching owner-ID string and options owner-ID return identical owned actors;
  wrong/empty owner IDs, malformed options, corrupt ciphertext and key mismatch
  reject under every read form.
- Live-option origin differing from bound canonical identity rejects without
  any write; matching live origin returns the same actor/key IDs.
- Legacy unbound Jess public stubs remain readable with explicit live view,
  but neither options nor owner strings can adopt them into self-service.
- Existing idempotence, durability/readback failure, double-encryption,
  no-reanchor, tombstone retention and network-guard regressions remain intact.
- App environment-only and stored Jess actor identity/key checks agree, member
  owner checks remain fresh, and private/non-opted-in users remain undiscoverable.

Run these through the admitted qualified `//:test` path after integration.
No local test/build, Bazel, live discovery or peer request is part of this plan.
