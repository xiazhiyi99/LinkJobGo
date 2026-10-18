import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const compilerPackage = require.resolve('typescript/package.json');
execFileSync(process.execPath, [resolve(dirname(compilerPackage), require(compilerPackage).bin.tsc), '-p', 'tsconfig.autofill.json'], { cwd: root, stdio: 'inherit' });
await build({
  absWorkingDir: root,
  entryPoints: ['src/modules/autofill/engine.ts'],
  outfile: 'src/modules/autofill/dist/engine.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  // Keep the same ServiceError identity as the CJS profile/HTTP adapters.
  external: ['@job-assistant/autofill-contracts', '../errors.js'],
});
