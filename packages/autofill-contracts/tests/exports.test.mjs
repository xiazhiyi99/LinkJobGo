import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import * as esm from '@job-assistant/autofill-contracts';

const require = createRequire(import.meta.url);
const cjs = require('@job-assistant/autofill-contracts');
const fixture = JSON.parse(await readFile(new URL('../../../apps/extension/fixtures/autofill-context.example.json', import.meta.url), 'utf8'));

test('workspace ESM and CommonJS exports accept the platform resume and reject malformed identities', () => {
  for (const contracts of [esm, cjs]) {
    assert.equal(contracts.PROTOCOL_VERSION, 'autofill.next.v2');
    assert.equal(contracts.RESUME_SCHEMA_VERSION, 'resume.autofill.v1');
    assert.equal(contracts.validateResumeContext(fixture).ok, true);
    const invalid = structuredClone(fixture);
    invalid.records.push(structuredClone(invalid.records[0]));
    assert.equal(contracts.validateResumeContext(invalid).ok, false);
    assert.equal(contracts.validateSourceRef({ scope: 'profile', path: ['__proto__'] }).ok, false);
  }
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
});

test('browser bundle has no external runtime dependencies and package types resolve in both module systems', async () => {
  const result = await build({ stdin: { contents: "export * from '@job-assistant/autofill-contracts';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true });
  assert.equal(Object.values(result.metafile.outputs).flatMap(output => output.imports).length, 0);
  const compilerPackage = require.resolve('typescript/package.json');
  const compiler = resolve(dirname(compilerPackage), require(compilerPackage).bin.tsc);
  execFileSync(process.execPath, [compiler, '--noEmit', '-p', 'tests/tsconfig.json'],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe' });
});
