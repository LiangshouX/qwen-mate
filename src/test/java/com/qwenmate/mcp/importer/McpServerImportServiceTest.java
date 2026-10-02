package com.qwenmate.mcp.importer;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import org.junit.Assert;
import org.junit.Test;

import java.util.List;

public class McpServerImportServiceTest {

    private final McpServerImportService service = new McpServerImportService();
    private final Gson gson = new Gson();

    private JsonObject parse(String json) {
        return gson.fromJson(json, JsonObject.class);
    }

    private JsonObject single(String configJson, boolean codex) {
        List<JsonObject> servers = service.parseCopilotConfig(parse(configJson), codex);
        Assert.assertEquals(1, servers.size());
        return servers.get(0);
    }

    @Test
    public void infersStdioFromCommandAndPreservesFields() {
        JsonObject server = single(
            "{\"servers\":{\"fs\":{\"command\":\"npx\",\"args\":[\"-y\",\"server-fs\"],\"env\":{\"A\":\"1\"}}}}",
            false);
        Assert.assertEquals("fs", server.get("id").getAsString());
        Assert.assertEquals("fs", server.get("name").getAsString());
        JsonObject spec = server.getAsJsonObject("server");
        Assert.assertEquals("stdio", spec.get("type").getAsString());
        Assert.assertEquals("npx", spec.get("command").getAsString());
        Assert.assertEquals(2, spec.getAsJsonArray("args").size());
        Assert.assertEquals("1", spec.getAsJsonObject("env").get("A").getAsString());
    }

    @Test
    public void infersSseFromSseUrlAndHttpOtherwise() {
        JsonObject sse = single("{\"servers\":{\"a\":{\"url\":\"https://x.dev/sse\"}}}", false);
        Assert.assertEquals("sse", sse.getAsJsonObject("server").get("type").getAsString());

        JsonObject http = single("{\"servers\":{\"a\":{\"url\":\"https://x.dev/mcp\"}}}", false);
        Assert.assertEquals("http", http.getAsJsonObject("server").get("type").getAsString());
    }

    @Test
    public void explicitTypeIsKept() {
        JsonObject server = single("{\"servers\":{\"a\":{\"url\":\"https://x.dev/sse\",\"type\":\"http\"}}}", false);
        Assert.assertEquals("http", server.getAsJsonObject("server").get("type").getAsString());
    }

    @Test
    public void mergesRequestInitHeadersWithDirectHeadersAndDropsNulls() {
        JsonObject server = single(
            "{\"servers\":{\"a\":{\"url\":\"https://x.dev/mcp\","
                + "\"requestInit\":{\"headers\":{\"X-From-Init\":\"1\",\"Drop\":null}},"
                + "\"headers\":{\"Authorization\":\"Bearer t\",\"AlsoDrop\":null}}}}",
            false);
        JsonObject headers = server.getAsJsonObject("server").getAsJsonObject("headers");
        Assert.assertEquals("1", headers.get("X-From-Init").getAsString());
        Assert.assertEquals("Bearer t", headers.get("Authorization").getAsString());
        Assert.assertFalse(headers.has("Drop"));
        Assert.assertFalse(headers.has("AlsoDrop"));
    }

    @Test
    public void directHeaderOverridesRequestInitHeader() {
        JsonObject server = single(
            "{\"servers\":{\"a\":{\"url\":\"https://x.dev/mcp\","
                + "\"requestInit\":{\"headers\":{\"Authorization\":\"old\"}},"
                + "\"headers\":{\"Authorization\":\"new\"}}}}",
            false);
        JsonObject headers = server.getAsJsonObject("server").getAsJsonObject("headers");
        Assert.assertEquals("new", headers.get("Authorization").getAsString());
    }

    @Test
    public void appsReflectProviderMode() {
        JsonObject claude = single("{\"servers\":{\"a\":{\"command\":\"x\"}}}", false);
        Assert.assertTrue(claude.getAsJsonObject("apps").get("claude").getAsBoolean());
        Assert.assertFalse(claude.getAsJsonObject("apps").get("codex").getAsBoolean());

        JsonObject codex = single("{\"servers\":{\"a\":{\"command\":\"x\"}}}", true);
        Assert.assertFalse(codex.getAsJsonObject("apps").get("claude").getAsBoolean());
        Assert.assertTrue(codex.getAsJsonObject("apps").get("codex").getAsBoolean());
    }

    @Test
    public void preservesXMetadata() {
        JsonObject server = single(
            "{\"servers\":{\"a\":{\"command\":\"x\",\"x-metadata\":{\"origin\":\"copilot\"}}}}", false);
        Assert.assertEquals("copilot",
            server.getAsJsonObject("server").getAsJsonObject("x-metadata").get("origin").getAsString());
    }

    @Test(expected = IllegalArgumentException.class)
    public void missingServersRootThrows() {
        service.parseCopilotConfig(parse("{\"mcpServers\":{\"a\":{\"command\":\"x\"}}}"), false);
    }

    @Test(expected = IllegalArgumentException.class)
    public void emptyServersThrows() {
        service.parseCopilotConfig(parse("{\"servers\":{}}"), false);
    }
}
