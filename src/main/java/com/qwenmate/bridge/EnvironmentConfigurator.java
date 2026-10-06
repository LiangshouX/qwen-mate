// TODO: consider extracting WSL env propagation into a dedicated helper class
package com.qwenmate.bridge;

import com.qwenmate.settings.QwenMateSettingsService;
import com.qwenmate.util.PlatformUtils;
import com.intellij.openapi.diagnostic.Logger;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Environment configurator.
 * Responsible for configuring process environment variables.
 */
public class EnvironmentConfigurator {

    private static final Logger LOG = Logger.getInstance(EnvironmentConfigurator.class);
    private static final String QWEN_MATE_PERMISSION_DIR_ENV = "QWEN_MATE_PERMISSION_DIR";
    private static final String QWEN_MATE_SESSION_ID_ENV = "QWEN_MATE_SESSION_ID";
    private static final String QWEN_MATE_PERMISSION_SAFETY_NET_ENV = "QWEN_MATE_PERMISSION_SAFETY_NET_MS";
    private static final String HOME_ENV = "HOME";
    private static final Pattern WSL_MOUNT_PATH_PATTERN = Pattern.compile("^/mnt/([a-zA-Z])(?:/(.*))?$");

    private final QwenMateSettingsService settingsService;
    private volatile String cachedPermissionDir = null;
    private volatile String sessionId = null;

    public EnvironmentConfigurator() {
        this(new QwenMateSettingsService());
    }

    EnvironmentConfigurator(QwenMateSettingsService settingsService) {
        this.settingsService = settingsService;
    }

    /**
     * Updates the process environment variables, ensuring PATH includes the Node.js directory.
     * Supports both Windows (Path) and Unix (PATH) naming conventions.
     * The configured Node.js directory is prepended to PATH with highest priority.
     */
    public void updateProcessEnvironment(ProcessBuilder pb, String nodeExecutable) {
        Map<String, String> env = pb.environment();

        // Use PlatformUtils to get the PATH variable (case-insensitive)
        String path = PlatformUtils.isWindows() ?
                              PlatformUtils.getEnvIgnoreCase("PATH") :
                              env.get("PATH");

        if (path == null) {
            path = "";
        }

        StringBuilder newPath = new StringBuilder();
        String separator = File.pathSeparator;

        // 1. Prepend the directory containing Node.js with highest priority
        //    Remove it from existing PATH first to avoid duplicates
        if (nodeExecutable != null && !nodeExecutable.equals("node")) {
            File nodeFile = new File(nodeExecutable);
            String nodeDir = nodeFile.getParent();
            if (nodeDir != null) {
                // Remove existing nodeDir from PATH to avoid duplicates
                String cleanedPath = removePathEntry(path, nodeDir);
                // Prepend nodeDir at the beginning for highest priority
                newPath.append(nodeDir);
                if (!cleanedPath.isEmpty()) {
                    newPath.append(separator).append(cleanedPath);
                }
            } else {
                newPath.append(path);
            }
        } else {
            newPath.append(path);
        }

        // 2. Add common paths based on the platform (append to the end)
        String currentPath = newPath.toString();
        if (PlatformUtils.isWindows()) {
            // Common Windows paths
            String[] windowsPaths = {
                    System.getenv("ProgramFiles") + "\\nodejs",
                    System.getenv("APPDATA") + "\\npm",
                    System.getenv("LOCALAPPDATA") + "\\Programs\\nodejs"
            };
            for (String p : windowsPaths) {
                if (!p.contains("null") && !pathContains(currentPath, p)) {
                    newPath.append(separator).append(p);
                }
            }
        } else {
            // Common macOS/Linux paths
            String userHome = PlatformUtils.getHomeDirectory();
            String[] unixPaths = {
                    "/usr/local/bin",
                    "/opt/homebrew/bin",
                    "/usr/bin",
                    "/bin",
                    "/usr/sbin",
                    "/sbin",
                    userHome + "/.nvm/current/bin",
                    // Python / uv / pip tool installation directory (uvx, uv, etc.)
                    userHome + "/.local/bin",
                    // Rust / cargo tool installation directory
                    userHome + "/.cargo/bin",
                    // Bun global installs (bun add -g) land here
                    userHome + "/.bun/bin",
                    // Yarn classic global installs
                    userHome + "/.yarn/bin",
                    // pnpm global installs (PNPM_HOME defaults per platform)
                    userHome + "/Library/pnpm",
                    userHome + "/.local/share/pnpm",
                    // Hermes-managed node bin (node + globally installed CLIs)
                    userHome + "/.hermes/node/bin",
            };
            for (String p : unixPaths) {
                if (!pathContains(currentPath, p)) {
                    newPath.append(separator).append(p);
                }
            }
        }

        // 3. Set the PATH environment variable
        // Windows requires setting both PATH and Path (some programs only recognize one)
        String newPathStr = newPath.toString();
        if (PlatformUtils.isWindows()) {
            // Remove potentially existing old values to avoid duplicates
            env.remove("PATH");
            env.remove("Path");
            env.remove("path");
            // Set multiple case variations to ensure compatibility
            env.put("PATH", newPathStr);
            env.put("Path", newPathStr);
        } else {
            env.put("PATH", newPathStr);
        }

        // 4. Ensure HOME matches the process type. Native Windows child processes
        // must not inherit WSL mount paths such as /mnt/c/Users/me.
        boolean isWslNode = NodeDetector.isWslPath(nodeExecutable);
        String home = resolveHomeForNodeEnvironment(nodeExecutable, env.get(HOME_ENV));
        if (home != null && !home.isEmpty()) {
            env.put(HOME_ENV, home);
        }

        configurePermissionEnv(env, nodeExecutable);
    }

    static String resolveHomeForNodeEnvironment(String nodeExecutable, String currentHome) {
        boolean isWslNode = NodeDetector.isWslPath(nodeExecutable);
        if (currentHome != null && !currentHome.isEmpty()) {
            return normalizePathForNodeEnvironment(currentHome, isWslNode);
        }

        String resolvedHome = NodeDetector.resolveHomeForFileOps(nodeExecutable);
        if (resolvedHome == null || resolvedHome.isEmpty()) {
            return resolvedHome;
        }
        return normalizePathForNodeEnvironment(resolvedHome, isWslNode);
    }

    static String normalizePathForNodeEnvironment(String path, boolean isWslNode) {
        if (path == null || path.isEmpty()) {
            return path;
        }
        if (isWslNode) {
            return NodeDetector.convertToWslPath(path);
        }
        String windowsPath = convertWslMountPathToWindowsPath(path);
        return windowsPath != null ? windowsPath : path;
    }

    static String convertWslMountPathToWindowsPath(String path) {
        if (!PlatformUtils.isWindows() || path == null || path.isEmpty()) {
            return null;
        }
        Matcher matcher = WSL_MOUNT_PATH_PATTERN.matcher(path);
        if (!matcher.matches()) {
            return null;
        }
        String drive = matcher.group(1).toUpperCase();
        String rest = matcher.group(2);
        if (rest == null || rest.isEmpty()) {
            return drive + ":\\";
        }
        return drive + ":\\" + rest.replace('/', '\\');
    }

    private static String appendChildPath(String parent, String child, boolean isWslNode) {
        if (isWslNode) {
            String normalizedParent = parent.replace('\\', '/');
            while (normalizedParent.endsWith("/")) {
                normalizedParent = normalizedParent.substring(0, normalizedParent.length() - 1);
            }
            return normalizedParent + "/" + child;
        }
        return Paths.get(parent, child).toString();
    }

    /**
     * Configures permission-related environment variables.
     *
     * <p>Equivalent to calling {@link #configurePermissionEnv(Map, String)} with a
     * {@code null} node executable, which disables WSL path translation. Prefer the
     * two-arg overload from production code paths; this one exists for callers (and
     * tests) that don't have a node path on hand.
     */
    public void configurePermissionEnv(Map<String, String> env) {
        configurePermissionEnv(env, null);
    }

    /** Like {@link #configurePermissionEnv(Map)}, but also translates the IPC dir and sets WSLENV when node is a WSL binary. */
    public void configurePermissionEnv(Map<String, String> env, String nodeExecutable) {
        if (env == null) {
            return;
        }
        boolean isWsl = NodeDetector.isWslPath(nodeExecutable);
        String permissionDir = getPermissionDirectory();
        if (permissionDir != null) {
            env.put(QWEN_MATE_PERMISSION_DIR_ENV, isWsl ? NodeDetector.convertToWslPath(permissionDir) : permissionDir);
        }
        String sid = getSessionId();
        if (sid != null) {
            env.put(QWEN_MATE_SESSION_ID_ENV, sid);
        }
        env.put(QWEN_MATE_PERMISSION_SAFETY_NET_ENV, String.valueOf(getPermissionSafetyNetMs()));
        propagateWslEnv(env, isWsl);
    }

    // Permission vars that must cross the Windows鈫扺SL boundary via WSLENV.
    private static final String[] WSL_PROPAGATED_KEYS = {
            QWEN_MATE_PERMISSION_DIR_ENV,
            QWEN_MATE_SESSION_ID_ENV,
            QWEN_MATE_PERMISSION_SAFETY_NET_ENV
    };

    /** Appends permission-bridge keys to WSLENV so they reach the daemon inside WSL. */
    private static void propagateWslEnv(Map<String, String> env, boolean isWsl) {
        if (!isWsl) {
            return;
        }
        String existing = env.get("WSLENV");
        LinkedHashSet<String> entries = new LinkedHashSet<>();
        if (existing != null && !existing.isEmpty()) {
            for (String token : existing.split(":")) {
                if (!token.isEmpty()) {
                    entries.add(token);
                }
            }
        }
        for (String key : WSL_PROPAGATED_KEYS) {
            entries.add(key);
        }
        env.put("WSLENV", String.join(":", entries));
    }

    /**
     * Returns the permission IPC directory in a form the given node executable can
     * read. When {@code nodeExecutable} is a WSL binary on Windows (per
     * {@link NodeDetector#isWslPath}), converts the Windows-style path to its
     * {@code /mnt/<drive>/...} or stripped UNC-WSL equivalent so that both sides
     * of the bridge operate on the same physical directory. Otherwise returns the
     * input unchanged.
     */
    static String translatePermissionDirForNode(String permissionDir, String nodeExecutable) {
        if (permissionDir == null || permissionDir.isEmpty()) {
            return permissionDir;
        }
        if (NodeDetector.isWslPath(nodeExecutable)) {
            return NodeDetector.convertToWslPath(permissionDir);
        }
        return permissionDir;
    }

    long getPermissionSafetyNetMs() {
        try {
            long timeoutSeconds = settingsService.getPermissionDialogTimeoutSeconds();
            return (timeoutSeconds + QwenMateSettingsService.PERMISSION_SAFETY_NET_BUFFER_SECONDS) * 1000L;
        } catch (Exception e) {
            LOG.warn("[EnvironmentConfigurator] Failed to read permission timeout for Node safety net; errorClass="
                    + e.getClass().getSimpleName());
            return (QwenMateSettingsService.DEFAULT_PERMISSION_DIALOG_TIMEOUT_SECONDS
                    + QwenMateSettingsService.PERMISSION_SAFETY_NET_BUFFER_SECONDS) * 1000L;
        }
    }

    /**
     * Get or generate session ID for this instance.
     *
     * @return Session ID
     */
    public String getSessionId() {
        if (this.sessionId == null) {
            synchronized (this) {
                if (this.sessionId == null) {
                    this.sessionId = java.util.UUID.randomUUID().toString();
                }
            }
        }
        return this.sessionId;
    }

    /**
     * Explicitly sets the session ID to align permission request routing
     * across multiple bridge instances.
     */
    public void setSessionId(String sessionId) {
        if (sessionId == null) {
            return;
        }
        String normalized = sessionId.trim();
        if (normalized.isEmpty()) {
            return;
        }
        this.sessionId = normalized;
    }

    /**
     * Gets the permission directory path.
     *
     * The directory is created with restrictive permissions (POSIX 0700 on Unix-like
     * filesystems) because it carries permission IPC payloads and tmpdir is shared
     * across all users on multi-user systems. On Windows / non-POSIX filesystems we
     * fall back to default permissions: tmpdir on Windows is per-user, and the file
     * names contain unguessable request IDs, so other-user access is already gated.
     */
    public String getPermissionDirectory() {
        String cached = this.cachedPermissionDir;
        if (cached != null) {
            return cached;
        }

        Path dir = Paths.get(System.getProperty("java.io.tmpdir"), "qwenmate-permission");
        try {
            Files.createDirectories(dir);
            hardenPermissionDirectory(dir);
        } catch (IOException e) {
            LOG.error("[EnvironmentConfigurator] Failed to prepare permission dir: " + dir + " (" + e.getMessage() + ")");
        }
        cachedPermissionDir = dir.toAbsolutePath().toString();
        return cachedPermissionDir;
    }

    /**
     * Tightens the permission-IPC directory to owner-only access on POSIX systems.
     * Silent no-op on filesystems that don't support POSIX file permissions.
     */
    private void hardenPermissionDirectory(Path dir) {
        try {
            if (!Files.getFileStore(dir).supportsFileAttributeView(java.nio.file.attribute.PosixFileAttributeView.class)) {
                return;
            }
            Files.setPosixFilePermissions(dir,
                    java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));
        } catch (UnsupportedOperationException | IOException ignored) {
            // Filesystem (e.g. Windows NTFS, FAT32) does not support POSIX perms.
            // The directory still inherits the user's tmpdir ACL, which is acceptable.
        }
    }

    /**
     * Checks whether the PATH already contains the specified path.
     * Performs case-insensitive comparison on Windows.
     */
    private boolean pathContains(String pathEnv, String targetPath) {
        if (pathEnv == null || targetPath == null) {
            return false;
        }
        if (PlatformUtils.isWindows()) {
            return pathEnv.toLowerCase().contains(targetPath.toLowerCase());
        }
        return pathEnv.contains(targetPath);
    }

    /**
     * Removes a specific path entry from the PATH environment variable.
     * Performs case-insensitive comparison on Windows.
     *
     * @param pathEnv    The PATH environment variable value
     * @param targetPath The path entry to remove
     * @return PATH with the target entry removed
     */
    private String removePathEntry(String pathEnv, String targetPath) {
        if (pathEnv == null || pathEnv.isEmpty() || targetPath == null || targetPath.isEmpty()) {
            return pathEnv != null ? pathEnv : "";
        }

        String separator = File.pathSeparator;
        String[] entries = pathEnv.split(Pattern.quote(separator));
        StringBuilder result = new StringBuilder();

        for (String entry : entries) {
            String trimmedEntry = entry.trim();
            if (trimmedEntry.isEmpty()) {
                continue;
            }
            // Case-insensitive comparison on Windows, case-sensitive on Unix
            boolean shouldSkip;
            if (PlatformUtils.isWindows()) {
                shouldSkip = trimmedEntry.equalsIgnoreCase(targetPath);
            } else {
                shouldSkip = trimmedEntry.equals(targetPath);
            }

            if (!shouldSkip) {
                if (result.length() > 0) {
                    result.append(separator);
                }
                result.append(trimmedEntry);
            }
        }

        return result.toString();
    }

    /**
     * Configures temporary directory environment variables.
     */
    public void configureTempDir(Map<String, String> env, File tempDir) {
        if (env == null || tempDir == null) {
            return;
        }
        String tmpPath = tempDir.getAbsolutePath();
        env.put("TMPDIR", tmpPath);
        env.put("TEMP", tmpPath);
        env.put("TMP", tmpPath);
    }

    /**
     * Configures project path environment variables.
     */
    public void configureProjectPath(Map<String, String> env, String cwd) {
        if (env == null || cwd == null || cwd.isEmpty() || "undefined".equals(cwd) || "null".equals(cwd)) {
            return;
        }
        env.put("IDEA_PROJECT_PATH", cwd);
        env.put("PROJECT_PATH", cwd);
    }

    /**
     * Configures attachment-related environment variables.
     */
    public void configureAttachmentEnv(Map<String, String> env, boolean hasAttachments) {
        if (env == null) {
            return;
        }
        if (hasAttachments) {
            env.put("QWEN_MATE_USE_STDIN", "true");
        }
    }

    /**
     * Clears all cached values.
     */
    public void clearCache() {
        this.cachedPermissionDir = null;
    }

}
