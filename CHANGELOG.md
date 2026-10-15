# Changelog

## 1.0.0 — 2026-10-14

Major release under rulings RU1, RU5, RU10 and RU13 (estate stack uplift),
which also absorbs the retired `tummycrypt_tinyland_offer_builder` module
(`@tummycrypt/tinyland-offer-builder`, standalone repo
`xoxd-ai/tinyland-offer-builder`, archived) under RU2/RU7. The ActivityPub
API is unchanged from 0.3.3: every existing export, subpath and signature is
the same, and `./offer-builder` is new. The build toolchain and the
first-party Bazel dependency move, so this is the RU10 major. A 0.4.0 was
prepared with the offer-builder merge alone and never tagged or registered;
it is folded into this release. Released as a signed GitHub tag `v1.0.0` plus
an append-only bazel-registry entry; the Bazel module
`tummycrypt_tinyland_activitypub` is the only distribution path (RU6), and the
package is now `private` and is not published to npm or GitHub Packages (RU8).

### Changed

- TypeScript 7.0.2 (the native compiler) builds and type-checks the package.
  `typescript` (7.0.2), `vite` (8.3.3) and `vitest` (5.0.3) are pinned exactly
  (RU5). `@fast-check/vitest` ^0.5.0 and `publint` ^0.3.25 follow the vitest 5
  line. The `prepublishOnly` script is removed (RU8).
- `tsconfig.json` sets `types: ["node"]`, because TypeScript 6 and later no
  longer load every `@types/*` package by default.
- MODULE.bazel: `aspect_rules_ts` 3.10.1 with the `typescript` extension at
  7.0.2 (replacing the `ext` extension at 5.9.3), and
  `tummycrypt_tinyland_content_types` re-pinned from 0.2.4 to 1.0.0 (its own
  RU1 major).
- New `//:typecheck` target (no emit). CI runs it next to `//:pkg`, `//:test`
  and `//:package_artifact_test`.
- `.bazelrc` resolves in-house modules from `xoxd-ai/bazel-registry`.

### Migration (all consumers)

- Re-pin `bazel_dep(name = "tummycrypt_tinyland_activitypub", version = "1.0.0")`
  and drop any `single_version_override` that pins an older ActivityPub
  version. Root and existing subpath imports do not change.
- Consumers that still pin `tummycrypt_tinyland_content_types` below 1.0.0
  are raised to 1.0.0 by MVS (same `compatibility_level`); see the
  content-types 1.0.0 changelog for its visibility default.

### Added

- `./offer-builder` subpath export: the Schema.org `Offer` builder for
  ActivityPub commerce federation (`OfferBuilderService`,
  `offerBuilderService`, `TRANSACTION_MAPPINGS`, `getTransactionMapping`,
  `requiresExternalUrl`, `isMonetary`, `getSupportedTransactionTypes`,
  `configure`, `getConfig`, `resetConfig`, `noopTracer`, `noopSpan` and the
  `SchemaOffer`, `PriceSpecification`, `TransactionMapping`,
  `TransactionConfig`, `ValidationResult`, `ProductItem`, `OfferAvailability`,
  `PaymentMethod`, `Tracer`, `Span` and `OfferBuilderConfig` types). The
  sources are the tinyland.dev monorepo copy (0.2.2), byte-identical, with its
  test suite.
- It is not re-exported from the package root, because its `configure`,
  `getConfig` and type names would collide with existing root exports.

### Fixed (relative to offer-builder 0.2.0)

- GNU Taler is keyed as `taler`, not `talar`, in `TRANSACTION_MAPPINGS` and
  in the payment-method display labels, matching `TransactionType` in
  tinyland-content-types. The registry's 0.2.0 entry carried this as the
  `standalone-build-taler.patch` overlay; it is now in source.

### Migration from tummycrypt_tinyland_offer_builder 0.2.x

- Bazel: drop `bazel_dep(name = "tummycrypt_tinyland_offer_builder", ...)` and
  its `npm_link_package`; require `tummycrypt_tinyland_activitypub` 1.0.0.
- Imports: replace `@tummycrypt/tinyland-offer-builder` with
  `@tummycrypt/tinyland-activitypub/offer-builder`. The API is unchanged.
- Code that passes the transaction type `talar` must pass `taler`.

## 0.3.3 — 2026-10-07

Released under operator ruling RS2 as GitHub tag `v0.3.3` plus an append-only
bazel-registry entry; no npm or GitHub Packages publication. Consumer adoption
and runtime rollout are separate steps. See
[candidate scope](docs/launch-candidate-0.3.3.md) and
[activation/migration guidance](docs/actor-activation.md).
The earlier provisional 0.3.2 was superseded by an independently published
release. Its live-user actor option is preserved alongside the owner-bound API;
released tags and registry entries for 0.3.2 and earlier are unchanged.
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
- TIN-89 BCR-only delivery policy: npm `publishConfig` is removed and no
  provider publisher runs. Per operator ruling RS2 (2026-10-07) the `ci.yml`
  and `publish.yml` callers are kept as validation only: npm publishing is
  disabled, no GitHub Packages name is set, `publish.yml` drops its write
  permissions, and `ci.yml` now runs `bazel test //:test` and
  `//:package_artifact_test` instead of literal no-op steps. The GF caller
  remains inert until its released, admitted contract is reviewed.

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
