package com.qwenmate.mcp.marketplace;

import com.intellij.openapi.diagnostic.Logger;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Coordinates all configured MCP marketplace providers and returns normalized entries.
 */
public final class McpMarketplaceService {

    private static final Logger LOG = Logger.getInstance(McpMarketplaceService.class);
    private static final int MAX_RESULT_COUNT = 250;

    private final List<McpMarketplaceSource> sources;
    private final BuiltInMcpMarketplaceClient builtInClient;
    private final RegistryMarketplaceClient registryClient;
    private final GitHubOrgMarketplaceClient gitHubOrgClient;

    public McpMarketplaceService() {
        McpMarketplaceHttpClient httpClient = new McpMarketplaceHttpClient();
        this.sources = McpMarketplaceSource.defaults();
        this.builtInClient = new BuiltInMcpMarketplaceClient();
        this.registryClient = new RegistryMarketplaceClient(httpClient);
        this.gitHubOrgClient = new GitHubOrgMarketplaceClient(httpClient);
    }

    public List<McpMarketplaceSource> getSources() {
        return sources;
    }

    public List<McpMarketplaceEntry> search(String query, String requestedSourceId, boolean forceRefresh) {
        List<McpMarketplaceEntry> allEntries = new ArrayList<>();
        for (McpMarketplaceSource source : sources) {
            if (!source.isEnabled() || !matchesRequestedSource(source, requestedSourceId)) {
                continue;
            }
            try {
                allEntries.addAll(loadEntries(source, forceRefresh));
            } catch (Exception e) {
                // A single bad source must not abort the whole search. Besides IOException, the
                // per-client parse can throw unchecked JsonSyntaxException / IllegalStateException
                // (getAsJsonObject / getAsJsonArray on a wrong-shaped or HTML error response);
                // catching those here keeps healthy sources and built-in presets available.
                LOG.warn("Failed to load MCP marketplace source " + source.getName() + ": " + e.getMessage());
            }
        }

        List<McpMarketplaceEntry> filteredEntries = filterEntries(deduplicate(allEntries), query);
        Collections.sort(filteredEntries, McpMarketplaceService::compareEntries);
        if (filteredEntries.size() <= MAX_RESULT_COUNT) {
            return filteredEntries;
        }
        return new ArrayList<>(filteredEntries.subList(0, MAX_RESULT_COUNT));
    }

    private static int compareEntries(McpMarketplaceEntry left, McpMarketplaceEntry right) {
        int officialComparison = Boolean.compare(right.isOfficial(), left.isOfficial());
        if (officialComparison != 0) {
            return officialComparison;
        }
        int installableComparison = Boolean.compare(right.isInstallable(), left.isInstallable());
        if (installableComparison != 0) {
            return installableComparison;
        }
        return safe(left.getDisplayName()).compareToIgnoreCase(safe(right.getDisplayName()));
    }

    private List<McpMarketplaceEntry> loadEntries(McpMarketplaceSource source, boolean forceRefresh) throws IOException {
        switch (source.getType()) {
            case BUILT_IN:
                return builtInClient.loadEntries(source);
            case REGISTRY:
                return registryClient.loadEntries(source, forceRefresh);
            case GITHUB_ORG:
                return gitHubOrgClient.loadEntries(source, forceRefresh);
            default:
                return Collections.emptyList();
        }
    }

    private static boolean matchesRequestedSource(McpMarketplaceSource source, String requestedSourceId) {
        return requestedSourceId == null || requestedSourceId.trim().isEmpty() || "all".equals(requestedSourceId) || source.getId().equals(requestedSourceId);
    }

    private static List<McpMarketplaceEntry> deduplicate(List<McpMarketplaceEntry> entries) {
        Map<String, McpMarketplaceEntry> deduplicated = new LinkedHashMap<>();
        for (McpMarketplaceEntry entry : entries) {
            String key = safe(entry.getSourceId()) + ":" + safe(entry.getName());
            if (!deduplicated.containsKey(key)) {
                deduplicated.put(key, entry);
            }
        }
        return new ArrayList<>(deduplicated.values());
    }

    private static List<McpMarketplaceEntry> filterEntries(List<McpMarketplaceEntry> entries, String query) {
        if (query == null || query.trim().isEmpty()) {
            return entries;
        }
        String[] terms = query.trim().toLowerCase(Locale.ROOT).split("\\s+");
        List<McpMarketplaceEntry> result = new ArrayList<>();
        for (McpMarketplaceEntry entry : entries) {
            if (matches(entry, terms)) {
                result.add(entry);
            }
        }
        return result;
    }

    private static boolean matches(McpMarketplaceEntry entry, String[] terms) {
        String searchable = buildSearchableText(entry);
        for (String term : terms) {
            if (!searchable.contains(term)) {
                return false;
            }
        }
        return true;
    }

    private static String buildSearchableText(McpMarketplaceEntry entry) {
        StringBuilder builder = new StringBuilder();
        builder.append(safe(entry.getName())).append(' ');
        builder.append(safe(entry.getDisplayName())).append(' ');
        builder.append(safe(entry.getDescription())).append(' ');
        builder.append(safe(entry.getRepositoryUrl())).append(' ');
        for (String tag : entry.getTags()) {
            builder.append(tag).append(' ');
        }
        return builder.toString().toLowerCase(Locale.ROOT);
    }

    private static String safe(String value) {
        return value != null ? value : "";
    }
}
