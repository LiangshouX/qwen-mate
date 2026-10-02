package com.qwenmate.settings;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * MCP config read/write against the Qwen Code settings layout
 * (~/.qwen/settings.json): normal reads, missing file, corrupt JSON, and
 * preservation of unrelated fields on write.
 */
public class McpServerManagerQwenSettingsTest {

    private Path home;
    private Path qwenSettings;
    private Path claudeJson;
    private AtomicReference<JsonObject> qwenmateConfig;
    private McpServerManager manager;

    @Before
    public void setUp() throws IOException {
        home = Files.createTempDirectory("mcp-qwen-home");
        qwenSettings = home.resolve(".qwen").resolve("settings.json");
        claudeJson = home.resolve(".claude.json");
        qwenmateConfig = new AtomicReference<>(new JsonObject());
        manager = new McpServerManager(
                new Gson(),
                v -> qwenmateConfig.get(),
                qwenmateConfig::set,
                home::toString);
    }

    private void writeQwenSettings(String json) throws IOException {
        Files.createDirectories(qwenSettings.getParent());
        Files.writeString(qwenSettings, json, StandardCharsets.UTF_8);
    }

    private JsonObject readQwenSettings() throws IOException {
        return JsonParser.parseString(Files.readString(qwenSettings, StandardCharsets.UTF_8)).getAsJsonObject();
    }

    private static JsonObject guiServer(String id, String command) {
        JsonObject spec = new JsonObject();
        spec.addProperty("command", command);
        JsonObject server = new JsonObject();
        server.addProperty("id", id);
        server.addProperty("name", id);
        server.add("server", spec);
        server.addProperty("enabled", true);
        return server;
    }

    // ==================== Reading ====================

    @Test
    public void readsServersFromQwenSettingsWithGuiShape() throws IOException {
        writeQwenSettings("""
                {
                  "env": { "KEEP": "me" },
                  "mcpServers": {
                    "alpha": { "type": "stdio", "command": "node", "args": ["a.js"] },
                    "beta": { "command": "node" }
                  }
                }
                """);

        List<JsonObject> servers = manager.getMcpServersWithProjectPath(null);
        assertEquals(2, servers.size());

        JsonObject alpha = findById(servers, "alpha");
        assertNotNull(alpha);
        assertEquals("alpha", alpha.get("name").getAsString());
        assertTrue(alpha.get("enabled").getAsBoolean());
        JsonObject spec = alpha.getAsJsonObject("server");
        assertEquals("node", spec.get("command").getAsString());
        assertEquals("stdio", spec.get("type").getAsString());
    }

    @Test
    public void excludedServersAreMarkedDisabled() throws IOException {
        writeQwenSettings("""
                {
                  "mcpServers": {
                    "on": { "command": "node" },
                    "off": { "command": "node" },
                    "wild-off": { "command": "node" }
                  },
                  "mcp": { "excluded": ["off", "wild-*"] }
                }
                """);

        List<JsonObject> servers = manager.getMcpServersWithProjectPath(null);
        assertEquals(3, servers.size());
        assertTrue(findById(servers, "on").get("enabled").getAsBoolean());
        assertFalse(findById(servers, "off").get("enabled").getAsBoolean());
        assertFalse(findById(servers, "wild-off").get("enabled").getAsBoolean());
    }

    @Test
    public void ignoresLegacyClaudeJsonWhenQwenSettingsMissing() throws IOException {
        Files.writeString(claudeJson, """
                { "mcpServers": { "legacy": { "command": "node" } } }
                """, StandardCharsets.UTF_8);

        List<JsonObject> servers = manager.getMcpServersWithProjectPath(null);
        assertTrue(servers.isEmpty());
    }

    @Test
    public void degradesGracefullyWhenQwenSettingsCorrupt() throws IOException {
        writeQwenSettings("{ this is not valid json");
        Files.writeString(claudeJson, """
                { "mcpServers": { "legacy": { "command": "node" } } }
                """, StandardCharsets.UTF_8);

        List<JsonObject> servers = manager.getMcpServersWithProjectPath(null);
        assertTrue(servers.isEmpty());
    }

    @Test
    public void returnsEmptyListWhenNoSourceExists() throws IOException {
        List<JsonObject> servers = manager.getMcpServersWithProjectPath(null);
        assertTrue(servers.isEmpty());
    }

    // ==================== Writing ====================

    @Test
    public void upsertPreservesUnrelatedFields() throws IOException {
        writeQwenSettings("""
                {
                  "$version": 4,
                  "env": { "API_KEY": "secret" },
                  "model": { "name": "mimo-v2.6-pro" },
                  "mcpServers": {
                    "other": { "command": "keep-me", "args": ["x"] }
                  },
                  "ui": { "autoModeAcknowledged": true }
                }
                """);

        manager.upsertMcpServer(guiServer("added", "new-cmd"));

        JsonObject root = readQwenSettings();
        // Unrelated fields survive untouched.
        assertEquals(4, root.get("$version").getAsInt());
        assertEquals("secret", root.getAsJsonObject("env").get("API_KEY").getAsString());
        assertEquals("mimo-v2.6-pro", root.getAsJsonObject("model").get("name").getAsString());
        assertTrue(root.getAsJsonObject("ui").get("autoModeAcknowledged").getAsBoolean());
        // Existing and new servers are both present.
        JsonObject mcpServers = root.getAsJsonObject("mcpServers");
        assertTrue(mcpServers.has("other"));
        assertEquals("keep-me", mcpServers.getAsJsonObject("other").get("command").getAsString());
        assertEquals("new-cmd", mcpServers.getAsJsonObject("added").get("command").getAsString());
    }

    @Test
    public void upsertDisableWritesQwenExcludedWithoutClobbering() throws IOException {
        writeQwenSettings("""
                {
                  "env": { "KEEP": "yes" },
                  "mcpServers": { "srv": { "command": "node" } }
                }
                """);

        JsonObject disabled = guiServer("srv", "node");
        disabled.addProperty("enabled", false);
        manager.upsertMcpServer(disabled);

        JsonObject root = readQwenSettings();
        assertEquals("yes", root.getAsJsonObject("env").get("KEEP").getAsString());
        JsonArray excluded = root.getAsJsonObject("mcp").getAsJsonArray("excluded");
        assertEquals(1, excluded.size());
        assertEquals("srv", excluded.get(0).getAsString());
    }

    @Test
    public void upsertEnableRemovesQwenExcludedEntry() throws IOException {
        writeQwenSettings("""
                {
                  "mcpServers": { "srv": { "command": "node" } },
                  "mcp": { "excluded": ["srv", "other-pattern"] }
                }
                """);

        manager.upsertMcpServer(guiServer("srv", "node"));

        JsonObject root = readQwenSettings();
        JsonArray excluded = root.getAsJsonObject("mcp").getAsJsonArray("excluded");
        assertEquals(1, excluded.size());
        assertEquals("other-pattern", excluded.get(0).getAsString());
    }

    @Test
    public void upsertNeverClobbersCorruptQwenSettings() throws IOException {
        String corrupt = "{ this is not valid json";
        writeQwenSettings(corrupt);

        // No other source exists, so the write falls back to ~/.qwenmate/config.json
        manager.upsertMcpServer(guiServer("srv", "node"));

        assertEquals(corrupt, Files.readString(qwenSettings, StandardCharsets.UTF_8));
        assertEquals(1, qwenmateConfig.get().getAsJsonArray("mcpServers").size());
    }

    @Test
    public void deleteRemovesServerAndPreservesFields() throws IOException {
        writeQwenSettings("""
                {
                  "env": { "KEEP": "yes" },
                  "mcpServers": {
                    "srv": { "command": "node" },
                    "stay": { "command": "other" }
                  },
                  "mcp": { "excluded": ["srv"] }
                }
                """);

        boolean removed = manager.deleteMcpServer("srv");
        assertTrue(removed);

        JsonObject root = readQwenSettings();
        assertEquals("yes", root.getAsJsonObject("env").get("KEEP").getAsString());
        JsonObject mcpServers = root.getAsJsonObject("mcpServers");
        assertFalse(mcpServers.has("srv"));
        assertTrue(mcpServers.has("stay"));
        // The exclusion entry for the deleted server is cleaned up too.
        assertEquals(0, root.getAsJsonObject("mcp").getAsJsonArray("excluded").size());
    }

    @Test
    public void upsertMergesWithExistingServerSpecFields() throws IOException {
        writeQwenSettings("""
                {
                  "mcpServers": {
                    "srv": { "command": "node", "args": ["old.js"], "env": { "TOKEN": "t" }, "trust": true }
                  }
                }
                """);

        JsonObject update = guiServer("srv", "node-updated");
        manager.upsertMcpServer(update);

        JsonObject spec = readQwenSettings().getAsJsonObject("mcpServers").getAsJsonObject("srv");
        assertEquals("node-updated", spec.get("command").getAsString());
        // Fields not covered by the update are preserved.
        assertEquals("old.js", spec.getAsJsonArray("args").get(0).getAsString());
        assertEquals("t", spec.getAsJsonObject("env").get("TOKEN").getAsString());
        assertTrue(spec.get("trust").getAsBoolean());
    }

    private static JsonObject findById(List<JsonObject> servers, String id) {
        for (JsonObject server : servers) {
            if (server.has("id") && id.equals(server.get("id").getAsString())) {
                return server;
            }
        }
        return null;
    }
}
