package com.qwenmate.settings;

import com.qwenmate.bridge.NodeDetector;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;

import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * MCP Server Manager.
 * Manages MCP server configurations.
 * <p>
 * Configuration sources are resolved in this order (graceful degradation):
 * <ol>
 *   <li>Qwen Code settings — {@code ~/.qwen/settings.json} ({@code mcpServers}
 *       field) merged with {@code <project>/.qwen/settings.json}. Enable/disable
 *       state lives in {@code mcp.excluded} (Qwen Code's own toggle field) with
 *       the legacy {@code disabledMcpServers} array still honored.</li>
 *   <li>{@code ~/.qwenmate/config.json} (array format, injected reader/writer).</li>
 * </ol>
 * Writes go back to the same source they were read from, preserving every
 * unrelated field in the file. Unparseable config files are never overwritten.
 */
public class McpServerManager {
    private static final Logger LOG = Logger.getInstance(McpServerManager.class);

    /** Pretty printer matching Qwen Code's own settings.json formatting. */
    private static final Gson PRETTY_GSON = new GsonBuilder().setPrettyPrinting().create();

    private final Gson gson;
    private final Function<Void, JsonObject> configReader;
    private final Consumer<JsonObject> configWriter;
    private final Supplier<String> homeDirSupplier;

    public McpServerManager(
            Gson gson,
            Function<Void, JsonObject> configReader,
            Consumer<JsonObject> configWriter) {
        this(gson, configReader, configWriter, NodeDetector::resolveHomeForFileOps);
    }

    /**
     * Constructor with an injectable home-directory supplier (used by tests to
     * point the manager at a temporary home).
     */
    McpServerManager(
            Gson gson,
            Function<Void, JsonObject> configReader,
            Consumer<JsonObject> configWriter,
            Supplier<String> homeDirSupplier) {
        this.gson = gson;
        this.configReader = configReader;
        this.configWriter = configWriter;
        this.homeDirSupplier = homeDirSupplier;
    }

    // ============================================================================
    // Paths
    // ============================================================================

    private Path qwenSettingsPath() {
        return Paths.get(homeDirSupplier.get(), ".qwen", "settings.json");
    }

    private static Path qwenProjectSettingsPath(String projectPath) {
        return Paths.get(projectPath, ".qwen", "settings.json");
    }

    // ============================================================================
    // Tolerant JSON file IO
    // ============================================================================

    /**
     * Read a JSON object from a file. Returns null when the file is missing,
     * not a JSON object, or unparseable (logged at warn level). Never throws.
     */
    private static JsonObject readJsonObjectSafe(Path path, String label) {
        File file = path.toFile();
        if (!file.exists()) {
            return null;
        }
        try (FileReader reader = new FileReader(file, StandardCharsets.UTF_8)) {
            JsonElement parsed = JsonParser.parseReader(reader);
            if (parsed != null && parsed.isJsonObject()) {
                return parsed.getAsJsonObject();
            }
            LOG.warn("[McpServerManager] " + label + " is not a JSON object, ignoring");
            return null;
        } catch (Exception e) {
            LOG.warn("[McpServerManager] Failed to parse " + label + ": " + e.getMessage());
            return null;
        }
    }

    /**
     * Write a JSON object back to disk atomically (temp file + move) so a crash
     * mid-write can never truncate the user's config.
     */
    private static void writeJsonAtomic(Path path, JsonObject root) throws IOException {
        Path parent = path.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Path tmp = path.resolveSibling(path.getFileName() + ".tmp");
        try (FileWriter writer = new FileWriter(tmp.toFile(), StandardCharsets.UTF_8)) {
            PRETTY_GSON.toJson(root, writer);
            writer.flush();
        }
        try {
            Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            // ATOMIC_MOVE may be unsupported across some filesystems.
            Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    // ============================================================================
    // Qwen settings helpers
    // ============================================================================

    /**
     * Returns the {@code mcpServers} object of a settings-shaped root, or null
     * when absent or not a JSON object.
     */
    private static JsonObject getMcpServersObject(JsonObject root) {
        if (root == null || !root.has("mcpServers") || !root.get("mcpServers").isJsonObject()) {
            return null;
        }
        return root.getAsJsonObject("mcpServers");
    }

    /**
     * Collect disabled-server entries from a settings-shaped root: Qwen Code's
     * {@code mcp.excluded} (supports {@code *} wildcard patterns) plus the
     * legacy {@code disabledMcpServers} array.
     */
    private static void collectDisabledEntries(JsonObject root, Set<String> into) {
        if (root == null) {
            return;
        }
        if (root.has("mcp") && root.get("mcp").isJsonObject()) {
            JsonObject mcp = root.getAsJsonObject("mcp");
            if (mcp.has("excluded") && mcp.get("excluded").isJsonArray()) {
                for (JsonElement elem : mcp.getAsJsonArray("excluded")) {
                    if (elem.isJsonPrimitive() && !elem.getAsString().isEmpty()) {
                        into.add(elem.getAsString());
                    }
                }
            }
        }
        if (root.has("disabledMcpServers") && root.get("disabledMcpServers").isJsonArray()) {
            for (JsonElement elem : root.getAsJsonArray("disabledMcpServers")) {
                if (elem.isJsonPrimitive() && !elem.getAsString().isEmpty()) {
                    into.add(elem.getAsString());
                }
            }
        }
    }

    /**
     * Whether a server id is disabled by an exclusion entry (exact name or
     * {@code *} wildcard pattern). Mirrors Qwen Code's matchesServerPattern.
     */
    static boolean isExcluded(String serverId, Set<String> excludedEntries) {
        if (excludedEntries.contains(serverId)) {
            return true;
        }
        for (String entry : excludedEntries) {
            if (entry.indexOf('*') >= 0 && wildcardMatches(serverId, entry)) {
                return true;
            }
        }
        return false;
    }

    private static boolean wildcardMatches(String name, String pattern) {
        StringBuilder regex = new StringBuilder();
        for (char c : pattern.toCharArray()) {
            if (c == '*') {
                regex.append(".*");
            } else if (".+?^${}()|[]\\".indexOf(c) >= 0) {
                regex.append('\\').append(c);
            } else {
                regex.append(c);
            }
        }
        return Pattern.compile("^" + regex + "$").matcher(name).matches();
    }

    /**
     * Update a settings-shaped root's exclusion state for one server id.
     * Only exact-name entries are added/removed; user-defined wildcard
     * patterns are left untouched. Updates {@code mcp.excluded} (Qwen Code's
     * toggle field) and the legacy {@code disabledMcpServers} array when the
     * latter is present. No-op when there is nothing to change, so enabling a
     * server never sprouts empty config fields.
     */
    private static void updateExcludedState(JsonObject root, String serverId, boolean enabled) {
        // Qwen Code field: mcp.excluded
        JsonArray currentExcluded = null;
        if (root.has("mcp") && root.get("mcp").isJsonObject()) {
            JsonObject mcp = root.getAsJsonObject("mcp");
            if (mcp.has("excluded") && mcp.get("excluded").isJsonArray()) {
                currentExcluded = mcp.getAsJsonArray("excluded");
            }
        }
        if (currentExcluded != null || !enabled) {
            JsonArray rewritten = rewriteExcludedArray(
                    currentExcluded != null ? currentExcluded : new JsonArray(), serverId, enabled);
            if (!rewritten.equals(currentExcluded)) {
                if (!root.has("mcp") || !root.get("mcp").isJsonObject()) {
                    root.add("mcp", new JsonObject());
                }
                root.getAsJsonObject("mcp").add("excluded", rewritten);
            }
        }

        // Legacy field (kept in sync only when already present).
        if (root.has("disabledMcpServers") && root.get("disabledMcpServers").isJsonArray()) {
            JsonArray current = root.getAsJsonArray("disabledMcpServers");
            JsonArray rewritten = rewriteExcludedArray(current, serverId, enabled);
            if (!rewritten.equals(current)) {
                root.add("disabledMcpServers", rewritten);
            }
        }
    }

    private static JsonArray rewriteExcludedArray(JsonArray current, String serverId, boolean enabled) {
        JsonArray updated = new JsonArray();
        for (JsonElement elem : current) {
            if (!elem.isJsonPrimitive() || !elem.getAsString().equals(serverId)) {
                updated.add(elem);
            }
        }
        if (!enabled) {
            updated.add(serverId);
        }
        return updated;
    }

    /**
     * Merge a GUI-shaped server definition into a raw {@code mcpServers} map,
     * preserving existing fields not covered by the new definition.
     */
    private static void mergeServerSpec(JsonObject mcpServers, String serverId, JsonObject server) {
        JsonObject serverSpec;
        if (server.has("server") && server.get("server").isJsonObject()) {
            serverSpec = server.getAsJsonObject("server").deepCopy();
        } else {
            serverSpec = new JsonObject();
        }

        if (mcpServers.has(serverId) && mcpServers.get(serverId).isJsonObject()) {
            JsonObject existingSpec = mcpServers.getAsJsonObject(serverId).deepCopy();
            // Merge new config onto existing config (new values override matching fields)
            for (String key : serverSpec.keySet()) {
                existingSpec.add(key, serverSpec.get(key));
            }
            serverSpec = existingSpec;
        }

        mcpServers.add(serverId, serverSpec);
    }

    /**
     * Wrap a raw qwen/claude-style server entry into the GUI shape
     * (id/name/server spec/enabled) used by the webview.
     */
    private static JsonObject toGuiServer(String serverId, JsonObject rawSpec, boolean enabled) {
        JsonObject server = rawSpec.deepCopy();

        // Ensure id and name fields exist
        if (!server.has("id")) {
            server.addProperty("id", serverId);
        }
        if (!server.has("name")) {
            server.addProperty("name", serverId);
        }

        // Wrap type, command, args, env, etc. into the server field
        if (!server.has("server")) {
            JsonObject serverSpec = new JsonObject();

            // Copy all fields to the server spec (except special fields)
            Set<String> excludedFields = new HashSet<>();
            excludedFields.add("id");
            excludedFields.add("name");
            excludedFields.add("enabled");
            excludedFields.add("apps");
            excludedFields.add("server");

            for (String key : server.keySet()) {
                if (!excludedFields.contains(key)) {
                    serverSpec.add(key, server.get(key));
                }
            }

            server.add("server", serverSpec);
        }

        server.addProperty("enabled", enabled);
        return server;
    }

    /**
     * Read all MCP servers from the Qwen Code settings layout
     * (~/.qwen/settings.json + <project>/.qwen/settings.json).
     *
     * @return the GUI-shaped server list, or null when the qwen source is
     *         unavailable/invalid so callers can fall back to legacy sources.
     */
    private List<JsonObject> readQwenSettingsServers(String projectPath) {
        Path userFile = qwenSettingsPath();
        JsonObject userRoot = readJsonObjectSafe(userFile, "~/.qwen/settings.json");
        JsonObject projectRoot = projectPath != null
                ? readJsonObjectSafe(qwenProjectSettingsPath(projectPath), "<project>/.qwen/settings.json")
                : null;

        if (userRoot == null && projectRoot == null) {
            return null;
        }

        JsonObject userServers = getMcpServersObject(userRoot);
        JsonObject projectServers = getMcpServersObject(projectRoot);
        if (userServers == null && projectServers == null) {
            // Settings exist but carry no usable mcpServers block — let the
            // caller try the legacy source before showing an empty list.
            return null;
        }

        // Project entries override user entries with the same name.
        JsonObject mergedServers = new JsonObject();
        if (userServers != null) {
            for (String key : userServers.keySet()) {
                mergedServers.add(key, userServers.get(key));
            }
        }
        if (projectServers != null) {
            for (String key : projectServers.keySet()) {
                mergedServers.add(key, projectServers.get(key));
            }
        }

        Set<String> disabledEntries = new HashSet<>();
        collectDisabledEntries(userRoot, disabledEntries);
        collectDisabledEntries(projectRoot, disabledEntries);

        List<JsonObject> result = new ArrayList<>();
        for (String serverId : mergedServers.keySet()) {
            JsonElement serverElem = mergedServers.get(serverId);
            if (serverElem.isJsonObject()) {
                boolean enabled = !isExcluded(serverId, disabledEntries);
                result.add(toGuiServer(serverId, serverElem.getAsJsonObject(), enabled));
            }
        }

        LOG.info("[McpServerManager] Loaded " + result.size()
                + " MCP servers from qwen settings (excluded: " + disabledEntries.size() + ")");
        return result;
    }

    // ============================================================================
    // Public API
    // ============================================================================

    /**
     * Get all MCP servers.
     * Reads from ~/.qwen/settings.json first (Qwen Code settings), falling back
     * to ~/.qwenmate/config.json.
     * <p>
     * Note: global and project-level disabled lists are merged.
     */
    public List<JsonObject> getMcpServers() throws IOException {
        return getMcpServersWithProjectPath(null);
    }

    /**
     * Get all MCP servers (with project path support).
     * Merges global and project-level mcpServers; project-level servers override global ones with the same name.
     *
     * @param projectPath the project path, used to read project-level MCP configuration
     */
    public List<JsonObject> getMcpServersWithProjectPath(String projectPath) throws IOException {
        // 1. Qwen Code settings (~/.qwen/settings.json + <project>/.qwen/settings.json)
        List<JsonObject> qwenResult = readQwenSettingsServers(projectPath);
        if (qwenResult != null) {
            return qwenResult;
        }

        List<JsonObject> result = new ArrayList<>();

        // 2. Fall back to ~/.qwenmate/config.json (array format)
        JsonObject config = configReader.apply(null);
        if (config.has("mcpServers")) {
            JsonArray servers = config.getAsJsonArray("mcpServers");
            for (JsonElement elem : servers) {
                if (elem.isJsonObject()) {
                    result.add(elem.getAsJsonObject());
                }
            }
        }

        LOG.info("[McpServerManager] Loaded " + result.size() + " MCP servers from ~/.qwenmate/config.json");
        return result;
    }

    /**
     * Upsert (update or insert) an MCP server.
     * Prefers updating ~/.qwen/settings.json (Qwen Code settings), falling
     * back to ~/.qwenmate/config.json.
     */
    public void upsertMcpServer(JsonObject server) throws IOException {
        upsertMcpServer(server, null);
    }

    /**
     * Upsert (update or insert) an MCP server (with project path support).
     *
     * @param projectPath the project path, used to update project-level exclusion state
     *                    (global and project-level disabled lists are merged by readers)
     */
    public void upsertMcpServer(JsonObject server, String projectPath) throws IOException {
        if (!server.has("id")) {
            throw new IllegalArgumentException("Server must have an id");
        }

        String serverId = server.get("id").getAsString();
        boolean isEnabled = !server.has("enabled") || server.get("enabled").getAsBoolean();

        // 1. Try to update ~/.qwen/settings.json (Qwen Code settings).
        // Never touch an unparseable file — the user's config must not be clobbered.
        Path userFile = qwenSettingsPath();
        JsonObject userRoot = readJsonObjectSafe(userFile, "~/.qwen/settings.json");
        boolean qwenUserFileCorrupt = userRoot == null && Files.exists(userFile);
        if (!qwenUserFileCorrupt) {
            try {
                if (userRoot == null) {
                    userRoot = new JsonObject();
                }
                if (!userRoot.has("mcpServers") || !userRoot.get("mcpServers").isJsonObject()) {
                    userRoot.add("mcpServers", new JsonObject());
                }
                JsonObject mcpServers = userRoot.getAsJsonObject("mcpServers");
                mergeServerSpec(mcpServers, serverId, server);

                if (projectPath == null) {
                    updateExcludedState(userRoot, serverId, isEnabled);
                } else if (isEnabled) {
                    // Enabling also clears any global exclusion entry.
                    updateExcludedState(userRoot, serverId, true);
                }

                writeJsonAtomic(userFile, userRoot);

                if (projectPath != null) {
                    Path projectFile = qwenProjectSettingsPath(projectPath);
                    JsonObject projectRoot = readJsonObjectSafe(projectFile, "<project>/.qwen/settings.json");
                    if (projectRoot == null && Files.exists(projectFile)) {
                        LOG.warn("[McpServerManager] Project qwen settings unparseable, "
                                + "skipping project exclusion update: " + projectFile);
                    } else {
                        if (projectRoot == null) {
                            projectRoot = new JsonObject();
                        }
                        updateExcludedState(projectRoot, serverId, isEnabled);
                        writeJsonAtomic(projectFile, projectRoot);
                    }
                }

                LOG.info("[McpServerManager] Upserted MCP server in ~/.qwen/settings.json: " + serverId
                        + " (enabled: " + isEnabled + ", projectPath: " + (projectPath != null ? projectPath : "(global)") + ")");
                return;
            } catch (Exception e) {
                LOG.warn("[McpServerManager] Error updating ~/.qwen/settings.json: " + e.getMessage());
            }
        } else {
            LOG.warn("[McpServerManager] ~/.qwen/settings.json is unparseable, "
                    + "refusing to overwrite it; falling back to legacy config");
        }

        // 2. Fall back to ~/.qwenmate/config.json
        JsonObject config = configReader.apply(null);
        JsonArray servers;

        if (config.has("mcpServers")) {
            servers = config.getAsJsonArray("mcpServers");
        } else {
            servers = new JsonArray();
            config.add("mcpServers", servers);
        }

        boolean found = false;

        // Find and update
        for (int i = 0; i < servers.size(); i++) {
            JsonObject s = servers.get(i).getAsJsonObject();
            if (s.has("id") && s.get("id").getAsString().equals(serverId)) {
                servers.set(i, server); // Replace
                found = true;
                break;
            }
        }

        if (!found) {
            servers.add(server);
        }

        configWriter.accept(config);
        LOG.info("[McpServerManager] Upserted MCP server in ~/.qwenmate/config.json: " + serverId);
    }

    /**
     * Delete an MCP server.
     * Prefers deleting from ~/.qwen/settings.json (Qwen Code settings), falling
     * back to ~/.qwenmate/config.json.
     */
    public boolean deleteMcpServer(String serverId) throws IOException {
        boolean removed = false;

        // 1. Try to delete from ~/.qwen/settings.json
        Path userFile = qwenSettingsPath();
        JsonObject userRoot = readJsonObjectSafe(userFile, "~/.qwen/settings.json");
        if (userRoot != null) {
            try {
                JsonObject mcpServers = getMcpServersObject(userRoot);
                if (mcpServers != null && mcpServers.has(serverId)) {
                    mcpServers.remove(serverId);
                    updateExcludedState(userRoot, serverId, true); // drop exclusion entries
                    writeJsonAtomic(userFile, userRoot);
                    LOG.info("[McpServerManager] Deleted MCP server from ~/.qwen/settings.json: " + serverId);
                    return true;
                }
            } catch (Exception e) {
                LOG.warn("[McpServerManager] Error deleting from ~/.qwen/settings.json: " + e.getMessage());
            }
        } else if (Files.exists(userFile)) {
            LOG.warn("[McpServerManager] ~/.qwen/settings.json is unparseable, "
                    + "refusing to overwrite it; falling back to legacy config");
        }

        // 2. Fall back to ~/.qwenmate/config.json
        JsonObject config = configReader.apply(null);
        if (config.has("mcpServers")) {
            JsonArray servers = config.getAsJsonArray("mcpServers");
            JsonArray newServers = new JsonArray();

            for (JsonElement elem : servers) {
                JsonObject s = elem.getAsJsonObject();
                if (s.has("id") && s.get("id").getAsString().equals(serverId)) {
                    removed = true;
                } else {
                    newServers.add(s);
                }
            }

            if (removed) {
                config.add("mcpServers", newServers);
                configWriter.accept(config);
                LOG.info("[McpServerManager] Deleted MCP server from ~/.qwenmate/config.json: " + serverId);
            }
        }

        return removed;
    }

    /**
     * Validate MCP server configuration.
     */
    public Map<String, Object> validateMcpServer(JsonObject server) {
        List<String> errors = new ArrayList<>();

        if (!server.has("name") || server.get("name").getAsString().isEmpty()) {
            errors.add("Server name must not be empty");
        }

        if (server.has("server")) {
            JsonObject serverSpec = server.getAsJsonObject("server");
            String type = serverSpec.has("type") ? serverSpec.get("type").getAsString() : "stdio";

            if ("stdio".equals(type)) {
                if (!serverSpec.has("command") || serverSpec.get("command").getAsString().isEmpty()) {
                    errors.add("Command must not be empty");
                }
            } else if ("http".equals(type) || "sse".equals(type)) {
                if (!serverSpec.has("url") || serverSpec.get("url").getAsString().isEmpty()) {
                    errors.add("URL must not be empty");
                } else {
                    String url = serverSpec.get("url").getAsString();
                    try {
                        new java.net.URI(url).toURL();
                    } catch (Exception e) {
                        errors.add("Invalid URL format");
                    }
                }
            } else {
                errors.add("Unsupported connection type: " + type);
            }
        } else {
            errors.add("Missing server configuration details");
        }

        Map<String, Object> result = new HashMap<>();
        result.put("valid", errors.isEmpty());
        result.put("errors", errors);
        return result;
    }
}
