# Changelog

## 0.3.3 — Unreleased candidate

Candidate source only; no tag, release, registry entry, consumer adoption or
runtime rollout is implied. See [candidate scope](docs/launch-candidate-0.3.3.md)
and [activation/migration guidance](docs/actor-activation.md).
The earlier provisional 0.3.2 was superseded by an independently published
release. Its live-user actor option is now preserved alongside the owner-bound
API in source, pending qualified checks; no released tag or registry is changed.
The candidate also locally reconciles upstream main `6a15b728` ancestry,
retains the released regression cases and adopts the renamed package URLs.

### Added

- Optional personal-actor origin configuration, separate from broker/brand
  identity; omitting it preserves the configured site origin.
- Idempotent, stable-owner-bound personal actor activation with encrypted
  custody, atomic persistence, durable readback and RSA key-pair verification.
- Optional expected-owner checks for actor/key reads and actor deletion.
- Compatibility with 0.3.2's separate `liveUserActorBaseUrl` and per-read
  `useLiveUserActorBaseUrl` option, without changing generic broker semantics
  or allowing a live view to re-anchor owner-bound custody.
- A bounded public HTTPS federation transport that pins validated DNS results,
  rejects redirects/private destinations and supports a final pre-send check.
- Inert GF v4 qualification source and a real dependency-resolution lock;
  qualification is not activated by these files.
- A regression check aligning package, root Bazel module and package-target
  versions. Candidate metadata repairs the pre-existing BUILD version drift.
- A finite Bazel artifact test for the actual `//:pkg` directory, all declared
  ESM/declaration exports, manifest parity and locked `publint` without a second
  package-manager pack. Only errors fail; warnings remain visible.
- TIN-89 BCR-only delivery policy: remove legacy provider-capable CI/publish
  callers and npm `publishConfig`. The GF caller remains inert until its
  released, admitted contract is reviewed; no replacement publisher or
  green/no-op validation workflow is introduced.

### Fixed and constrained

- Reusing encrypted custody no longer encrypts ciphertext a second time;
  first creation uses the canonical actor's `#main-key` identifier.
- Custody I/O, decryption and readback failures propagate instead of appearing
  to be successful enrollment or an absent actor eligible for replacement.
- Legacy unbound custody is not silently claimed by self-service activation;
  owner-bound identity cannot silently move to a different origin.
- Remote key documents must match the requested actor, key ID and key owner.
  Private-network/HTTP/redirected peers and mismatched key documents that were
  previously accepted are intentionally rejected.

Existing synchronous actor creation and default origin behavior remain
available. This is not a promise that every legacy data record, network peer
or error-handling assumption remains compatible. No distributed writer,
automatic identity migration, automatic key rotation or public-launch grant
is introduced.

## 0.3.2 — 2026-09-21 (independent published release)

Immutable tag source `ad310df116875d5f0963c4585dce12577c4b9deb` introduced
`liveUserActorBaseUrl` and the per-read `useLiveUserActorBaseUrl` option, with
organization URL/workflow updates. Active BCR 0.3.2 exists. This held branch
now preserves that runtime API alongside its owner-bound changes. This source
compatibility work has not yet been qualified against the released baseline.

## 0.3.1 — 2026-07-10

Previous published baseline: GitHub tag `v0.3.1`, source
`040fa65828160d237e603b117741329811806c52`. This changelog does not reconstruct
earlier release notes; the published tag/release and active registry remain
their authority.
