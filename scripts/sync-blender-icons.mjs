/**
 * Pull official Blender UI SVGs from blender/blender (main)
 * and drop them into src/assets/icons, preserving custom tool_* glyphs
 * that are not part of the upstream UI set.
 *
 * Source: https://github.com/blender/blender/tree/main/release/datafiles/icons_svg
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destDir = path.join(root, 'src', 'assets', 'icons');
const listingUrl =
  'https://api.github.com/repos/blender/blender/contents/release/datafiles/icons_svg?ref=main';

const ALIASES = {
  vertexsel: 'vertex_select',
  edgesel: 'edge_select',
  facesel: 'face_select',
  xray: 'x_ray',
  clipuv_hlt: 'clip_uv_hlt',
  clipuv_dehlt: 'clip_uv_dehlt',
  uv_vertexsel: 'uv_vertex_select',
  uv_edgesel: 'uv_edge_select',
  uv_facesel: 'uv_face_select',
};

const KEEP_LOCAL = new Set([
  'tool_select.svg',
  'tool_move.svg',
  'tool_rotate.svg',
  'tool_scale.svg',
  'tool_extrude.svg',
  'tool_inset.svg',
  'tool_loopcut.svg',
  'tool_knife.svg',
]);

function cleanSvg(svg) {
  let out = svg
    .replace(/\s+xmlns:inkscape="[^"]*"/g, '')
    .replace(/\s+xmlns:sodipodi="[^"]*"/g, '')
    .replace(/<sodipodi:namedview[\s\S]*?<\/sodipodi:namedview>/g, '')
    .replace(/fill="#ffffff"/gi, 'fill="currentColor"')
    .replace(/fill="#fff"/gi, 'fill="currentColor"')
    .replace(/stroke="#ffffff"/gi, 'stroke="currentColor"')
    .replace(/stroke="#fff"/gi, 'stroke="currentColor"');

  out = out.replace(/<svg\b([^>]*)>/i, (_, attrs) => {
    let next = String(attrs)
      .replace(/\swidth="[^"]*"/i, '')
      .replace(/\sheight="[^"]*"/i, '');
    if (!/\sviewBox=/i.test(next)) next += ' viewBox="0 0 1600 1600"';
    return `<svg${next} width="100%" height="100%">`;
  });
  return out.trim() + '\n';
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ViperCAD-icon-sync', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ViperCAD-icon-sync' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function mapPool(items, limit, worker) {
  const ret = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return ret;
}

const listing = await fetchJson(listingUrl);
const files = listing.filter((entry) => entry.type === 'file' && entry.name.endsWith('.svg'));
await mkdir(destDir, { recursive: true });

console.log(`Downloading ${files.length} official Blender icons…`);
let failed = 0;
await mapPool(files, 12, async (entry) => {
  try {
    const svg = cleanSvg(await fetchText(entry.download_url));
    await writeFile(path.join(destDir, entry.name), svg, 'utf8');
  } catch (err) {
    failed += 1;
    console.error(`fail ${entry.name}:`, err.message);
  }
});

for (const [from, to] of Object.entries(ALIASES)) {
  const src = path.join(destDir, `${from}.svg`);
  const copy = await readFile(src, 'utf8');
  await writeFile(path.join(destDir, `${to}.svg`), copy, 'utf8');
}

const local = await readdir(destDir);
const officialNames = new Set(files.map((f) => f.name));
for (const [from, to] of Object.entries(ALIASES)) {
  officialNames.add(`${to}.svg`);
  void from;
}
const extras = local.filter((name) => name.endsWith('.svg') && !officialNames.has(name));
console.log(`Wrote ${files.length - failed} icons, ${Object.keys(ALIASES).length} aliases`);
console.log(`Kept local extras: ${extras.filter((n) => KEEP_LOCAL.has(n)).join(', ') || '(none)'}`);
if (extras.some((n) => !KEEP_LOCAL.has(n))) {
  console.log(
    'Other extras (not overwritten):',
    extras.filter((n) => !KEEP_LOCAL.has(n)).join(', '),
  );
}
