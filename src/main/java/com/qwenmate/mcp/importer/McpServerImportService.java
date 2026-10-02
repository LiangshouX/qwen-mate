package com.qwenmate.mcp.importer;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Maps an external MCP configuration into the internal MCP server entries used by the
 * existing add/save path. The first supported format is the GitHub Copilot config, whose
 * root key is {@code servers} (as opposed to the Claude/manual {@code mcpServers} format).
 *
 * <p>The mapping mirrors the webview manual import so imported servers are indistinguishable
 * from manually added ones.
 */
public final class McpServerImportService {

    /** Fields copied verbatim from a Copilot server entry into the internal server spec. */
    private static final String[] PASS_THROUGH_FIELDS = {
        "command", "args", "env", "url", "type", "x-metadata"
    };

    /**
     * Parses a GitHub Copilot MCP configuration ({@code { "servers": { ... } }}) and returns
     * the internal MCP server entries.
     *
     * @param config      the parsed configuration JSON
     * @param isCodexMode whether the active provider is Codex (controls the {@code apps} flags)
     * @return one internal server JSON object per entry under {@code servers}
     * @throws IllegalArgumentException if the configuration does not contain a {@code servers} object
     */
    public List<JsonObject> parseCopilotConfig(JsonObject config, boolean isCodexMode) {
        if (config == null || !config.has("servers") || !config.get("servers").isJsonObject()) {
            throw new IllegalArgumentException("Configuration must contain a \"servers\" object.");
        }

        JsonObject servers = config.getAsJsonObject("servers");
        List<JsonObject> result = new ArrayList<>();
        for (Map.Entry<String, JsonElement> entry : servers.entrySet()) {
            if (!entry.getValue().isJsonObject()) {
                continue;
            }
            result.add(toInternalServer(entry.getKey(), entry.getValue().getAsJsonObject(), isCodexMode));
        }

        if (result.isEmpty()) {
            throw new IllegalArgumentException("No servers found in the configuration.");
        }
        return result;
    }

    private JsonObject toInternalServer(String id, JsonObject source, boolean isCodexMode) {
        JsonObject spec = new JsonObject();

        for (String field : PASS_THROUGH_FIELDS) {
            if (source.has(field) && !source.get(field).isJsonNull()) {
                spec.add(field, source.get(field));
            }
        }

        JsonObject headers = collectHeaders(source);
        if (headers.size() > 0) {
            spec.add("headers", headers);
        }

        if (!spec.has("type")) {
            spec.addProperty("type", inferType(spec));
        }

        JsonObject apps = new JsonObject();
        apps.addProperty("claude", !isCodexMode);
        apps.addProperty("codex", isCodexMode);
        apps.addProperty("gemini", false);

        String name = getString(source, "name");

        JsonObject server = new JsonObject();
        server.addProperty("id", id);
        server.addProperty("name", name != null ? name : id);
        server.add("server", spec);
        server.add("apps", apps);
        server.addProperty("enabled", true);
        return server;
    }

    /**
     * Merges {@code requestInit.headers} and the direct {@code headers}, dropping null values.
     * Direct headers take precedence over {@code requestInit.headers}.
     */
    private JsonObject collectHeaders(JsonObject source) {
        JsonObject merged = new JsonObject();

        if (source.has("requestInit") && source.get("requestInit").isJsonObject()) {
            JsonObject requestInit = source.getAsJsonObject("requestInit");
            if (requestInit.has("headers") && requestInit.get("headers").isJsonObject()) {
                copyNonNull(requestInit.getAsJsonObject("headers"), merged);
            }
        }

        if (source.has("headers") && source.get("headers").isJsonObject()) {
            copyNonNull(source.getAsJsonObject("headers"), merged);
        }

        return merged;
    }

    private static void copyNonNull(JsonObject from, JsonObject into) {
        for (Map.Entry<String, JsonElement> header : from.entrySet()) {
            if (header.getValue() != null && !header.getValue().isJsonNull()) {
                into.add(header.getKey(), header.getValue());
            }
        }
    }

    /**
     * Infers the connection type when the source omits it:
     * a command implies {@code stdio}, a {@code /sse} URL implies {@code sse},
     * any other URL implies {@code http}, otherwise {@code stdio}.
     */
    private static String inferType(JsonObject spec) {
        if (spec.has("command") && !spec.get("command").isJsonNull()) {
            return "stdio";
        }
        String url = getString(spec, "url");
        if (url != null) {
            return url.contains("/sse") ? "sse" : "http";
        }
        return "stdio";
    }

    private static String getString(JsonObject object, String key) {
        if (object.has(key) && object.get(key).isJsonPrimitive()) {
            return object.get(key).getAsString();
        }
        return null;
    }
}
