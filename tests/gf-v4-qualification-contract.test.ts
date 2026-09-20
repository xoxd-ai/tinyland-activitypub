import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readText = (path: string) => readFile(path, 'utf8');
const release = '32e39ced0008edf4564ebeb173a5e8fbf069e28f';
const candidatePath = 'docs/gf-v4-qualification.candidate.yml';

describe('inert ActivityPub GF v4 qualification source', () => {
  it('requests actual tests and the existing package target, with status-only results', async () => {
    expect(JSON.parse(await readText('.github/lanes.json'))).toEqual({
      schema_version: 3,
      actions: {
        'unit-tests': {
          command: 'test',
          targets: ['//:test'],
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
    const workflows = (await readdir('.github/workflows'))
      .filter((name) => /\.ya?ml$/.test(name)).sort();
    expect(workflows).toEqual(['ci.yml', 'publish.yml']);
    for (const name of workflows) {
      expect(await readText(`.github/workflows/${name}`)).not.toContain('spoke-ci-v4.yml');
    }
    expect(await readText(candidatePath)).toContain('# INERT SOURCE CANDIDATE');
    const build = await readText('BUILD.bazel');
    expect(build).toContain('".github/workflows/*.yml"');
    expect(build).toContain('".github/workflows/*.yaml"');
  });

  it('retains the existing publish checks instead of equating status with publication', async () => {
    const publish = await readText('.github/workflows/publish.yml');
    for (const command of ['pnpm typecheck', 'pnpm test', 'pnpm build', 'pnpm check:package']) {
      expect(publish).toContain(command);
    }
    expect(publish).toContain('npm_publish_mode: disabled');
    expect(publish).toContain('bazel_targets: "//:pkg //:test"');
  });
});
