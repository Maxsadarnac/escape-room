import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;700&family=Share+Tech+Mono&family=Cinzel:wght@500;700;900&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Pirata+One&family=IM+Fell+English:ital@0;1&family=Oswald:wght@400;500;700&family=Special+Elite&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,900;1,9..144,400&family=Nunito:wght@400;600;700&family=Rajdhani:wght@500;600;700&family=Marcellus&family=Fragment+Mono:ital@0;1&display=swap";

// Latin-only demo: English escape-room content. Keep latin + latin-ext for
// punctuation / accented characters that show up in themes.
const KEEP_SUBSETS = new Set(["latin", "latin-ext"]);

// Modern desktop Chrome UA so Google serves woff2 (not ttf).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Repo root is the parent of this scripts/ directory unless overridden.
const OUT_DIR = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_OUT = join(OUT_DIR, "public", "fonts");
const CSS_OUT = join(OUT_DIR, "src", "fonts.css");

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const css = await (await fetch(FONT_URL, { headers: { "User-Agent": UA } })).text();

// Split into "/* subset */ @font-face { ... }" chunks.
const blockRe =
  /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g;

const seen = new Set();
const faces = [];
let m;
while ((m = blockRe.exec(css)) !== null) {
  const subset = m[1];
  const body = m[2];
  if (!KEEP_SUBSETS.has(subset)) continue;

  const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
  const style = /font-style:\s*([^;]+)/.exec(body)?.[1].trim() ?? "normal";
  const weight = /font-weight:\s*([^;]+)/.exec(body)?.[1].trim() ?? "400";
  const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1];
  const unicodeRange = /unicode-range:\s*([^;]+)/.exec(body)?.[1].trim();
  if (!family || !url) continue;

  const file = `${slug(family)}-${weight.replace(/\s+/g, "")}-${style}-${subset}.woff2`;
  const key = file;
  if (seen.has(key)) continue;
  seen.add(key);

  faces.push({ family, style, weight, url, unicodeRange, file });
}

await mkdir(FONT_OUT, { recursive: true });

let downloaded = 0;
for (const f of faces) {
  const res = await fetch(f.url, { headers: { "User-Agent": UA } });
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(join(FONT_OUT, f.file), buf);
  downloaded++;
  console.log(`  ${f.file}  (${(buf.length / 1024).toFixed(1)} KB)`);
}

const header = `/* =========================================================================
   Self-hosted web fonts for the six visual families.

   Generated from the Google Fonts CSS2 API and vendored as local woff2 so the
   demo has no runtime dependency on fonts.googleapis.com / fonts.gstatic.com.
   Files live in /public/fonts and are served at /fonts/*. The fallback stacks
   in families.css still apply if a face fails to load.

   To regenerate, re-run scripts/fetch-fonts.mjs (see README).
   ========================================================================= */
`;

const rules = faces
  .map(
    (f) => `@font-face {
  font-family: "${f.family}";
  font-style: ${f.style};
  font-weight: ${f.weight};
  font-display: swap;
  src: url("/fonts/${f.file}") format("woff2");${
      f.unicodeRange ? `\n  unicode-range: ${f.unicodeRange};` : ""
    }
}`
  )
  .join("\n\n");

await writeFile(CSS_OUT, `${header}\n${rules}\n`);

console.log(`\nDownloaded ${downloaded} woff2 files -> ${FONT_OUT}`);
console.log(`Wrote ${faces.length} @font-face rules -> ${CSS_OUT}`);
