# ActivityPub GF v4 qualification: inert source preparation

Started 2026-09-20 and updated 2026-09-22, this is source preparation for the canonical
ActivityPub package, not enrollment, activated CI, remote execution proof,
publication, or application rollout. It follows the auth source pattern at
`67af1d39572f9eca1d2660e1c2df533fa6c76827` without importing auth-specific gates.
The coordinated AP/network source baseline is
`458efbe4fd98f1635ba4d92beeb2f09fffdcf045`.

## Existing actions, exact released contract

`.github/lanes.json` declares ActionPlan/v4 schema 3 with two status-only actions:

| Action | Existing Bazel command and target | Scope |
| --- | --- | --- |
| `unit-tests` | `test //:test //:package_artifact_test` | Executes Vitest and the actual Bazel package artifact check |
| `package-check` | `build //:pkg` | Builds the package and its TypeScript/declaration dependency |

Both request only abstract `rbe-linux-x86_64` capability. This package has no
`//:typecheck` target: `//:pkg` depends on the existing `//:tinyland_activitypub`
TypeScript target. Building a test target is not running its tests, so the
first action explicitly uses `test`. The test glob includes the custody,
personal-origin, network-safety, version-parity and qualification-contract
tests. These remain real package tests after provider retirement.

The inert caller is `docs/gf-v4-qualification.candidate.yml`, outside
`.github/workflows/`. It now pins released ci-templates v5.1.1 source
`ae836d8400d5784d74af4fecc020f225d1c2d08e`, not unreleased main:

`xoxd-ai/ci-templates/.github/workflows/spoke-ci-v4.yml@ae836d8400d5784d74af4fecc020f225d1c2d08e`

The initial preparation used v5.1.0 source
`32e39ced0008edf4564ebeb173a5e8fbf069e28f`. Its historical schema/lock diagnostic
receipts below are retained as history, not silently relabeled for this pin.

The candidate selects main pushes and same-repository PRs into main, with only
`contents: read` and `id-token: write`. It supplies no provider, runner,
endpoint, tenant, credentials, repository identity or caller-built binding.
The released template selects the exact push revision or PR head, not a
synthetic merge revision. Status-only results do not export package files,
create a qualified-result directory, or authorize publication.

## Preserve release authority

At the inert-preparation baseline, active `ci.yml` and `publish.yml`,
dependency/version pins and package scope were unchanged. Canonical main and
release v0.3.1 remained
`040fa65828160d237e603b117741329811806c52`. `package.json` and `MODULE.bazel`
were 0.3.1; `BUILD.bazel` already declared npm_package version 0.3.0 at that
release. Inert preparation recorded rather than repaired that drift. The
subsequent [source candidate](launch-candidate-0.3.3.md) now selects provisional
0.3.3: another source line published 0.3.2 before this branch was released.
The metadata declarations are aligned and the released API integration is
prepared in source; qualification remains pending. No existing tag or registry
entry is rewritten.

TIN-89 now makes BCR the sole first-party delivery authority. This branch
removes both legacy provider-capable workflow files (`ci.yml`, `publish.yml`)
and npm `publishConfig`; it does not merely omit one credential or assume
`npm_publish_mode: disabled` also disables GitHub Packages. Provider occupancy,
credentials and npm/GitHub Packages publication are not release gates.

The existing migration references are `xoxd-ai/tinyland-color-utils#11` at
`56d9ee2aea6d377cd6f5cfe5042e1e4d0f8c6e71`, `xoxd-ai/vite-plugin-a11y#11` and
`xoxd-ai/vite-plugin-skeleton-colors#9`. Reuse their provider retirement and
BCR-only authority shape, not their unqualified canary caller as a new active
workflow. This branch has no active replacement while the released/admitted
GF contract is being reconciled. Absence of CI is not a green result; no
no-op job or legacy fallback substitutes for qualification.

This plan is not full release validation. Actual `test //:test` and
`build //:pkg` retain unit/contract execution and TypeScript declarations.
`test //:package_artifact_test` checks the real `//:pkg` runfiles directory,
source/artifact manifest and export parity, every declared ESM/declaration
file, and the already locked third-party `publint` 0.3.18 validator. It uses
`pack: false, strict: false`: no second package-manager pack, errors-only
failure, and visible warnings. Its source/runfiles contract is guarded by
`//:test`; no generated declarations or built package are assumed from source.
The package explicitly sets `publishable = False`, without changing its
consumer manifest to private or introducing a publisher.

Qualified execution of these finite targets, an external consumer proof and
append-only BCR registration remain required. Existing CI results cannot be
relabeled as qualified v4 evidence or used as a fallback for refused admission.

## Local preparation and module lock

The source-bound `MODULE.bazel.lock` must contain real dependency-resolution
bytes for this package. AP pins Bazel 8.1.1; no other repository's lock,
placeholder, ignored local copy or digest alone closes that prerequisite.
Any separately authorized dependency-resolution refresh must use the managed
Bazel launcher, `mod deps --lockfile_mode=update`, followed by an `error`
replay. The provider-retirement pass is static-only and runs neither command.
Dependency resolution is not a Bazel build/test or a Linux remote-closure
receipt.

The focused contract test reads the plan, candidate, target declarations and
active workflows. Its Bazel data includes both `.github/workflows/*.yml` and
`*.yaml` globs, so a newly added active caller cannot disappear from runfiles.
These tests check source inertness, not provider installation or execution.

Validate with the exact released `scripts/manifest-schema-validate.py`, its
`schemas/lanes.schema.json`, and a Python that imports the real `jsonschema`
engine. Use explicit schema and manifest arguments, not the repository-manifest
`--schemas-dir` router. Released schema SHA-256:
`4fef58645b8cd367a4336a66eaee629388c8a949a06d85becc97cfc1be82e3b8`.
Released validator SHA-256:
`759f343aadf815a665b6c8319fbc92015a21ea4cf647b1e549f50d3c12b22468`.

At the inert-preparation baseline, the managed launcher reported Bazel 8.1.1
and completed
`bazel --batch mod deps --lockfile_mode=update` with exit 0. An immediate
`--lockfile_mode=error` replay also exited 0 and preserved the lock SHA-256:
`9a92b628f7473cf169e494a961bc3758c6267fc11dec60ec5ed0f5e775ad490c`.
The generated lock is format 18, with 326 registry-file entries from the Bazel
Central Registry and the configured Tinyland registry. Inspection found no
local filesystem paths/URLs, loopback endpoints, URL credentials or nonempty
credential fields. The real lock is now tracked; its ignore entry was removed.
Both invocations were dependency-only on Darwin, with no build/test actions.
That receipt predates the 0.3.3 metadata candidate; candidate lock refresh and
replay must be recorded separately rather than inheriting this baseline hash.

At that historical baseline, the action plan passed the exact released schema
and validator above using the full `jsonschema` engine. The focused
inert-qualification suite passed locally: one file, four tests. Those tests
have since changed to assert provider retirement and have not been rerun in
the static-only pass. `git diff --check` passed. The baseline diagnostics
establish
source/lock readiness only, not installation, a Linux remote closure, provider
admission, execution, cache-hit attribution, publication or rollout. No Bazel
build/test, GF dispatch, secret mutation or infrastructure action occurred.

The v5.1.1 candidate pin has been reconciled to released source, not installed
owner admission. Verify the exact installed owner/ref/workflow policy before
activating a replacement. Neither a released pin nor a previously valid source
schema establishes admission.

## Activation is a separate owner-reviewed transaction

Do not move the caller into `.github/workflows/` or dispatch it until the GF
rollout owner verifies the current installed contract, including:

- Organization-owned App installation and signed OwnerInstallation/v1,
  TenantOverlay/v1, consumer revocations and admitted workflow/ref/event policy.
  Admit the renamed workflow identity explicitly; a GitHub redirect is not proof.
- Current installed client, independent provider/verifier receipts, provider
  supply/revocations, joined ResolvedOwnerSupplyCatalog/v1 and eligible workers.
- Genuine Actions OIDC and independent App PR admission where applicable; a
  resolver-bound exact repository/source, raw action plan, module lock, installed
  Bazel digest and provider-selected closure. No fabricated local binding.
- Remote Execute or authenticated cache-hit evidence with measurement
  attribution for both actions, distinguishing execution from cache reuse.
  Green Actions status or runner pickup alone is insufficient.

Adding an active caller can itself schedule work on a PR. Lack of runner pickup
does not make that change inert. Package export/publication and mothership
rollout remain separate; this preparation grants neither.
