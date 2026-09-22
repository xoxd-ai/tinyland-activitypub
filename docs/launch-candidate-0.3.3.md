# ActivityPub 0.3.3 source candidate — qualification pending

## Scope and observed release state

This is canonical package source/version preparation, not publication or
runtime enablement. The reviewed source baseline is
`e2104b81c3bfcf4e686bf348855eac004649e100`, based on the older `v0.3.1` source
`040fa65828160d237e603b117741329811806c52`. The source-preparation approval is
TIN-2716 receipt `6d68fbe2-d37a-4ea3-8d80-2927dec2979b`.

The initial 2026-09-20 collision check is superseded. Read-only checks at
2026-09-22T01:54:18Z found published `v0.3.2` at
`ad310df116875d5f0963c4585dce12577c4b9deb` (published
2026-09-21T03:58:55Z), canonical main at
`6a15b7289c00847db6b42c32375859af0d4540c4`, and active BCR 0.3.2 under registry
commit `09d1f4f56be12bb0c52b2b40c88560ea6cefebac`. Its immutable source archive
integrity is `sha256-gVp44RkqYVOBBwpIC0d67JeVzyjVxRdtaUDfyaP5Um0=`.
Fresh tag/release and active-registry listings contain no 0.3.3. This makes
0.3.3 provisional, not reserved; repeat those checks before a release. Never
move, repack or overwrite the existing 0.3.2 release or registry entry.

TIN-89 makes BCR the sole first-party delivery authority. GitHub Packages and
npm occupancy, credentials and publication are not candidate or release gates.
Legacy artifacts may exist; this preparation neither queries nor deletes them.
GitHub tag/source integrity and an append-only BCR entry remain required.

`package.json`, the root `MODULE.bazel` version and `BUILD.bazel`'s `pkg`
version now agree on 0.3.3. At the branch's 0.3.1 base, package/module were 0.3.1
while BUILD declared 0.3.0; this candidate explicitly repairs that drift.
Package names, dependencies, compatibility level, registry configuration and
downstream pins are unchanged. The legacy provider-capable CI/publish callers
and npm `publishConfig` are removed; the released-pin GF candidate remains
outside `.github/workflows/`. There is no active replacement or no-op CI job.

## Released API integration

Released 0.3.2/main adds `liveUserActorBaseUrl` and
`getActorByHandle(handle, { useLiveUserActorBaseUrl: true })`; this branch had
added `userActorBaseUrl` and an owner-ID string in the same argument position.
Publishing that original source unchanged would have broken released callers.
The [bounded integration](released-0.3.2-integration-plan.md) now preserves
both config meanings and accepts the released options object or owner string.
It is prepared source, not a qualified compatibility receipt. New regression
cases have not been executed in this static-only pass.

The local ancestry reconciliation merges prepared candidate
`9dcf42599c0a77f4faa240577f806cb92906595b` with exact fetched main
`6a15b7289c00847db6b42c32375859af0d4540c4`. It includes the immutable released
0.3.2 lineage, preserves upstream's `xoxd-ai` repository/homepage/bugs URLs,
and retains all three upstream live-actor regression cases verbatim in
`tests/apex-ap-leak.test.ts`. Version conflicts retain 0.3.3; the two obsolete
provider workflows remain deleted under TIN-89. The reviewed runtime
compatibility implementation is unchanged by the merge resolution. This is
local source/history reconciliation, not executed compatibility proof; qualify
the resulting exact merge revision, not either historical parent.

## Compatibility and migration boundaries

- `userActorBaseUrl` is optional. Without it, personal identities continue to
  use `siteBaseUrl`; broker/brand and NodeInfo identities keep the site origin.
  Configuring a new personal origin is not an identity migration. Owner-bound
  records reject mismatched canonical actor/key IDs. Review legacy personal
  identities before changing this setting; do not assume old actor URLs,
  followers, signatures or queued deliveries follow a hostname change.
- Released `liveUserActorBaseUrl` remains a separate per-read legacy view.
  The actor-read options object and owner-ID string are both accepted; a live
  option cannot move an owner-bound actor to another origin. Unbound default
  reads remain site-bound, so the app's Jess path must request the live view
  explicitly and configure the two personal/live settings consistently.
- Existing synchronous `createActorFromUser` calls remain supported, but
  persistence errors now propagate. Owner-bound records require the matching
  stable principal ID for mutation; neither missing nor different owner IDs
  can overwrite them. Corrupt records and invalid key pairs fail closed.
- Self-service callers use `ensureActorForUser` with durable principal `id`,
  `handle`, `createdAt` and `updatedAt`. A successful retry preserves identity,
  keys and stored profile; it is not a profile update. Existing unbound
  records require an explicit migration and are never silently adopted.
  The existing operator/environment-custodied Jess actor remains on its
  separate application path, not a self-service migration target.
- The released AES-256-GCM `enc:` envelope remains supported. Effective secret
  precedence remains `ACTIVITYPUB_KEY_ENCRYPTION_KEY`, then
  `TOTP_ENCRYPTION_KEY`, then `AUTH_SECRET` (minimum 16 characters). No new
  dedicated secret is mandatory where a valid fallback exists. Adding a
  higher-priority secret changes the effective key: retain the previous key
  and perform explicit re-encryption before switching. No automatic rotation,
  lost-key recovery or double-encrypted-record repair is provided.
- Public actor reads do not create custody. Applications must use a fresh
  durable principal and enforce own-author grants, opt-in, visibility and
  lifecycle rules separately. Pass the expected owner ID to member actor/key
  reads and deletion; custody itself never grants publication permission.
  Preserve signing identity for pending tombstones and delivery obligations.
- Public federation transport now requires public HTTPS destinations, bounded
  bodies/timeouts and non-redirecting requests. It rejects private or mixed
  public/private DNS answers, ambient credentials and mismatched key/actor
  documents. These intentional security restrictions are not compatibility
  guarantees for arbitrary existing peers or internal HTTP test servers.

The supported launch shape remains one application process on the existing
retained filesystem. Atomic rename/readback and per-handle in-process
serialization do not establish cross-process or cross-node active-active
custody. No database, replacement CMS or storage migration is introduced.
See [actor activation](actor-activation.md) for exact APIs and custody rules.

## Validation and subsequent release work

The focused `tests/release-metadata.test.ts` checks version parity and is part
of the existing `//:test` glob; package, MODULE and BUILD inputs are included in
that target's runfiles. The metadata-preparation pass did not rerun tests,
builds or Bazel. Candidate diagnostics must refresh the actual tracked module
lock through an authorized managed Bazel 8.1.1 dependency-resolution path and
replay with `--lockfile_mode=error`; never hand-edit lock bytes. The present
pass permits static checks only, not local Bazel/build/test/Nix execution.
The prior 0.3.1 lock receipt does not qualify the 0.3.3 candidate. Dependency
resolution alone is not remote execution or publication proof.

The [inert GF qualification preparation](gf-v4-qualification-preparation.md)
still applies. No caller has moved into `.github/workflows/`. Qualifying the
exact candidate requires the existing owner-reviewed GF path for actual
`test //:test //:package_artifact_test` and `build //:pkg`, plus a clean external
`//:pkg` consumer. The artifact target checks the real Bazel package directory,
manifest/export parity, generated ESM/declarations and locked `publint` 0.3.18
with `pack: false, strict: false` (errors fail, warnings remain visible).
It does not invoke npm/pnpm packing, use local `dist`, add dependencies or
introduce a provider publisher. `npm_package` is explicitly non-publishable;
consumer manifest compatibility is preserved. Retiring the old publish workflow does
not turn its local tooling commands into remote proof or waive those checks.
Version preparation does not authorize remote actions, a signed release tag,
append-only BCR registration, app pin adoption or deployment. No npm/GitHub
Packages publisher is to be restored as a fallback.

The operator selected `https://mastodon.social/@xoxdai` as a future proof peer
(TIN-2416 receipt `8203f78c-a6f9-4be3-9fa9-b5247cae07a1`). That human-facing URL
has not been discovered or verified as an actor/inbox, and no peer traffic is
authorized or performed by this preparation. A real follow/delivery receipt
remains distinct from package source and local diagnostic readiness.
