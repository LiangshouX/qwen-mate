/**
 * i18n key audit script.
 *
 * Scans webview/src for translation-key usage (t('...'), i18n.t('...'), template
 * literals and key-like string constants) and compares against every locale file
 * in webview/src/i18n/locales.
 *
 * Dynamic template families are expanded through EXPANSIONS (kept in sync with
 * the enum values in code) so every reachable key is checked.
 *
 * Usage: node scripts/i18n-key-scan.mjs
 * Exit code 1 when any key is missing from any locale.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const LOCALES = path.join(SRC, 'i18n/locales');

// ---------------------------------------------------------------------------
// Dynamic template families -> concrete keys (values mirrored from code enums)
// ---------------------------------------------------------------------------
const MODE_IDS = ['plan', 'default', 'auto-edit', 'auto', 'yolo'];
const MODE_FIELDS = ['label', 'shortLabel', 'tooltip', 'description'];
const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const ENTRYPOINTS = ['sdk-cli', 'claude-vscode', 'remote'];
const DSH_STATES = ['checking', 'notInstalled', 'notRunning', 'connected'];
const REPORT_VERDICTS = ['confirmed', 'plausible'];
const REPORT_OUTCOMES = ['fixed', 'skipped', 'noChangeNeeded'];
const AI_FEATURE_SETTINGS_PREFIXES = ['settings.commit.providerModel', 'settings.basic.promptEnhancer'];
const AI_FEATURE_PROVIDER_PREFIX = 'settings.basic.promptEnhancer.provider';
const AI_FEATURE_PROVIDER_IDS = ['qwen', 'dsh'];
const AI_FEATURE_SETTINGS_SUFFIXES = [
  'label', 'modelLabel', 'modeLabel', 'modeAuto', 'modeManual',
  'autoUnavailable', 'autoSummary', 'providerUnavailable', 'currentProviderUnavailable',
];
const COLOR_PREFIXES = ['settings.basic.chatBgColor', 'settings.basic.chatBarColor', 'settings.basic.userMsgColor'];
const COLOR_SUFFIXES = ['label', 'custom', 'reset', 'hint'];
// errorDiagnostic.<code>.{title,intro,reason} + solutions.<key>.{title,stepN}
const ERROR_DIAGNOSTICS = [
  { code: 'codexThreadResume', solutions: [] },
  { code: 'sdkNativeBinaryMissing', solutions: [['switchRegistry', 3], ['downgrade', 1]] },
  { code: 'spawnEbusy', solutions: [['checkNodeVersion', 1], ['reinstallLatestSdk', 2]] },
];
const SKILL_HELP_PREFIXES = ['skills.help']; // 'skills.help.codex' intentionally removed
const SKILL_HELP_SUFFIXES = [
  'title',
  'overview.title', 'overview.description',
  'structure.title', 'structure.description', 'structure.example',
  'format.title', 'format.description', 'format.example', 'format.hint',
  'configuration.title', 'configuration.description',
  'configuration.localPath.label', 'configuration.localPath.description',
  'configuration.relativePath.label', 'configuration.relativePath.description',
  'configuration.absolutePath.label', 'configuration.absolutePath.description',
  'tips.title', 'tips.item1', 'tips.item2', 'tips.item3', 'tips.item4', 'tips.item5',
  'learnMore.title', 'learnMore.description', 'learnMore.link1', 'learnMore.link2', 'learnMore.link3',
];
const PROVIDER_IDS = ['qwen', 'dsh']; // providers.${providerId}.label family
// model dropdown source groups + follow-CLI label variants (modelSelectUtils/modelLabelUtils)
const MODEL_EXTRA_KEYS = [
  'models.groups.cliConfig', 'models.groups.custom',
  'models.qwen.followCliDefault.label', 'models.qwen.followCliDefault.labelWithModel',
  'models.qwen.currentConfigured.badge',
];
const CONVERSION_ERROR_CODES = [
  'INVALID_SESSION_ID', 'SESSION_ACTIVE', 'SESSION_NOT_FOUND', 'FILE_NOT_EXIST',
  'FILE_LOCKED', 'NOT_SDK_SESSION', 'ALREADY_CLI_SESSION', 'CONVERSION_FAILED',
];

const expandFamilies = () => {
  const keys = [];
  for (const id of PROVIDER_IDS) keys.push(`providers.${id}.label`);
  keys.push(...MODEL_EXTRA_KEYS);
  for (const m of MODE_IDS) for (const f of MODE_FIELDS) keys.push(`modes.${m}.${f}`);
  for (const e of REASONING_EFFORTS) keys.push(`reasoning.${e}.label`);
  for (const ep of ENTRYPOINTS) {
    keys.push(`history.entrypointLabel.${ep}`);
    keys.push(`history.entrypointTooltip.${ep}`);
  }
  for (const s of DSH_STATES) keys.push(`settings.cli.dsh.state.${s}`);
  for (const v of REPORT_VERDICTS) keys.push(`tools.reportFindings.${v}`);
  for (const o of REPORT_OUTCOMES) keys.push(`tools.reportFindings.${o}`);
  for (const p of [...AI_FEATURE_SETTINGS_PREFIXES, ...COLOR_PREFIXES]) {
    for (const s of (p.startsWith('settings.basic.') && COLOR_PREFIXES.includes(p)) ? COLOR_SUFFIXES : AI_FEATURE_SETTINGS_SUFFIXES) {
      keys.push(`${p}.${s}`);
    }
  }
  for (const id of AI_FEATURE_PROVIDER_IDS) keys.push(`${AI_FEATURE_PROVIDER_PREFIX}.${id}`);
  for (const d of ERROR_DIAGNOSTICS) {
    keys.push(`errorDiagnostic.${d.code}.title`, `errorDiagnostic.${d.code}.intro`, `errorDiagnostic.${d.code}.reason`);
    for (const [key, stepCount] of d.solutions) {
      keys.push(`errorDiagnostic.${d.code}.solutions.${key}.title`);
      for (let i = 0; i < stepCount; i += 1) keys.push(`errorDiagnostic.${d.code}.solutions.${key}.step${i}`);
    }
  }
  for (const hp of SKILL_HELP_PREFIXES) for (const s of SKILL_HELP_SUFFIXES) keys.push(`${hp}.${s}`);
  for (const c of CONVERSION_ERROR_CODES) keys.push(`history.conversionErrors.${c}`);
  return keys;
};

// ---------------------------------------------------------------------------
// Load locales
// ---------------------------------------------------------------------------
const flatten = (obj, prefix = '', out = new Set()) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.add(key);
  }
  return out;
};

const localeFiles = fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json'));
const locales = {};
for (const f of localeFiles) {
  const json = JSON.parse(fs.readFileSync(path.join(LOCALES, f), 'utf8'));
  locales[f.replace(/\.json$/, '')] = { keys: flatten(json) };
}
// i18next plural keys (`count` interpolation) live as key_one/key_other/... —
// a used key is satisfied when any plural variant exists.
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];
const hasKey = (keys, key) =>
  keys.has(key) || PLURAL_SUFFIXES.some((s) => keys.has(`${key}${s}`));
const allKeys = new Set();
for (const { keys } of Object.values(locales)) for (const k of keys) allKeys.add(k);
const namespaces = new Set([...allKeys].map((k) => k.split('.')[0]));

// ---------------------------------------------------------------------------
// Collect source files
// ---------------------------------------------------------------------------
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
};
const files = walk(SRC);

const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/');
// tokentracker-dashboard resolves its keys through content/copy.csv, not i18n/locales
const isTokentracker = (p) => rel(p).startsWith('components/UsageStatistics/tokentracker-dashboard/');

// ---------------------------------------------------------------------------
// Extract keys
// ---------------------------------------------------------------------------
const used = new Map(); // key -> [{file,line}]
const add = (key, file, line) => {
  if (!used.has(key)) used.set(key, []);
  used.get(key).push({ file: rel(file), line });
};
const dynamicUsages = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    // t('key') / t("key") / t(`literal`)
    for (const m of line.matchAll(/(?:^|[^\w$.])t\(\s*(['"])([^'"\n]+)\1/g)) add(m[2], file, lineNo);
    for (const m of line.matchAll(/(?:^|[^\w$.])t\(\s*`([^`\n]+)`/g)) {
      if (m[1].includes('${')) dynamicUsages.push({ template: m[1], file, line: lineNo });
      else add(m[1], file, lineNo);
    }
    // key-like string constants referencing a known namespace (e.g. MODEL_LABEL_KEYS)
    if (!isTokentracker(file)) {
      for (const m of line.matchAll(/['"`]([a-z][\w-]*(?:\.[\w-]+)+)['"`]/g)) {
        const key = m[1];
        const ns = key.split('.')[0];
        if (!namespaces.has(ns)) continue;
        if (/\.(md|txt|json|ts|tsx|js|jsx|css|less|png|jpe?g|svg|html|ya?ml|toml|lock|wav|properties|csv|gitignore)$/i.test(key)) continue; // file names like changelog.md
        add(key, file, lineNo);
      }
    }
  });
}

// dynamic families are checked through the expansion table
for (const key of expandFamilies()) add(key, '(dynamic-family)', 0);

// keys that are only prefixes of other keys (i18nPrefix-style config values,
// e.g. `settings.basic.chatBgColor` vs `settings.basic.chatBgColor.label`) are
// not rendered directly and cannot exist as leaves in the JSON trees
for (const key of [...used.keys()]) {
  if ([...used.keys()].some((other) => other !== key && other.startsWith(`${key}.`))) {
    used.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const missingByLocale = {};
for (const [name, { keys }] of Object.entries(locales)) {
  missingByLocale[name] = [...used.keys()].filter((k) => !hasKey(keys, k)).sort();
}
const globallyMissing = [...used.keys()].filter((k) => ![...Object.values(locales)].some(({ keys }) => hasKey(keys, k))).sort();

console.log('=== i18n key audit ===');
console.log(`locales: ${localeFiles.join(', ')}`);
console.log(`source files scanned: ${files.length}`);
console.log(`distinct keys checked (incl. dynamic families): ${used.size}`);
console.log('');
console.log(`--- keys missing from ALL locales (${globallyMissing.length}) ---`);
for (const k of globallyMissing) {
  const sites = used.get(k).map((s) => `${s.file}${s.line ? ':' + s.line : ''}`).join(', ');
  console.log(`  ${k}   <- ${sites}`);
}
console.log('');
for (const [name, missing] of Object.entries(missingByLocale)) {
  console.log(`--- ${name}.json missing (${missing.length}) ---`);
  for (const k of missing) console.log(`  ${k}`);
}
console.log('');
console.log(`--- dynamic template usages (${dynamicUsages.length}) — covered via expansion table ---`);
for (const u of dynamicUsages) console.log(`  t(\`${u.template}\`)   <- ${rel(u.file)}:${u.line}`);

const result = { globallyMissing, missingByLocale, dynamicTemplates: dynamicUsages.map((u) => u.template) };
fs.writeFileSync(path.resolve(__dirname, 'i18n-key-scan-result.json'), JSON.stringify(result, null, 2));

process.exit(globallyMissing.length || Object.values(missingByLocale).some((m) => m.length) ? 1 : 0);
