import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
const compilerPackage = require.resolve('typescript/package.json');
const compiler = resolve(dirname(compilerPackage), require(compilerPackage).bin.tsc);
execFileSync(process.execPath, [compiler, '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/cjs/index.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  target: 'es2022',
});
// A require consumer needs CommonJS declarations, including their relative imports.
await mkdir(new URL('../dist/cjs/', import.meta.url), { recursive: true });
for (const name of await readdir(new URL('../dist/esm/', import.meta.url))) {
  if (!name.endsWith('.d.ts')) continue;
  const source = await readFile(new URL(`../dist/esm/${name}`, import.meta.url), 'utf8');
  await writeFile(new URL(`../dist/cjs/${name.replace(/\.d\.ts$/, '.d.cts')}`, import.meta.url),
    source.replace(/(from\s+['"]\.\/[\w-]+)\.js(['"])/g, '$1.cjs$2'));
}
