package com.qwenmate.mcp.marketplace;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Normalized entry shown by the MCP marketplace browser.
 */
public final class McpMarketplaceEntry {

    private final String id;
    private final String name;
    private final String displayName;
    private final String description;
    private final String status;
    private final String sourceId;
    private final String sourceName;
    private final String sourceType;
    private final String homepage;
    private final String repositoryUrl;
    private final String docsUrl;
    private final boolean official;
    private final List<String> tags;
    private final List<McpInstallOption> installOptions;

    private McpMarketplaceEntry(Builder builder) {
        this.id = builder.id;
        this.name = builder.name;
        this.displayName = builder.displayName;
        this.description = builder.description;
        this.status = builder.status;
        this.sourceId = builder.sourceId;
        this.sourceName = builder.sourceName;
        this.sourceType = builder.sourceType;
        this.homepage = builder.homepage;
        this.repositoryUrl = builder.repositoryUrl;
        this.docsUrl = builder.docsUrl;
        this.official = builder.official;
        this.tags = new ArrayList<>(builder.tags);
        this.installOptions = new ArrayList<>(builder.installOptions);
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getDescription() {
        return description;
    }

    public String getStatus() {
        return status;
    }

    public String getSourceId() {
        return sourceId;
    }

    public String getSourceName() {
        return sourceName;
    }

    public String getSourceType() {
        return sourceType;
    }

    public String getHomepage() {
        return homepage;
    }

    public String getRepositoryUrl() {
        return repositoryUrl;
    }

    public String getDocsUrl() {
        return docsUrl;
    }

    public boolean isOfficial() {
        return official;
    }

    public List<String> getTags() {
        return Collections.unmodifiableList(tags);
    }

    public List<McpInstallOption> getInstallOptions() {
        return Collections.unmodifiableList(installOptions);
    }

    public boolean isInstallable() {
        return !installOptions.isEmpty();
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String id;
        private String name;
        private String displayName;
        private String description;
        private String status;
        private String sourceId;
        private String sourceName;
        private String sourceType;
        private String homepage;
        private String repositoryUrl;
        private String docsUrl;
        private boolean official;
        private final List<String> tags = new ArrayList<>();
        private final List<McpInstallOption> installOptions = new ArrayList<>();

        public Builder id(String value) {
            this.id = value;
            return this;
        }

        public Builder name(String value) {
            this.name = value;
            return this;
        }

        public Builder displayName(String value) {
            this.displayName = value;
            return this;
        }

        public Builder description(String value) {
            this.description = value;
            return this;
        }

        public Builder status(String value) {
            this.status = value;
            return this;
        }

        public Builder source(McpMarketplaceSource source) {
            this.sourceId = source.getId();
            this.sourceName = source.getName();
            this.sourceType = source.getType().name();
            return this;
        }

        public Builder homepage(String value) {
            this.homepage = value;
            return this;
        }

        public Builder repositoryUrl(String value) {
            this.repositoryUrl = value;
            return this;
        }

        public Builder docsUrl(String value) {
            this.docsUrl = value;
            return this;
        }

        public Builder official(boolean value) {
            this.official = value;
            return this;
        }

        public Builder addTag(String value) {
            if (value != null && !value.trim().isEmpty() && !tags.contains(value)) {
                tags.add(value);
            }
            return this;
        }

        public Builder addInstallOption(McpInstallOption value) {
            if (value != null) {
                installOptions.add(value);
            }
            return this;
        }

        public McpMarketplaceEntry build() {
            return new McpMarketplaceEntry(this);
        }
    }
}
