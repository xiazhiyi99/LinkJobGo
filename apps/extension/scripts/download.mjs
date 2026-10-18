import { buildConfiguration, buildExtension, root } from './build.mjs';
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

// This public key pins the unpacked distribution ID; it is not a signing secret.
const key = (await readFile(new URL('./download-public-key.txt', import.meta.url), 'utf8')).trim();
const extensionId = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
const config = buildConfiguration({
  ...process.env,
  EXTENSION_MODE: 'production',
  EXTENSION_API_ORIGIN: process.env.EXTENSION_API_ORIGIN || 'https://linkaigo.com',
  EXTENSION_API_PATH_PREFIX: process.env.EXTENSION_API_PATH_PREFIX ?? '/api',
});
const outdir = resolve(root, '.download-dist');
const metadata = await buildExtension({ config, outdir });
const manifestPath = resolve(outdir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.key = key;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Small standard ZIP writer: only our generated build files, no OS zip dependency.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) { let n = 0xffffffff; for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
async function entries(dir, prefix = '') {
  const result = [];
  for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + item.name;
    if (item.isDirectory()) result.push(...await entries(resolve(dir, item.name), name + '/'));
    else if (item.isFile()) result.push({ name: 'lingke-extension/' + name, bytes: await readFile(resolve(dir, item.name)) });
  }
  return result;
}
const local = [], central = [];
let offset = 0;
for (const { name, bytes } of await entries(outdir)) {
  const filename = Buffer.from(name), compressed = deflateRawSync(bytes), crc = crc32(bytes);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12); // Fixed DOS date (1980-01-01) for reproducible archives.
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
  const index = Buffer.alloc(46);
  index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); header.copy(index, 6, 4, 30); index.writeUInt32LE(offset, 42);
  local.push(header, filename, compressed); central.push(index, filename); offset += header.length + filename.length + compressed.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const destination = resolve(root, '../web/public/downloads');
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, 'lingke-extension.zip'), Buffer.concat([...local, directory, end]));
await cp(resolve(outdir, 'pet/squirrel-motion.webp'), resolve(destination, 'squirrel-motion.webp'));
await writeFile(resolve(destination, 'release.json'), JSON.stringify({ ...metadata, extensionPath: undefined, extensionId, version: manifest.version, loginUrl: config.loginUrl }, null, 2) + '\n');
console.log(`Website download ready: ${manifest.version}; allowed origin: chrome-extension://${extensionId}`);
