package com.qwenmate.mcp.marketplace;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Loads server entries from an MCP Registry v0.1 compatible API.
 */
final class RegistryMarketplaceClient {

    private static final int PAGE_LIMIT = 100;
    private static final int MAX_PAGES = 20;

    private final McpMarketplaceHttpClient httpClient;

    RegistryMarketplaceClient(McpMarketplaceHttpClient httpClient) {
        this.httpClient = httpClient;
    }

    List<McpMarketplaceEntry> loadEntries(McpMarketplaceSource source, boolean forceRefresh) throws IOException {
        Map<String, McpMarketplaceEntry> entries = new LinkedHashMap<>();
        String cursor = null;
        int page = 0;
        do {
            String url = buildPageUrl(source.getUrl(), cursor);
            String cacheKey = source.getId() + "_page_" + page + "_" + (cursor != null ? Math.abs(cursor.hashCode()) : "first");
            String json = httpClient.get(url, cacheKey, forceRefresh);
            JsonObject root = JsonParser.parseString(json).getAsJsonObject();
            JsonArray servers = McpMarketplaceJson.getArray(root, "servers");
            if (servers != null) {
                for (JsonElement element : servers) {
                    if (element.isJsonObject()) {
                        McpMarketplaceEntry entry = McpRegistryEntryMapper.fromRegistryObject(element.getAsJsonObject(), source);
                        if (entry.getName() != null && !entries.containsKey(entry.getName())) {
                            entries.put(entry.getName(), entry);
                        }
                    }
                }
            }
            cursor = readNextCursor(root);
            page++;
        } while (cursor != null && page < MAX_PAGES);
        return new ArrayList<>(entries.values());
    }

    private static String buildPageUrl(String baseUrl, String cursor) {
        StringBuilder url = new StringBuilder(trimTrailingSlash(baseUrl));
        url.append("/v0.1/servers?limit=").append(PAGE_LIMIT);
        if (cursor != null && !cursor.trim().isEmpty()) {
            url.append("&cursor=").append(URLEncoder.encode(cursor, StandardCharsets.UTF_8));
        }
        return url.toString();
    }

    private static String readNextCursor(JsonObject root) {
        JsonObject metadata = McpMarketplaceJson.getObject(root, "metadata");
        String cursor = firstValue(
            McpMarketplaceJson.getString(metadata, "next_cursor"),
            McpMarketplaceJson.getString(metadata, "nextCursor")
        );
        return cursor != null && !cursor.trim().isEmpty() ? cursor : null;
    }

    private static String trimTrailingSlash(String value) {
        String trimmed = value.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }

    private static String firstValue(String first, String second) {
        if (first != null && !first.trim().isEmpty()) {
            return first;
        }
        return second;
    }
}
