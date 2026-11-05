/**
 * Decode the committed dango images (Dango Tower).
 *
 * The GitHub connector used to push this repo cannot upload binary files,
 * so the real character PNGs are stored as base64 text files under
 * assets-src/ (assets-src/dango/*.png.b64 and assets-src/ogp.png.b64).
 * This script decodes them back into real PNGs under public/, where the
 * game reads them from. It runs automatically before `npm run dev` and
 * `npm run build` (npm predev / prebuild hooks).
 *
 * The decoded PNGs are git-ignored build artifacts. The .b64 files are
 * the tracked source of truth — they contain the exact image bytes from
 * Google Drive (Dango Drop's public/assets/dango). A future direct git
 * push can replace each .png.b64 with the real .png file under public/
 * and delete this script; the game code only ever reads the .png files.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'assets-src');
const publicDir = join(root, 'public');

const decoded = [];
const walk = (dir, relative) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(path, rel);
      continue;
    }
    if (!entry.name.endsWith('.png.b64')) continue;
    const target = join(publicDir, rel.slice(0, -'.b64'.length));
    const bytes = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
    let needsWrite = true;
    try {
      needsWrite = !readFileSync(target).equals(bytes);
    } catch {
      needsWrite = true;
    }
    if (needsWrite) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      decoded.push(target);
    }
  }
};

if (!existsSync(sourceDir)) {
  console.log('No assets-src/ directory, nothing to decode.');
} else {
  walk(sourceDir, '');
  console.log(
    decoded.length > 0
      ? `Decoded ${decoded.length} image(s) from .png.b64 files.`
      : 'All images already decoded.',
  );
}
