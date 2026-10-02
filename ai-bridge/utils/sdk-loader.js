/**
 * SDK Loader - Dynamically loads optional AI SDKs
 *
 * Supports loading SDKs from the user directory ~/.qwenmate/dependencies/
 * This allows users to install SDKs on demand rather than bundling them with the plugin
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getQwenMateDir } from './path-utils.js';

// Base path for dependencies directory - uses the shared path utility
const DEPS_BASE = join(getQwenMateDir(), 'dependencies');

// SDK cache
const sdkCache = new Map();
// Promise cache for in-flight loads to prevent concurrent loading of the same SDK
const loadingPromises = new Map();

// SDK definitions (kept in sync with DependencyManager.SdkDefinition)
const SDK_DEFINITIONS = {
    QWEN: {
        id: 'qwen-sdk',
        npmPackage: '@qwen-code/sdk'
    }
};

function getSdkRootDir(sdkId) {
    return join(DEPS_BASE, sdkId);
}

function getPackageDirFromRoot(sdkRootDir, pkgName) {
    // pkgName like: "@qwen-code/sdk"
    // Logic kept consistent with DependencyManager.getPackageDir()
    const parts = pkgName.split('/');
    return join(sdkRootDir, 'node_modules', ...parts);
}

function pickExportTarget(exportsField, condition) {
    if (!exportsField) return null;
    if (typeof exportsField === 'string') return exportsField;

    // exports: { ".": {...} } or exports: { import: "...", require: "...", default: "..." }
    const root = exportsField['.'] ?? exportsField;
    if (typeof root === 'string') return root;

    if (root && typeof root === 'object') {
        if (typeof root[condition] === 'string') return root[condition];
        if (typeof root.default === 'string') return root.default;
    }

    return null;
}

function resolveEntryFileFromPackageDir(packageDir) {
    // Node ESM does not support importing a directory path directly.
    // We must resolve to a concrete file (e.g., sdk.mjs / index.js / export target).
    const pkgJsonPath = join(packageDir, 'package.json');
    if (existsSync(pkgJsonPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

            const exportTarget =
                pickExportTarget(pkg.exports, 'import') ??
                pickExportTarget(pkg.exports, 'default');

            const candidate =
                exportTarget ??
                (typeof pkg.module === 'string' ? pkg.module : null) ??
                (typeof pkg.main === 'string' ? pkg.main : null);

            if (candidate && typeof candidate === 'string') {
                return join(packageDir, candidate);
            }
        } catch {
            // ignore and fall through to heuristic
        }
    }

    const heuristicCandidates = ['sdk.mjs', 'index.mjs', 'index.js', 'dist/index.js', 'dist/index.mjs'];
    for (const file of heuristicCandidates) {
        const full = join(packageDir, file);
        if (existsSync(full)) return full;
    }

    return null;
}

/**
 * Check whether the Qwen Code SDK is available
 */
export function isQwenSdkAvailable() {
    const sdkId = 'qwen-sdk';
    const npmPackage = '@qwen-code/sdk';
    const sdkPath = getPackageDirFromRoot(getSdkRootDir(sdkId), npmPackage);
    return existsSync(sdkPath);
}

/**
 * Dynamically load the Qwen Code SDK
 * @returns {Promise<{query: Function, tool: Function, ...}>}
 */
export async function loadQwenSdk() {
    if (sdkCache.has('qwen')) {
        return sdkCache.get('qwen');
    }
    if (loadingPromises.has('qwen')) {
        return loadingPromises.get('qwen');
    }

    const sdkRootDir = getSdkRootDir('qwen-sdk');
    const nodeModulesDir = join(sdkRootDir, 'node_modules');
    const sdkPath = getPackageDirFromRoot(sdkRootDir, '@qwen-code/sdk');

    if (!existsSync(sdkPath)) {
        throw new Error('SDK_NOT_INSTALLED:qwen');
    }

    // Verify critical dependency exists
    const mcpSdkPath = join(nodeModulesDir, '@modelcontextprotocol', 'sdk');
    if (!existsSync(mcpSdkPath)) {
        throw new Error(`SDK_MISSING_DEPENDENCY: @modelcontextprotocol/sdk not found at ${mcpSdkPath}. Reinstall the Qwen SDK.`);
    }

    const loadPromise = (async () => {
        try {
            const entry = resolveEntryFileFromPackageDir(sdkPath);
            if (!entry) {
                throw new Error(`Unable to resolve entry file for @qwen-code/sdk in ${sdkPath}`);
            }

            // Use createRequire anchored at the SDK package so Node.js resolves
            // @modelcontextprotocol/sdk and other deps from the correct node_modules.
            // Without this, import(fileUrl) may fail to find scoped packages on
            // Windows because the ESM resolver mishandles \@ in node_modules paths.
            const { createRequire } = await import('node:module');
            const require = createRequire(entry);

            // Pre-resolve critical deps through CJS resolver to surface clear errors
            try {
                require.resolve('@modelcontextprotocol/sdk/server/mcp.js');
            } catch {
                // CJS resolve may fail for ESM-only packages; that's OK — the
                // ESM import below will surface the real error if it's a problem.
            }

            // Set NODE_PATH so ESM fallback resolution also finds our node_modules
            const prevNodePath = process.env.NODE_PATH || '';
            const pathMod = await import('node:path');
            process.env.NODE_PATH = nodeModulesDir + (prevNodePath ? pathMod.delimiter + prevNodePath : '');

            // Import via file URL — this is the only way for ESM packages outside
            // the project's own node_modules tree
            const { pathToFileURL } = await import('node:url');
            const sdk = await import(pathToFileURL(entry).href);

            // Restore NODE_PATH
            if (prevNodePath) {
                process.env.NODE_PATH = prevNodePath;
            } else {
                delete process.env.NODE_PATH;
            }

            sdkCache.set('qwen', sdk);
            return sdk;
        } catch (error) {
            throw new Error(`Failed to load Qwen SDK: ${error.message}`);
        } finally {
            loadingPromises.delete('qwen');
        }
    })();

    loadingPromises.set('qwen', loadPromise);
    return loadPromise;
}

export function getSdkStatus() {
    // Uses the same path resolution logic as DependencyManager
    const qwenInstalled = isQwenSdkAvailable();

    return {
        qwen: {
            installed: qwenInstalled,
            path: getPackageDirFromRoot(getSdkRootDir('qwen-sdk'), '@qwen-code/sdk')
        }
    };
}

/**
 * Read the installed version of an SDK package without importing it.
 * @param {string} sdkId
 * @returns {string|null}
 */
export function getInstalledSdkVersion(sdkId) {
    const definition = Object.values(SDK_DEFINITIONS).find((entry) => entry.id === sdkId);
    if (!definition) {
        return null;
    }

    const packageJsonPath = join(
        getPackageDirFromRoot(getSdkRootDir(sdkId), definition.npmPackage),
        'package.json'
    );
    if (!existsSync(packageJsonPath)) {
        return null;
    }

    try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        return typeof packageJson.version === 'string' ? packageJson.version : null;
    } catch {
        return null;
    }
}

/**
 * Clear the SDK cache
 * Should be called after an SDK is reinstalled
 */
export function clearSdkCache() {
    sdkCache.clear();
}

/**
 * Verify that the SDK is installed, throwing a user-friendly error if not
 * @param {string} provider
 * @throws {Error} If the SDK is not installed
 */
export function requireSdk(provider) {
    if (provider === 'qwen' && !isQwenSdkAvailable()) {
        const error = new Error('Qwen Code SDK not installed. Please install via Settings > Dependencies.');
        error.code = 'SDK_NOT_INSTALLED';
        error.provider = 'qwen';
        throw error;
    }
}
