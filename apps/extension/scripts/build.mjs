import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdir, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
export function buildConfiguration(env = process.env) {
  const mode = env.EXTENSION_MODE || 'development';
  if (!['development', 'production'].includes(mode)) throw new Error('Invalid EXTENSION_MODE');
  const raw = env.EXTENSION_API_ORIGIN || (mode === 'development' ? 'http://127.0.0.1:3001' : '');
  const url = new URL(raw);
  const local = mode === 'development' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid configured platform API origin');
  const rawPrefix = env.EXTENSION_API_PATH_PREFIX || '';
  const apiPathPrefix = rawPrefix.replace(/\/$/, '');
  if (apiPathPrefix && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(apiPathPrefix)) throw new Error('Invalid configured platform API path prefix');
  const loginUrl = new URL(env.EXTENSION_LOGIN_URL || (mode === 'development' ? 'http://127.0.0.1:3000/login' : '/login'), url.origin);
  const localLogin = mode === 'development' && loginUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(loginUrl.hostname);
  if ((!localLogin && (loginUrl.protocol !== 'https:' || loginUrl.origin !== url.origin)) || loginUrl.username || loginUrl.password || loginUrl.hash) throw new Error('Invalid platform login URL');
  return { apiOrigin: url.origin, apiPathPrefix, loginUrl: loginUrl.href, development: mode === 'development' };
}
async function files(dir) {
  const entries = (await readdir(dir, { withFileTypes: true })).filter(e => e.name !== '.DS_Store').sort((a, b) => a.name.localeCompare(b.name));
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)]))).flat();
}
export async function buildExtension({ config = buildConfiguration(), outdir = resolve(root, 'dist') } = {}) {
  const require = createRequire(import.meta.url);
  const compiler = require.resolve('typescript/package.json');
  execFileSync(process.execPath, [resolve(dirname(compiler), require(compiler).bin.tsc), '--noEmit'], { cwd: root, stdio: 'inherit' });
  const sources = [...await files(resolve(root, 'src')), resolve(root, 'manifest.json'), resolve(root, 'package.json'), resolve(root, 'tsconfig.json'), fileURLToPath(import.meta.url), resolve(root, '../../pnpm-lock.yaml'), ...await files(resolve(root, '../../packages/autofill-contracts/src'))];
  const hash = createHash('sha256').update(JSON.stringify(config));
  for (const file of sources.filter(f => !f.endsWith('.md'))) hash.update(relative(root, file)).update(await readFile(file));
  const buildId = hash.digest('hex').slice(0, 20);
  await rm(outdir, { force: true, recursive: true }); await mkdir(outdir, { recursive: true });
  const define = { __AUTOFILL_BUILD_ID__: JSON.stringify(buildId), __PLATFORM_API_ORIGIN__: JSON.stringify(config.apiOrigin), __PLATFORM_API_PATH_PREFIX__: JSON.stringify(config.apiPathPrefix ?? ''), __PLATFORM_LOGIN_URL__: JSON.stringify(config.loginUrl ?? new URL('/login', config.apiOrigin).href), __PLATFORM_DEVELOPMENT__: JSON.stringify(config.development) };
  for (const name of ['content', 'background', 'popup']) await build({ entryPoints: [resolve(root, `src/shell/${name}.ts`)], outfile: resolve(outdir, name + '.js'), bundle: true, format: name === 'content' ? 'iife' : 'esm', platform: 'browser', target: 'chrome120', define });
  for (const filename of ['popup.html', 'popup.css']) await cp(resolve(root, 'src/shell', filename), resolve(outdir, filename));
  await mkdir(resolve(outdir, 'pet')); await cp(resolve(root, 'src/shell/pet/squirrel-motion.webp'), resolve(outdir, 'pet/squirrel-motion.webp'));
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const url = new URL(config.apiOrigin);
  manifest.host_permissions = [`${url.protocol}//${url.hostname}/*`];
  manifest.version_name = `Platform ${manifest.version} (${buildId})`;
  await writeFile(resolve(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const metadata = { buildId, protocolVersion: 'autofill.next.v2', apiOrigin: config.apiOrigin, apiPathPrefix: config.apiPathPrefix ?? '', development: config.development };
  await writeFile(resolve(outdir, 'build.json'), JSON.stringify(metadata, null, 2) + '\n');
  return { ...metadata, extensionPath: outdir };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await buildExtension());
