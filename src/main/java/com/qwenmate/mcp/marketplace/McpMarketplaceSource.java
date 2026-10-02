package com.qwenmate.mcp.marketplace;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Describes a source that can provide MCP marketplace entries.
 */
public final class McpMarketplaceSource {

    public enum SourceType {
        BUILT_IN,
        REGISTRY,
        GITHUB_ORG
    }

    private final String id;
    private final String name;
    private final SourceType type;
    private final String url;
    private final boolean enabled;

    public McpMarketplaceSource(String id, String name, SourceType type, String url, boolean enabled) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.url = url;
        this.enabled = enabled;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public SourceType getType() {
        return type;
    }

    public String getUrl() {
        return url;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public static List<McpMarketplaceSource> defaults() {
        List<McpMarketplaceSource> sources = new ArrayList<>();
        sources.add(new McpMarketplaceSource(
            "built-in",
            "Built-in Presets",
            SourceType.BUILT_IN,
            "codriver://built-in-mcp-presets",
            true
        ));
        sources.add(new McpMarketplaceSource(
            "official-registry",
            "Official MCP Registry",
            SourceType.REGISTRY,
            "https://registry.modelcontextprotocol.io",
            true
        ));
        sources.add(new McpMarketplaceSource(
            "github-mcp-registry",
            "GitHub MCP Registry",
            SourceType.REGISTRY,
            "https://api.mcp.github.com",
            true
        ));
        sources.add(new McpMarketplaceSource(
            "official-github-org",
            "MCP Official GitHub Org",
            SourceType.GITHUB_ORG,
            "https://github.com/modelcontextprotocol",
            true
        ));
        return Collections.unmodifiableList(sources);
    }
}
