import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Python mailbox probe distinguishes authentication and connection failures without contacting providers',()=>{
  const result = spawnSync(process.env.PYTHON_BIN || 'python3', ['-B', fileURLToPath(new URL('./mail_probe_test.py', import.meta.url))], {encoding:'utf8',timeout:15000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 9 tests/);
});
