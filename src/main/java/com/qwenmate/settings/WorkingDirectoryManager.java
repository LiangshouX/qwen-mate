package com.qwenmate.settings;

import com.qwenmate.util.PathUtils;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * Working Directory Manager.
 * Manages custom working directory configuration for projects.
 */
public class WorkingDirectoryManager {
    private static final Logger LOG = Logger.getInstance(WorkingDirectoryManager.class);

    private final Function<Void, JsonObject> configReader;
    private final Consumer<JsonObject> configWriter;

    public WorkingDirectoryManager(
            Function<Void, JsonObject> configReader,
            Consumer<JsonObject> configWriter) {
        this.configReader = configReader;
        this.configWriter = configWriter;
    }

    /**
     * Get the custom working directory configuration.
     * @param projectPath the project root path
     * @return the custom working directory, or null if not configured
     */
    public String getCustomWorkingDirectory(String projectPath) {
        JsonObject config = configReader.apply(null);

        if (!config.has("workingDirectories") || config.get("workingDirectories").isJsonNull()) {
            return null;
        }

        JsonObject workingDirs = config.getAsJsonObject("workingDirectories");

        if (workingDirs.has(projectPath) && !workingDirs.get(projectPath).isJsonNull()) {
            return workingDirs.get(projectPath).getAsString();
        }

        return null;
    }

    /**
     * Set the custom working directory.
     * @param projectPath the project root path
     * @param customWorkingDir the custom working directory (relative to project root or absolute path)
     */
    public void setCustomWorkingDirectory(String projectPath, String customWorkingDir) throws IOException {
        JsonObject config = configReader.apply(null);

        // Ensure the workingDirectories node exists
        if (!config.has("workingDirectories")) {
            config.add("workingDirectories", new JsonObject());
        }

        JsonObject workingDirs = config.getAsJsonObject("workingDirectories");

        if (customWorkingDir == null || customWorkingDir.trim().isEmpty()) {
            // If an empty value is provided, remove the configuration
            workingDirs.remove(projectPath);
        } else {
            // Set the custom working directory
            workingDirs.addProperty(projectPath, customWorkingDir.trim());
        }

        configWriter.accept(config);
        LOG.info("[WorkingDirectoryManager] Set custom working directory for " + projectPath + ": " + customWorkingDir);
    }

    /**
     * Resolve the effective working directory for a project — the same directory
     * the CLI is launched in, normalized so that {@code ..}/{@code .} are collapsed.
     *
     * <p>This is the single source of truth used by both the session launchers and
     * the history readers. Keying history off this value (instead of the raw IDE
     * base path) ensures the {@code ~/.qwen/projects/<key>} directory the GUI reads
     * matches the one the SDK writes to when a custom working directory is set.
     *
     * <p>Resolution order:
     * <ol>
     *   <li>No custom directory configured → the normalized project path.</li>
     *   <li>Custom directory (absolute, or relative to the project root) that exists
     *       and is a directory → that normalized directory.</li>
     *   <li>Custom directory missing/invalid → fall back to the normalized project
     *       path.</li>
     * </ol>
     *
     * @param projectPath the project root path
     * @return the normalized effective working directory, or {@code projectPath}
     *         unchanged when it is null/empty
     */
    public String resolveEffectiveWorkingDirectory(String projectPath) {
        if (projectPath == null || projectPath.isEmpty()) {
            return projectPath;
        }

        String customWorkingDir = getCustomWorkingDirectory(projectPath);
        if (customWorkingDir == null || customWorkingDir.trim().isEmpty()) {
            return PathUtils.normalizeAbsolute(projectPath);
        }

        File workingDirFile = new File(customWorkingDir.trim());
        if (!workingDirFile.isAbsolute()) {
            workingDirFile = new File(projectPath, customWorkingDir.trim());
        }

        String normalized = PathUtils.normalizeAbsolute(workingDirFile.getPath());
        File normalizedFile = new File(normalized);
        if (normalizedFile.exists() && normalizedFile.isDirectory()) {
            return normalized;
        }

        LOG.warn("[WorkingDirectoryManager] Custom working directory does not exist: "
                + normalized + ", falling back to project root");
        return PathUtils.normalizeAbsolute(projectPath);
    }

    /**
     * Get all working directory configurations.
     * @return Map<projectPath, customWorkingDir>
     */
    public Map<String, String> getAllWorkingDirectories() {
        Map<String, String> result = new HashMap<>();
        JsonObject config = configReader.apply(null);

        if (!config.has("workingDirectories") || config.get("workingDirectories").isJsonNull()) {
            return result;
        }

        JsonObject workingDirs = config.getAsJsonObject("workingDirectories");
        for (String key : workingDirs.keySet()) {
            result.put(key, workingDirs.get(key).getAsString());
        }

        return result;
    }
}
