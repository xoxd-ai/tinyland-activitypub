import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readText = (path: string) => readFile(path, 'utf8');
const release = 'ae836d8400d5784d74af4fecc020f225d1c2d08e';
const candidatePath = 'docs/gf-v4-qualification.candidate.yml';
const activeWorkflows = async () => {
  try {
    return (await readdir('.github/workflows'))
      .filter((name) => /\.ya?ml$/.test(name)).sort();
  } catch (error) {
    // Git does not retain the empty directory after both legacy callers retire.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

describe('inert ActivityPub GF v4 qualification source', () => {
  it('requests actual tests and the existing package target, with status-only results', async () => {
    expect(JSON.parse(await readText('.github/lanes.json'))).toEqual({
      schema_version: 3,
      actions: {
        'unit-tests': {
          command: 'test',
          targets: ['//:test', '//:package_artifact_test'],
          capability: 'rbe-linux-x86_64',
          result: { mode: 'status-only' },
        },
        'package-check': {
          command: 'build',
          targets: ['//:pkg'],
          capability: 'rbe-linux-x86_64',
          result: { mode: 'status-only' },
        },
      },
    });
    const build = await readText('BUILD.bazel');
    expect(build).toMatch(/vitest_bin\.vitest_test\(\s*name = "test"/);
    expect(build).toMatch(/npm_package\(\s*name = "pkg"/);
    expect(build).toMatch(/ts_project\(\s*name = "tinyland_activitypub"/);
    expect(build).toContain('":tinyland_activitypub"');
  });

  it('pins only the released thin caller with no execution or publication overrides', async () => {
    const candidate = (await readText(candidatePath))
      .split('\n').filter((line) => !line.startsWith('#')).join('\n').trim();
    expect(candidate).toBe(`name: GF v4 qualification

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  qualify:
    if: >-
      github.event_name == 'push' ||
      github.event.pull_request.head.repo.full_name == github.repository
    strategy:
      fail-fast: false
      matrix:
        action: [unit-tests, package-check]
    uses: xoxd-ai/ci-templates/.github/workflows/spoke-ci-v4.yml@${release}
    with:
      action_name: \${{ matrix.action }}`);
  });

  it('keeps the caller inert and exposes all active workflow files to the test target', async () => {
    expect(await activeWorkflows()).toEqual([]);
    expect(await readText(candidatePath)).toContain('# INERT SOURCE CANDIDATE');
    const build = await readText('BUILD.bazel');
    expect(build).toContain('".github/workflows/*.yml"');
    expect(build).toContain('".github/workflows/*.yaml"');
  });

  it('retires provider capability without replacing it with a no-op validation lane', async () => {
    const packageJson = JSON.parse(await readText('package.json'));
    expect(packageJson).not.toHaveProperty('publishConfig');
    const candidate = await readText(candidatePath);
    expect(candidate).not.toMatch(/js-bazel-package|npm_publish_mode|npm_access|github_package_name|packages:\s*write|TINYLAND_GITHUB_PACKAGES_TOKEN|secrets:\s*inherit/);
    const build = await readText('BUILD.bazel');
    expect(build).toMatch(/vitest_bin\.vitest_test\(\s*name = "test"/);
    expect(build).toContain('"run"');
    expect(build).toContain('"tests/**/*.test.ts"');
    expect(build).toContain('"package.json"');
    expect(build).toContain('"MODULE.bazel"');
    expect(build).toContain('"BUILD.bazel"');
    // Keep package-level tooling available; retired workflow commands were not
    // qualified evidence and must not be replaced by literal true/no-op jobs.
    expect(packageJson.scripts.typecheck).toBe('tsc --noEmit');
    expect(packageJson.scripts.test).toBe('vitest run');
    expect(packageJson.scripts.build).toBe('tsc');
    expect(packageJson.scripts['check:package']).toBe('publint');
  });

  it('qualifies actual package bytes with locked publint instead of a provider pack', async () => {
    const build = await readText('BUILD.bazel');
    const artifactTarget = build.match(/js_test\(\s*name = "package_artifact_test",([\s\S]*?)\n\)/)?.[1];
    expect(artifactTarget).toContain('entry_point = "scripts/check-package-artifact.mjs"');
    expect(artifactTarget).toContain('args = ["$(rootpath :pkg)"]');
    for (const input of [':pkg', ':node_modules/publint', 'package.json', 'scripts/check-package-artifact.mjs']) {
      expect(artifactTarget).toContain(`"${input}"`);
    }
    const packageTarget = build.match(/npm_package\(\s*name = "pkg",([\s\S]*?)\n\)/)?.[1];
    expect(packageTarget).toContain('publishable = False');
    const testTarget = build.match(/vitest_bin\.vitest_test\(\s*name = "test",([\s\S]*?)\n\)/)?.[1];
    expect(testTarget).toContain('"scripts/check-package-artifact.mjs"');

    const guard = await readText('scripts/check-package-artifact.mjs');
    expect(guard).toContain("assert.equal(process.argv.length, 3");
    expect(guard).toContain('path.resolve(process.argv[2])');
    expect(guard).toContain("'@tummycrypt/tinyland-activitypub'");
    expect(guard).toContain('assert.equal(artifact.version, source.version)');
    expect(guard).toContain('assert.deepEqual(artifact[field], source[field]');
    expect(guard).toContain('Object.entries(artifact.exports)');
    expect(guard).toContain('information.isFile() && information.size > 0');
    expect(guard).toContain('publint({ pkgDir: packageDirectory, pack: false, strict: false })');
    expect(guard).toContain("message.type === 'error'");
    expect(guard).not.toMatch(/(?:spawn|execFile|execSync)\s*\(/);
  });
});
