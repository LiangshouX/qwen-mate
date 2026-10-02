package com.qwenmate.handler.importer;

import com.qwenmate.handler.core.BaseMessageHandler;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.mcp.importer.McpServerImportService;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;

import java.util.List;

/**
 * Parses an external MCP configuration (currently the GitHub Copilot format) into internal
 * server entries and sends them back to the webview as an import preview. Persisting the
 * previewed servers stays on the existing add/save path in the webview.
 */
public final class McpServerImportHandler extends BaseMessageHandler {

    private static final Logger LOG = Logger.getInstance(McpServerImportHandler.class);

    private static final String[] SUPPORTED_TYPES = {
        "parse_copilot_mcp_config"
    };

    private final Gson gson;
    private final McpServerImportService importService;

    public McpServerImportHandler(HandlerContext context) {
        this(context, new McpServerImportService());
    }

    McpServerImportHandler(HandlerContext context, McpServerImportService importService) {
        super(context);
        this.gson = new Gson();
        this.importService = importService;
    }

    @Override
    public String[] getSupportedTypes() {
        return SUPPORTED_TYPES;
    }

    @Override
    public boolean handle(String type, String content) {
        if ("parse_copilot_mcp_config".equals(type)) {
            handleParseCopilotConfig(content);
            return true;
        }
        return false;
    }

    private void handleParseCopilotConfig(String content) {
        JsonObject response = new JsonObject();
        try {
            JsonObject request = gson.fromJson(content, JsonObject.class);
            boolean isCodexMode = request != null
                && request.has("isCodexMode")
                && !request.get("isCodexMode").isJsonNull()
                && request.get("isCodexMode").getAsBoolean();

            String rawJson = request != null && request.has("json") && !request.get("json").isJsonNull()
                ? request.get("json").getAsString()
                : null;
            if (rawJson == null || rawJson.trim().isEmpty()) {
                throw new IllegalArgumentException("Configuration is empty.");
            }

            JsonObject config = gson.fromJson(rawJson, JsonObject.class);
            List<JsonObject> servers = importService.parseCopilotConfig(config, isCodexMode);
            response.add("servers", gson.toJsonTree(servers));
        } catch (Exception e) {
            LOG.warn("Failed to parse Copilot MCP config: " + e.getMessage());
            response.add("servers", new JsonArray());
            response.addProperty("error", e.getMessage());
        }

        String json = gson.toJson(response);
        ApplicationManager.getApplication().invokeLater(
            () -> callJavaScript("window.updateCopilotImportPreview", escapeJs(json)));
    }
}
