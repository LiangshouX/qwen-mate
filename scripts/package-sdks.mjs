#!/usr/bin/env node
/**
 * Offline SDK packaging script.
 *
 * Downloads the Qwen Code SDK as an npm .tgz
 * tarballs into sdk-packages/ so they can be installed offline:
 *
 *   npm install --global-style /path/to/sdk-packages/qwen-code-sdk-x.y.z.tgz
 *
 * Run this on a machine WITH network access before distributing the plugin.
 *
 * Usage:
 *   node scripts/package-sdks.mjs              # package Qwen SDK only
 *   node scripts/package-sdks.mjs --all        # package all SDKs
 *   node scripts/package-sdks.mjs --registry https://registry.npmmirror.com
 */
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SDK_DIR = join(ROOT, 'sdk-packages');

// SDK definitions (kept in sync with SdkDefinition.java and sdk-loader.js)
const SDKS = [
  {
    id: 'qwen-sdk',
    npmPackage: '@qwen-code/sdk',
    // Pinned: offline delivery must be reproducible ('latest' drifts).
    version: '0.1.18',
    required: true,
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    all: args.includes('--all'),
    registry: args.find((_, i) => args[i - 1] === '--registry') || undefined,
  };
}

function npmPack(pkg, version, registry) {
  const spec = version === 'latest' ? pkg : `${pkg}@${version}`;
  const reg = registry ? `--registry ${registry}` : '';
  console.log(`  Packing ${spec}...`);

  try {
    const output = execSync(`npm pack ${spec} ${reg} --pack-destination "${SDK_DIR}" 2>&1`, {
      encoding: 'utf8',
      cwd: ROOT,
      timeout: 120_000,
    });

    // npm pack outputs the filename on the last line
    const lines = output.trim().split('\n');
    const filename = lines[lines.length - 1].trim();
    return filename;
  } catch (error) {
    console.error(`  ERROR: ${error.message}`);
    return null;
  }
}

function installToDepsDir(tgzPath, sdkId) {
  // Install into a staging dir that mimics ~/.qwenmate/dependencies/<sdkId>/
  const stagingDir = join(SDK_DIR, sdkId);
  mkdirSync(stagingDir, { recursive: true });

  const pkgJsonPath = join(stagingDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    writeFileSync(pkgJsonPath, JSON.stringify({
      name: `${sdkId}-offline-bundle`,
      version: '1.0.0',
      private: true,
      dependencies: {},
    }, null, 2));
  }

  try {
    console.log(`  Installing ${tgzPath} → ${stagingDir}/`);
    execSync(`npm install --save "${tgzPath}" --prefer-offline --no-audit --no-fund`, {
      cwd: stagingDir,
      timeout: 60_000,
    });
  } catch (error) {
    console.error(`  ERROR installing: ${error.message}`);
  }
}

function main() {
  const opts = parseArgs();

  mkdirSync(SDK_DIR, { recursive: true });

  const targetSdks = SDKS.filter((s) => s.required || opts.all);

  console.log('=== Offline SDK Packaging ===');
  console.log(`Output directory: ${SDK_DIR}`);
  console.log(`SDKs to package: ${targetSdks.map((s) => s.id).join(', ')}\n`);

  for (const sdk of targetSdks) {
    console.log(`[${sdk.id}]`);

    // Step 1: npm pack → .tgz
    const tgzFile = npmPack(sdk.npmPackage, sdk.version, opts.registry);
    if (!tgzFile) {
      console.log(`  Skipped (pack failed)\n`);
      continue;
    }

    const tgzPath = join(SDK_DIR, tgzFile);
    console.log(`  Created: ${tgzFile}`);

    // Step 2: Install into staging dir
    installToDepsDir(tgzPath, sdk.id);

    console.log('');
  }

  // Summary
  console.log('=== Summary ===');
  const files = readdirSync(SDK_DIR).filter((f) => f.endsWith('.tgz'));
  for (const f of files) {
    const size = statSync(join(SDK_DIR, f)).size;
    console.log(`  ${f} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  }

  // Write install script
  const installScript = `#!/bin/bash
# Offline SDK installation script
# Run this on the target machine to install bundled SDKs
set -e

DEPS_DIR="\${QWENMATE_DIR:-$HOME/.qwenmate}/dependencies"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing offline SDKs to $DEPS_DIR..."

${targetSdks.map((s) => `
# ${s.displayName || s.id}
if [ -f "$SCRIPT_DIR/${s.id}/package.json" ]; then
  echo "Installing ${s.npmPackage}..."
  mkdir -p "$DEPS_DIR/${s.id}"
  cp -r "$SCRIPT_DIR/${s.id}/"* "$DEPS_DIR/${s.id}/"
  echo "  ✓ ${s.id} installed"
else
  echo "  ⚠ ${s.id} not bundled, skipping"
fi`).join('\n')}

echo "Done!"
`;
  writeFileSync(join(SDK_DIR, 'install-offline.sh'), installScript, { mode: 0o755 });

  // Windows install script
  const winScript = `@echo off
REM Offline SDK installation script (Windows)
set QWENMATE_DIR=%USERPROFILE%\\.qwenmate
set DEPS_DIR=%QWENMATE_DIR%\\dependencies
set SCRIPT_DIR=%~dp0

echo Installing offline SDKs to %DEPS_DIR%...

${targetSdks.map((s) => `
REM ${s.displayName || s.id}
if exist "%SCRIPT_DIR%${s.id}\\package.json" (
  echo Installing ${s.npmPackage}...
  if not exist "%DEPS_DIR%\\${s.id}" mkdir "%DEPS_DIR%\\${s.id}"
  xcopy /E /I /Y "%SCRIPT_DIR%${s.id}\\*" "%DEPS_DIR%\\${s.id}\\"
  echo   [OK] ${s.id} installed
) else (
  echo   [SKIP] ${s.id} not bundled
)`).join('\n')}

echo Done!
pause`;
  writeFileSync(join(SDK_DIR, 'install-offline.bat'), winScript);

  console.log(`\nInstall scripts written to ${SDK_DIR}/install-offline.{sh,bat}`);
}

main();
