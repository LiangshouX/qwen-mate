package com.qwenmate.mcp.marketplace;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Describes one installable MCP server configuration candidate.
 */
public final class McpInstallOption {

    private final String label;
    private final String type;
    private final String command;
    private final List<String> args;
    private final String url;
    private final Map<String, String> env;
    private final Map<String, String> headers;
    private final String source;
    private final String riskLevel;

    public McpInstallOption(
        String label,
        String type,
        String command,
        List<String> args,
        String url,
        Map<String, String> env,
        Map<String, String> headers,
        String source,
        String riskLevel
    ) {
        this.label = label;
        this.type = type;
        this.command = command;
        this.args = args != null ? new ArrayList<>(args) : new ArrayList<>();
        this.url = url;
        this.env = env != null ? new LinkedHashMap<>(env) : new LinkedHashMap<>();
        this.headers = headers != null ? new LinkedHashMap<>(headers) : new LinkedHashMap<>();
        this.source = source;
        this.riskLevel = riskLevel;
    }

    public String getLabel() {
        return label;
    }

    public String getType() {
        return type;
    }

    public String getCommand() {
        return command;
    }

    public List<String> getArgs() {
        return new ArrayList<>(args);
    }

    public String getUrl() {
        return url;
    }

    public Map<String, String> getEnv() {
        return new LinkedHashMap<>(env);
    }

    public Map<String, String> getHeaders() {
        return new LinkedHashMap<>(headers);
    }

    public String getSource() {
        return source;
    }

    public String getRiskLevel() {
        return riskLevel;
    }
}
