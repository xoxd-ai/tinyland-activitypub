# ActivityPub GF v4 qualification: inert source preparation

As of 2026-09-20, this is qualification source preparation for the canonical
ActivityPub package, not enrollment, activated CI, remote execution proof,
publication, or application rollout. It follows the auth source pattern at
`67af1d39572f9eca1d2660e1c2df533fa6c76827` without importing auth-specific gates.
The coordinated AP/network source baseline is
`458efbe4fd98f1635ba4d92beeb2f09fffdcf045`.

## Existing actions, exact released contract

`.github/lanes.json` declares ActionPlan/v4 schema 3 with two status-only actions:

| Action | Existing Bazel command and target | Scope |
| --- | --- | --- |
| `unit-tests` | `test //:test` | Executes the package's Vitest test target |
| `package-check` | `build //:pkg` | Builds the package and its TypeScript/declaration dependency |

Both request only abstract `rbe-linux-x86_64` capability. This package has no
`//:typecheck` target: `//:pkg` depends on the existing `//:tinyland_activitypub`
TypeScript target. Building a test target is not running its tests, so the
first action explicitly uses `test`. The test glob includes the custody,
personal-origin, network-safety and qualification-contract tests.

The inert caller is `docs/gf-v4-qualification.candidate.yml`, outside
`.github/workflows/`. It pins released ci-templates v5.1.0 source
`32e39ced0008edf4564ebeb173a5e8fbf069e28f`, not unreleased main or v5.1.1:

`xoxd-ai/ci-templates/.github/workflows/spoke-ci-v4.yml@32e39ced0008edf4564ebeb173a5e8fbf069e28f`

The candidate selects main pushes and same-repository PRs into main, with only
`contents: read` and `id-token: write`. It supplies no provider, runner,
endpoint, tenant, credentials, repository identity or caller-built binding.
The released template selects the exact push revision or PR head, not a
synthetic merge revision. Status-only results do not export package files,
create a qualified-result directory, or authorize publication.

## Preserve release authority

Active `ci.yml` and `publish.yml`, dependency/version pins and package scope are
unchanged. As of preparation, canonical main and release v0.3.1 remain
`040fa65828160d237e603b117741329811806c52`. `package.json` and `MODULE.bazel`
remain 0.3.1; `BUILD.bazel` already declared npm_package version 0.3.0 at that
release. This pre-existing drift is recorded, not silently repaired or treated
as a new release. Version selection, collision checks and BCR registration are
separate release work.

This plan is not full publication validation. Preserve the existing publish
lane's typecheck, test, build and package-check commands; `//:pkg` does not
replace `publint`, release metadata review, artifact qualification or registry
registration. Existing CI results cannot be relabeled as qualified v4 evidence
or used as a fallback for refused admission.

## Local preparation and module lock

The source-bound `MODULE.bazel.lock` must contain real dependency-resolution
bytes for this package. AP pins Bazel 8.1.1; no other repository's lock,
placeholder, ignored local copy or digest alone closes that prerequisite.
Only the existing managed Bazel launcher may perform the dependency-only
`mod deps --lockfile_mode=update` diagnostic, followed by an `error` replay.
Neither command is a Bazel build/test or a Linux remote-closure receipt.

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

The managed launcher reported Bazel 8.1.1 and completed
`bazel --batch mod deps --lockfile_mode=update` with exit 0. An immediate
`--lockfile_mode=error` replay also exited 0 and preserved the lock SHA-256:
`9a92b628f7473cf169e494a961bc3758c6267fc11dec60ec5ed0f5e775ad490c`.
The generated lock is format 18, with 326 registry-file entries from the Bazel
Central Registry and the configured Tinyland registry. Inspection found no
local filesystem paths/URLs, loopback endpoints, URL credentials or nonempty
credential fields. The real lock is now tracked; its ignore entry was removed.
Both invocations were dependency-only on Darwin, with no build/test actions.

The action plan passed the exact released schema and validator above using the
full `jsonschema` engine. The focused inert-qualification suite passed locally:
one file, four tests. `git diff --check` passed. These diagnostics establish
source/lock readiness only, not installation, a Linux remote closure, provider
admission, execution, cache-hit attribution, publication or rollout. No Bazel
build/test, GF dispatch, secret mutation or infrastructure action occurred.

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
