package com.qwenmate.bridge;

import com.qwenmate.util.PlatformUtils;
import com.qwenmate.util.PluginMetadata;
import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.diagnostic.Logger;

import java.io.File;
import java.nio.file.Paths;
import java.security.CodeSource;
import java.util.ArrayList;
import java.util.List;

/**
 * Locates candidate ai-bridge directories across the user/system paths and
 * validates that a given directory is a usable bridge install.
 *
 * <p>Package-private helper extracted from {@link BridgeDirectoryResolver}.
 */
final class BridgePathLocator {

    private static final Logger LOG = Logger.getInstance(BridgePathLocator.class);

    static final String SDK_DIR_NAME = "ai-bridge";
    static final String NODE_SCRIPT = "channel-manager.js";
    /** Root directory name of the distribution zip — what the IDE extracts to. */
    static final String PLUGIN_DIR_NAME = "qwen-mate";
    /** Pre-rename distribution directory names, kept as compatibility candidates. */
    static final String[] LEGACY_PLUGIN_DIR_NAMES = {"qwenmate", "qwen-code-gui", "idea-claude-code-gui"};
    static final String BRIDGE_PATH_PROPERTY = "qwenmate.bridge.path";
    static final String BRIDGE_PATH_ENV = "QWEN_MATE_BRIDGE_PATH";

    /**
     * Add every known plugin directory name under the given plugins root.
     * The distribution zip root name is not derived from the plugin id, so all
     * historical names must stay in the candidate set.
     */
    static void addPluginDirCandidates(List<File> out, File pluginsRoot) {
        if (pluginsRoot == null) {
            return;
        }
        addCandidate(out, new File(pluginsRoot, PLUGIN_DIR_NAME));
        for (String legacy : LEGACY_PLUGIN_DIR_NAMES) {
            addCandidate(out, new File(pluginsRoot, legacy));
        }
        addCandidate(out, new File(pluginsRoot, PlatformUtils.getPluginId()));
    }

    static boolean isPluginDirName(String name) {
        if (PLUGIN_DIR_NAME.equals(name) || PlatformUtils.getPluginId().equals(name)) {
            return true;
        }
        for (String legacy : LEGACY_PLUGIN_DIR_NAMES) {
            if (legacy.equals(name)) {
                return true;
            }
        }
        return false;
    }

    private BridgePathLocator() {
    }

    /**
     * Resolve the configured bridge directory.
     */
    static File resolveConfiguredBridgeDir() {
        File fromProperty = tryResolveConfiguredPath(
            System.getProperty(BRIDGE_PATH_PROPERTY),
            "system property " + BRIDGE_PATH_PROPERTY
        );
        if (fromProperty != null) {
            return fromProperty;
        }
        return tryResolveConfiguredPath(
            System.getenv(BRIDGE_PATH_ENV),
            "environment variable " + BRIDGE_PATH_ENV
        );
    }

    private static File tryResolveConfiguredPath(String path, String source) {
        if (path == null || path.trim().isEmpty()) {
            return null;
        }
        File dir = new File(path.trim());
        if (isValidBridgeDir(dir)) {
            LOG.debug("[BridgeResolver] Using " + source + ": " + dir.getAbsolutePath());
            return dir;
        }
        LOG.warn("[BridgeResolver] " + source + " points to invalid directory: " + dir.getAbsolutePath());
        return null;
    }

    static void addPluginCandidates(List<File> possibleDirs) {
        try {
            File pluginDir = PluginMetadata.getPluginDirectory(BridgePathLocator.class);
            if (pluginDir != null) {
                addCandidate(possibleDirs, new File(pluginDir, SDK_DIR_NAME));
            }
        } catch (Throwable t) {
            LOG.debug("[BridgeResolver] Cannot infer from plugin descriptor: " + t.getMessage());
        }

        try {
            String pluginsRoot = PathManager.getPluginsPath();
            if (!pluginsRoot.isEmpty()) {
                List<File> pluginDirs = new ArrayList<>();
                addPluginDirCandidates(pluginDirs, Paths.get(pluginsRoot).toFile());
                for (File pluginDir : pluginDirs) {
                    addCandidate(possibleDirs, new File(pluginDir, SDK_DIR_NAME));
                }
            }

            String systemPath = PathManager.getSystemPath();
            if (!systemPath.isEmpty()) {
                List<File> pluginDirs = new ArrayList<>();
                addPluginDirCandidates(pluginDirs, Paths.get(systemPath, "plugins").toFile());
                for (File pluginDir : pluginDirs) {
                    addCandidate(possibleDirs, new File(pluginDir, SDK_DIR_NAME));
                }
            }
        } catch (Throwable t) {
            LOG.debug("[BridgeResolver] Cannot infer from plugin path: " + t.getMessage());
        }
    }

    static void addClasspathCandidates(List<File> possibleDirs) {
        try {
            CodeSource codeSource = BridgeDirectoryResolver.class.getProtectionDomain().getCodeSource();
            if (codeSource == null || codeSource.getLocation() == null) {
                LOG.debug("[BridgeResolver] Cannot infer from classpath: CodeSource unavailable");
                return;
            }
            File location = new File(codeSource.getLocation().toURI());
            File classDir = location.getParentFile();
            while (classDir != null && classDir.exists()) {
                addCandidate(possibleDirs, new File(classDir, SDK_DIR_NAME));
                String name = classDir.getName();
                if (isPluginDirName(name)) {
                    break;
                }
                if (isRootDirectory(classDir)) {
                    break;
                }
                classDir = classDir.getParentFile();
            }
        } catch (Exception e) {
            LOG.debug("[BridgeResolver] Cannot infer from classpath: " + e.getMessage());
        }
    }

    static void addCandidate(List<File> possibleDirs, File dir) {
        if (dir == null) {
            return;
        }
        String candidatePath = dir.getAbsolutePath();
        for (File existing : possibleDirs) {
            if (existing.getAbsolutePath().equals(candidatePath)) {
                return;
            }
        }
        possibleDirs.add(dir);
    }

    static boolean isRootDirectory(File dir) {
        return dir.getParentFile() == null;
    }

    /**
     * Validate whether a directory is a valid bridge directory.
     * Checks for the existence of the core script.
     *
     * Note: a node_modules directory is NOT required — the bridge declares no
     * npm dependencies (package.json {@code dependencies: {}}) and AI SDKs are
     * loaded dynamically from ~/.qwenmate/dependencies/. The historical
     * node_modules check dated from when sql.js was bundled and rejected every
     * freshly extracted archive.
     */
    static boolean isValidBridgeDir(File dir) {
        LOG.debug("[BridgeResolver] Validating bridge dir: " + (dir != null ? dir.getAbsolutePath() : "null"));
        if (dir == null) {
            LOG.debug("[BridgeResolver] Validation failed: dir is null");
            return false;
        }
        if (!dir.exists()) {
            LOG.debug("[BridgeResolver] Validation failed: dir does not exist");
            return false;
        }
        if (!dir.isDirectory()) {
            LOG.debug("[BridgeResolver] Validation failed: dir is not a directory");
            return false;
        }

        // Check for the core script
        File scriptFile = new File(dir, NODE_SCRIPT);
        LOG.debug("[BridgeResolver] Checking for core script: " + scriptFile.getAbsolutePath());
        if (!scriptFile.exists()) {
            LOG.debug("[BridgeResolver] Validation failed: Core script not found: " + scriptFile.getAbsolutePath());
            return false;
        }
        LOG.debug("[BridgeResolver] Core script found");

        return true;
    }
}
