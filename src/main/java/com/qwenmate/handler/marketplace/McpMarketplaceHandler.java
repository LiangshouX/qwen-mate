package com.qwenmate.handler.marketplace;

import com.qwenmate.handler.core.BaseMessageHandler;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.mcp.marketplace.McpMarketplaceEntry;
import com.qwenmate.mcp.marketplace.McpMarketplaceService;
import com.qwenmate.mcp.marketplace.McpMarketplaceSource;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;

import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Handles MCP marketplace discovery requests from the webview.
 */
public final class McpMarketplaceHandler extends BaseMessageHandler {

    private static final Logger LOG = Logger.getInstance(McpMarketplaceHandler.class);

    private static final String[] SUPPORTED_TYPES = {
        "get_mcp_marketplace_sources",
        "search_mcp_marketplace"
    };

    private final Gson gson;
    private final McpMarketplaceService marketplaceService;

    public McpMarketplaceHandler(HandlerContext context) {
        this(context, new McpMarketplaceService());
    }

    McpMarketplaceHandler(HandlerContext context, McpMarketplaceService marketplaceService) {
        super(context);
        this.gson = new Gson();
        this.marketplaceService = marketplaceService;
    }

    @Override
    public String[] getSupportedTypes() {
        return SUPPORTED_TYPES;
    }

    @Override
    public boolean handle(String type, String content) {
        switch (type) {
            case "get_mcp_marketplace_sources":
                handleGetSources();
                return true;
            case "search_mcp_marketplace":
                handleSearch(content);
                return true;
            default:
                return false;
        }
    }

    private void handleGetSources() {
        List<McpMarketplaceSource> sources = marketplaceService.getSources();
        String json = gson.toJson(sources);
        ApplicationManager.getApplication().invokeLater(() -> callJavaScript("window.updateMcpMarketplaceSources", escapeJs(json)));
    }

    private void handleSearch(String content) {
        CompletableFuture.runAsync(() -> {
            JsonObject response = new JsonObject();
            try {
                SearchRequest request = parseSearchRequest(content);
                response.addProperty("query", request.query);
                response.addProperty("sourceId", request.sourceId);
                List<McpMarketplaceEntry> entries = marketplaceService.search(request.query, request.sourceId, request.forceRefresh);
                response.add("entries", gson.toJsonTree(entries));
            } catch (Exception e) {
                LOG.warn("Failed to search MCP marketplace: " + e.getMessage());
                if (!response.has("entries")) {
                    response.add("entries", new JsonArray());
                }
                response.addProperty("error", e.getMessage());
            }
            String json = gson.toJson(response);
            ApplicationManager.getApplication().invokeLater(() -> callJavaScript("window.updateMcpMarketplaceEntries", escapeJs(json)));
        });
    }

    private SearchRequest parseSearchRequest(String content) {
        if (content == null || content.trim().isEmpty()) {
            return new SearchRequest("", "built-in", false);
        }
        JsonObject object = gson.fromJson(content, JsonObject.class);
        String query = getString(object, "query", "");
        String sourceId = getString(object, "sourceId", "all");
        boolean forceRefresh = object.has("forceRefresh") && !object.get("forceRefresh").isJsonNull() && object.get("forceRefresh").getAsBoolean();
        return new SearchRequest(query, sourceId, forceRefresh);
    }

    private static String getString(JsonObject object, String key, String fallback) {
        if (object != null && object.has(key) && !object.get(key).isJsonNull()) {
            return object.get(key).getAsString();
        }
        return fallback;
    }

    private static final class SearchRequest {
        private final String query;
        private final String sourceId;
        private final boolean forceRefresh;

        private SearchRequest(String query, String sourceId, boolean forceRefresh) {
            this.query = query;
            this.sourceId = sourceId;
            this.forceRefresh = forceRefresh;
        }
    }
}
