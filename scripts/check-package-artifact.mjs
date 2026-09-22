import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { publint } from 'publint';
import { formatMessage } from 'publint/utils';

// //:package_artifact_test supplies the actual //:pkg directory in runfiles.
// No workspace dist fallback, npm/pnpm pack or provider publication is allowed.
assert.equal(process.argv.length, 3, 'Expected exactly one Bazel package directory');
const packageDirectory = path.resolve(process.argv[2]);
assert.ok((await stat(packageDirectory)).isDirectory(), 'Bazel package must be a directory');
const source = JSON.parse(await readFile('package.json', 'utf8'));
const artifact = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));

assert.equal(artifact.name, '@tummycrypt/tinyland-activitypub');
assert.equal(artifact.name, source.name);
assert.equal(artifact.version, source.version);
assert.equal(artifact.type, 'module');
assert.equal(artifact.publishConfig, undefined, 'Provider publication configuration is retired');
for (const field of [
  'main', 'module', 'types', 'exports', 'engines', 'dependencies', 'peerDependencies', 'peerDependenciesMeta',
]) {
  assert.deepEqual(artifact[field], source[field], `Bazel package must preserve ${field}`);
}

const files = new Set([artifact.main, artifact.module, artifact.types]);
assert.ok(artifact.exports && typeof artifact.exports === 'object', 'Package exports are required');
for (const [subpath, entry] of Object.entries(artifact.exports)) {
  assert.equal(typeof entry.types, 'string', `${subpath} requires generated declarations`);
  assert.equal(typeof entry.import, 'string', `${subpath} requires generated ESM`);
  files.add(entry.types);
  files.add(entry.import);
}
for (const file of files) {
  assert.equal(typeof file, 'string');
  const relative = path.relative(packageDirectory, path.resolve(packageDirectory, file));
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'Declared file must stay inside the package');
  const information = await stat(path.join(packageDirectory, relative));
  assert.ok(information.isFile() && information.size > 0, `Missing or empty declared file: ${relative}`);
}

// Check these exact Bzlmod-linked package bytes. pack:false never invokes a
// package manager; strict:false retains errors-only failure with warnings shown.
const { messages, pkg } = await publint({ pkgDir: packageDirectory, pack: false, strict: false });
for (const message of messages) {
  console.log(`publint ${message.type}: ${formatMessage(message, pkg)}`);
}
assert.equal(messages.filter((message) => message.type === 'error').length, 0, 'Bazel package failed publint');
console.log(`Bazel ActivityPub artifact aligned at ${artifact.version}; ${files.size} declared files checked`);
