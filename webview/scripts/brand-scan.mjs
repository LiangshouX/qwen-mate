/**
 * Brand-residue scan: finds Claude/Codex/Opus/... occurrences inside
 * user-visible string contexts (i18n values, JSX text, Java string literals).
 *
 * Usage: node scripts/brand-scan.mjs [rootDir] [--spoken]
 *   --spoken  only report quoted strings that contain whitespace (spoken copy)
 *             and skip comments, changelog and tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const args = process.argv.slice(2).filter((a) => a !== '--spoken');
const spokenOnly = process.argv.includes('--spoken');
const target = args[0] ? path.resolve(args[0]) : path.join(REPO, 'webview/src');
const BRAND = /claude|codex|opus|sonnet|haiku|fable|cc-switch|anthropic/i;
const QUOTED = /['"`]([^'"`\n]*(?:Claude|Codex|Opus|Sonnet|Haiku|Anthropic)[^'"`\n]*)['"`]/;

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'build', '.lib-repo', '.qwen']);
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (/\.(ts|tsx|js|jsx|json|csv|java|properties|html|less|css)$/.test(e.name)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
};

const javaString = /"(?:[^"\\\n]|\\.)*"/g;

for (const file of walk(target)) {
  const rel = path.relative(REPO, file).replace(/\\/g, '/');
  const isJava = file.endsWith('.java');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!BRAND.test(line)) return;
    if (spokenOnly) {
      if (/changelog|\.test\.|__tests__|\.md$/.test(rel)) return;
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#')) return;
      const m = t.match(QUOTED);
      if (m && /\s/.test(m[1]) && m[1].trim().length > 3) {
        console.log(`${rel}:${i + 1}: ${t.slice(0, 150)}`);
      }
      return;
    }
    // Java: only report brand terms inside string literals (skip comments/identifiers)
    if (isJava) {
      let m;
      javaString.lastIndex = 0;
      const hits = [];
      while ((m = javaString.exec(line))) {
        const inner = m[0].slice(1, -1);
        if (BRAND.test(inner)) {
          // skip pure identifiers / paths / FQCNs without spaces (not spoken copy)
          if (!/\s/.test(inner) && /^[A-Za-z0-9_\-./:]+$/.test(inner)) continue;
          hits.push(m[0]);
        }
      }
      if (hits.length) console.log(`${rel}:${i + 1}: ${hits.join(' | ')}`);
      return;
    }
    console.log(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
  });
}
