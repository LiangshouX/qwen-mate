package com.qwenmate.mcp.marketplace;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Loads MCP-related repositories from a GitHub organization.
 */
final class GitHubOrgMarketplaceClient {

    private static final int MAX_PAGES = 5;

    private final McpMarketplaceHttpClient httpClient;

    GitHubOrgMarketplaceClient(McpMarketplaceHttpClient httpClient) {
        this.httpClient = httpClient;
    }

    List<McpMarketplaceEntry> loadEntries(McpMarketplaceSource source, boolean forceRefresh) throws IOException {
        List<McpMarketplaceEntry> entries = new ArrayList<>();
        String organization = extractOrganizationName(source.getUrl());
        for (int page = 1; page <= MAX_PAGES; page++) {
            String url = "https://api.github.com/orgs/" + organization
                + "/repos?type=public&per_page=100&sort=stars&direction=desc&page=" + page;
            String json = httpClient.get(url, source.getId() + "_page_" + page, forceRefresh);
            JsonArray repos = JsonParser.parseString(json).getAsJsonArray();
            if (repos.size() == 0) {
                break;
            }
            for (JsonElement element : repos) {
                if (element.isJsonObject()) {
                    McpMarketplaceEntry entry = McpRegistryEntryMapper.fromGitHubRepo(element.getAsJsonObject(), source);
                    if (entry != null) {
                        entries.add(entry);
                    }
                }
            }
            if (repos.size() < 100) {
                break;
            }
        }
        return entries;
    }

    private static String extractOrganizationName(String url) {
        String value = url.trim();
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        int index = value.lastIndexOf('/');
        return index >= 0 ? value.substring(index + 1) : value;
    }
}
