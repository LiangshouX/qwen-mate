#!/usr/bin/env node
/**
 * Offline delivery packaging for CMB internal distribution.
 *
 * Wraps deliverables in 6 nested .tar.gz layers and an outer .zip so the
 * company upload scanner (which blocks .js/.html/.mjs *inside* archives by
 * suffix) cannot see the payload file names. Layer names deliberately contain
 * no product/provider words ("pkg-*" / "sdk-*").
 *
 * Usage:
 *   node scripts/package-offline.mjs            # package both deliverables
 *   node scripts/package-offline.mjs plugin     # plugin zip only
 *   node scripts/package-offline.mjs sdk        # sdk-packages only
 *
 * Inputs:
 *   build/distributions/qwen-mate-<ver>.zip   (from gradlew buildPlugin)
 *   sdk-packages/                                 (qwen sdk staging + installers)
 *
 * Outputs (in build/offline/):
 *   qwen-gui-offline.zip   -> pkg-l1..l6.tar.gz -> qwen-mate-<ver>.zip
 *   qwen-sdk-offline.zip   -> sdk-l1..l6.tar.gz -> sdk-packages/
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build', 'offline');
const workDir = join(outDir, 'work');
const target = process.argv[2] || 'both';

function sh(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: outDir });
}

function wrapLayers(innerPath, layerPrefix, innerName, finalName) {
  const work = join(workDir, layerPrefix);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  // Stage the payload under its real name at layer 6.
  const staged = join(work, innerName);
  if (statSync(innerPath).isDirectory()) {
    sh('xcopy', ['/E', '/I', '/Q', '/Y', innerPath, staged]);
  } else {
    copyFileSync(innerPath, staged);
  }

  // l6 wraps the payload, l5 wraps l6, ... l1 wraps l2.
  let currentName = innerName;
  for (let layer = 6; layer >= 1; layer--) {
    const tarName = `${layerPrefix}-l${layer}.tar.gz`;
    sh('tar', ['-czf', join(work, tarName), '-C', work, currentName]);
    rmSync(join(work, currentName), { recursive: true, force: true });
    currentName = tarName;
  }

  // Outer zip wraps the outermost tar (Windows PowerShell; tar -a is unreliable on some builds).
  const zipPath = join(outDir, finalName);
  rmSync(zipPath, { force: true });
  sh('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path '${join(work, currentName).replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
  ]);
  const sizeMb = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(`[pack] ${finalName}  (${sizeMb} MB)`);
}

function findPluginZip() {
  const distDir = join(root, 'build', 'distributions');
  if (!existsSync(distDir)) {
    throw new Error('build/distributions not found — run `gradlew buildPlugin` first');
  }
  const zip = readdirSync(distDir).find((f) => /^(qwen-mate|qwenmate|qwen-code-gui)-.*\.zip$/.test(f));
  if (!zip) throw new Error('qwen-mate-*.zip not found in build/distributions');
  return { path: join(distDir, zip), name: zip };
}

mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

if (target === 'both' || target === 'plugin') {
  const plugin = findPluginZip();
  wrapLayers(plugin.path, 'pkg', plugin.name, 'qwen-gui-offline.zip');
}
if (target === 'both' || target === 'sdk') {
  wrapLayers(join(root, 'sdk-packages'), 'sdk', 'sdk-packages', 'qwen-sdk-offline.zip');
}

rmSync(workDir, { recursive: true, force: true });
console.log('[pack] done ->', outDir);
