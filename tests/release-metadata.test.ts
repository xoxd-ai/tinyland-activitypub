import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('canonical ActivityPub release metadata', () => {
  it('keeps the package, root Bazel module, and npm_package versions aligned', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
    const moduleFile = await readFile('MODULE.bazel', 'utf8');
    const buildFile = await readFile('BUILD.bazel', 'utf8');
    const rootModule = moduleFile.match(/^module\(([\s\S]*?)^\)/m)?.[1];
    const packages = [...buildFile.matchAll(/^npm_package\(([\s\S]*?)^\)/gm)]
      .map((match) => match[1])
      .filter((block) => /^\s*name\s*=\s*"pkg"\s*,?$/m.test(block));

    expect(packageJson.name).toBe('@tummycrypt/tinyland-activitypub');
    expect(packageJson.repository.url).toBe('git+https://github.com/xoxd-ai/tinyland-activitypub.git');
    expect(packageJson.homepage).toBe('https://github.com/xoxd-ai/tinyland-activitypub');
    expect(packageJson.bugs.url).toBe('https://github.com/xoxd-ai/tinyland-activitypub/issues');
    expect(packageJson).not.toHaveProperty('publishConfig');
    expect(typeof packageJson.version).toBe('string');
    expect(packageJson.version.length).toBeGreaterThan(0);
    expect(rootModule).toContain('name = "tummycrypt_tinyland_activitypub"');
    expect(packages).toHaveLength(1);
    expect(packages[0]).toContain('package = "@tummycrypt/tinyland-activitypub"');
    const declaredVersion = (block: string | undefined) =>
      block?.match(/^\s*version\s*=\s*"([^"]+)"\s*,?$/m)?.[1];
    expect(declaredVersion(rootModule)).toBe(packageJson.version);
    expect(declaredVersion(packages[0])).toBe(packageJson.version);
  });
});
