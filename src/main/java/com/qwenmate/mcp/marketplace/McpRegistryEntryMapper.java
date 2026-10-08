package com.qwenmate.mcp.marketplace;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Maps MCP registry JSON envelopes into CoDriver marketplace entries.
 */
final class McpRegistryEntryMapper {

    /** Package runners the marketplace is willing to invoke without flagging them as unverified. */
    private static final Set<String> KNOWN_RUNNERS = new HashSet<>(Arrays.asList(
        "npx", "uvx", "uv", "pnpm", "pnpx", "bunx", "node", "deno", "python", "python3", "docker", "podman"));

    /**
     * Container/runner flags that grant host access or escalate privilege. A registry entry that
     * supplies its own runtimeArguments overrides the canonical {@code run -i --rm} prefix, so any
     * of these flags downgrades trust to {@code unverified-command} — the UI then shows the
     * prominent warning before the user installs. See {@link #hasDangerousRunnerArg}.
     */
    private static final Set<String> DANGEROUS_RUNNER_FLAGS = new HashSet<>(Arrays.asList(
        "--privileged", "--cap-add", "--device", "--pid", "--ipc", "--userns", "--network", "--net",
        "-v", "--volume", "--mount"));

    private McpRegistryEntryMapper() {
    }

    private static boolean isKnownRunner(String runner) {
        return runner != null && KNOWN_RUNNERS.contains(runner.trim().toLowerCase(Locale.ROOT));
    }

    static McpMarketplaceEntry fromRegistryObject(JsonObject envelope, McpMarketplaceSource source) {
        // Registry v0.1 wraps each entry as { "server": { ... }, "_meta": { ... } }.
        // Older/flat payloads keep the fields at the top level, so fall back to the envelope itself.
        JsonObject data = McpMarketplaceJson.getObject(envelope, "server");
        if (data == null) {
            data = envelope;
        }
        JsonObject versionDetail = McpMarketplaceJson.getObject(data, "version_detail");
        String name = firstValue(
            McpMarketplaceJson.getString(data, "name", "id", "server_name"),
            McpMarketplaceJson.getString(versionDetail, "name", "id", "server_name")
        );
        String displayName = firstValue(
            McpMarketplaceJson.getString(data, "title", "display_name", "displayName"),
            McpMarketplaceJson.getString(versionDetail, "title", "display_name", "displayName"),
            shortName(name)
        );
        String description = firstValue(
            McpMarketplaceJson.getString(data, "description"),
            McpMarketplaceJson.getString(versionDetail, "description")
        );
        String version = firstValue(
            McpMarketplaceJson.getString(data, "version"),
            McpMarketplaceJson.getString(versionDetail, "version")
        );
        String status = firstValue(McpMarketplaceJson.getString(data, "status"), "active");
        String repositoryUrl = getRepositoryUrl(data);
        // The "official" marker is only trusted from the canonical modelcontextprotocol registry
        // source: the _meta flag is entry-embedded and forgeable, so an entry served by any other
        // source (or a user-added source) cannot earn the badge just by including the metadata.
        boolean official = isTrustedOfficialSource(source) && isOfficial(envelope);

        McpMarketplaceEntry.Builder builder = McpMarketplaceEntry.builder()
            .id(source.getId() + ":" + name)
            .name(name)
            .displayName(displayName)
            .description(description)
            .status(status)
            .source(source)
            .homepage(repositoryUrl)
            .repositoryUrl(repositoryUrl)
            .docsUrl(repositoryUrl)
            .official(official)
            .addTag(source.getName());

        if (version != null) {
            builder.addTag(version);
        }
        if (official) {
            builder.addTag("official");
        }

        addInstallOptions(builder, data, versionDetail, name, source);
        return builder.build();
    }

    static McpMarketplaceEntry fromGitHubRepo(JsonObject repo, McpMarketplaceSource source) {
        boolean fork = McpMarketplaceJson.getBoolean(repo, "fork", false);
        if (fork) {
            return null;
        }

        String repoName = McpMarketplaceJson.getString(repo, "name");
        String description = McpMarketplaceJson.getString(repo, "description");
        String repoUrl = McpMarketplaceJson.getString(repo, "html_url");
        String language = McpMarketplaceJson.getString(repo, "language");
        int stars = McpMarketplaceJson.getInt(repo, "stargazers_count", 0);
        boolean archived = McpMarketplaceJson.getBoolean(repo, "archived", false);

        StringBuilder desc = new StringBuilder();
        if (description != null && !description.trim().isEmpty()) {
            desc.append(description);
        }
        if (language != null && !language.trim().isEmpty()) {
            appendMetadata(desc, language);
        }
        if (stars > 0) {
            appendMetadata(desc, "★ " + stars);
        }

        return McpMarketplaceEntry.builder()
            .id(source.getId() + ":" + repoName)
            .name("io.github.modelcontextprotocol/" + repoName)
            .displayName(repoName)
            .description(desc.toString())
            .status(archived ? "archived" : "active")
            .source(source)
            .homepage(repoUrl)
            .repositoryUrl(repoUrl)
            .docsUrl(repoUrl)
            .official(true)
            .addTag("github")
            .addTag(language)
            .build();
    }

    private static void addInstallOptions(
        McpMarketplaceEntry.Builder builder,
        JsonObject envelope,
        JsonObject versionDetail,
        String serverName,
        McpMarketplaceSource source
    ) {
        List<VariableDefinition> variables = new ArrayList<>();
        variables.addAll(parseVariables(envelope));
        variables.addAll(parseVariables(versionDetail));

        List<HeaderDefinition> headers = new ArrayList<>();
        headers.addAll(parseHeaders(envelope));
        headers.addAll(parseHeaders(versionDetail));

        addRemoteInstallOptions(builder, envelope, variables, headers, source);
        addRemoteInstallOptions(builder, versionDetail, variables, headers, source);
        addPackageInstallOptions(builder, envelope, serverName, variables, source);
        addPackageInstallOptions(builder, versionDetail, serverName, variables, source);
    }

    private static void addRemoteInstallOptions(
        McpMarketplaceEntry.Builder builder,
        JsonObject object,
        List<VariableDefinition> variables,
        List<HeaderDefinition> headers,
        McpMarketplaceSource source
    ) {
        JsonArray remotes = McpMarketplaceJson.getArray(object, "remotes");
        if (remotes == null) {
            return;
        }
        for (JsonElement element : remotes) {
            if (!element.isJsonObject()) {
                continue;
            }
            JsonObject remote = element.getAsJsonObject();
            String url = McpMarketplaceJson.getString(remote, "url");
            if (url == null || url.trim().isEmpty()) {
                continue;
            }
            String transportType = firstValue(
                McpMarketplaceJson.getString(remote, "transport_type", "transportType", "type"),
                "http"
            );
            List<VariableDefinition> remoteVariables = new ArrayList<>(variables);
            remoteVariables.addAll(parseVariables(remote));
            List<HeaderDefinition> remoteHeaders = new ArrayList<>(headers);
            remoteHeaders.addAll(parseHeaders(remote));
            builder.addInstallOption(new McpInstallOption(
                transportType.toUpperCase(Locale.ROOT) + " remote",
                normalizeRemoteType(transportType),
                null,
                null,
                url,
                toEnvPlaceholders(remoteVariables),
                toHeaderPlaceholders(remoteHeaders),
                source.getName(),
                "remote"
            ));
        }
    }

    private static void addPackageInstallOptions(
        McpMarketplaceEntry.Builder builder,
        JsonObject object,
        String serverName,
        List<VariableDefinition> variables,
        McpMarketplaceSource source
    ) {
        JsonArray packages = McpMarketplaceJson.getArray(object, "packages");
        if (packages == null) {
            return;
        }
        for (JsonElement element : packages) {
            if (!element.isJsonObject()) {
                continue;
            }
            JsonObject packageObject = element.getAsJsonObject();
            PackageDefinition packageDefinition = PackageDefinition.from(packageObject, serverName);
            McpInstallOption installOption = createPackageInstallOption(packageDefinition, variables, source);
            if (installOption != null) {
                builder.addInstallOption(installOption);
            }
        }
    }

    private static McpInstallOption createPackageInstallOption(
        PackageDefinition packageDefinition,
        List<VariableDefinition> variables,
        McpMarketplaceSource source
    ) {
        if (packageDefinition.name == null || packageDefinition.name.trim().isEmpty()) {
            return null;
        }
        String registryType = normalizeRegistryType(packageDefinition.registryType);

        // Environment: server-level variables plus the package's own environmentVariables.
        Map<String, String> env = new LinkedHashMap<>();
        env.putAll(toEnvPlaceholders(variables));
        env.putAll(renderEnvironmentVariables(packageDefinition.environmentVariables()));

        // runtimeArguments precede the package (e.g. uvx --from), packageArguments follow it
        // (e.g. the required SigV4 endpoint URL, --service, --profile, --region for AWS proxies).
        List<String> runtimeArgs = renderArguments(packageDefinition.runtimeArguments());
        List<String> packageArgs = renderArguments(packageDefinition.packageArguments());
        String transportType = normalizePackageTransport(packageDefinition.transportType());

        List<String> args = new ArrayList<>();
        String command;
        String label;
        String riskLevel;
        String hint = packageDefinition.runtimeHint();

        if ("docker".equals(registryType)) {
            // For a known type, a non-allowlisted runtimeHint is ignored in favour of the
            // canonical runner so a registry entry cannot turn the command into anything it likes.
            command = isKnownRunner(hint) ? hint : "docker";
            args.addAll(runtimeArgs.isEmpty() ? Arrays.asList("run", "-i", "--rm") : runtimeArgs);
            args.add(packageDefinition.name);
            args.addAll(packageArgs);
            label = "Docker image";
            riskLevel = "container-command";
        } else if ("npm".equals(registryType)) {
            command = isKnownRunner(hint) ? hint : "npx";
            args.addAll(runtimeArgs.isEmpty() ? Arrays.asList("-y") : runtimeArgs);
            args.add(packageDefinition.installName());
            args.addAll(packageArgs);
            label = "NPX package";
            riskLevel = "local-command";
        } else if ("pypi".equals(registryType)) {
            command = isKnownRunner(hint) ? hint : "uvx";
            args.addAll(runtimeArgs);
            args.add(packageDefinition.installName());
            args.addAll(packageArgs);
            label = "UVX package";
            riskLevel = "local-command";
        } else if (hint != null && !hint.trim().isEmpty()) {
            // Unknown registry type: there is no canonical runner to fall back to, so the
            // registry-provided command is honoured but flagged when it is not a known runner.
            command = hint;
            args.addAll(runtimeArgs);
            args.add(packageDefinition.installName());
            args.addAll(packageArgs);
            label = command + " package";
            riskLevel = isKnownRunner(hint) ? "local-command" : "unverified-command";
        } else {
            return null;
        }

        // A registry entry can supply its own runtimeArguments, which replace the canonical
        // safe prefix (docker "run -i --rm", npm "-y"). If those args include host-access or
        // privilege-escalation flags, downgrade trust so the user is warned before installing.
        if (hasDangerousRunnerArg(runtimeArgs)) {
            riskLevel = "unverified-command";
        }

        return new McpInstallOption(
            label,
            transportType,
            command,
            args,
            null,
            env,
            null,
            source.getName(),
            riskLevel
        );
    }

    /** True if any registry-supplied runtime argument is a host-access / privilege-escalation flag. */
    private static boolean hasDangerousRunnerArg(List<String> runtimeArgs) {
        if (runtimeArgs == null) {
            return false;
        }
        for (String arg : runtimeArgs) {
            if (arg == null) {
                continue;
            }
            String normalized = arg.trim().toLowerCase(Locale.ROOT);
            int equals = normalized.indexOf('=');
            String flag = equals >= 0 ? normalized.substring(0, equals) : normalized;
            if (DANGEROUS_RUNNER_FLAGS.contains(flag)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Renders registry argument descriptors into a flat command-line list.
     * Named arguments become {@code [name, value]} (or just {@code name} for flags),
     * positional arguments become {@code [value]}. Missing values fall back to the
     * {@code valueHint} as a {@code {placeholder}}; explicit {@code {placeholder}} values
     * are preserved verbatim so the user can fill them in after import.
     */
    private static List<String> renderArguments(JsonArray arguments) {
        List<String> result = new ArrayList<>();
        if (arguments == null) {
            return result;
        }
        for (JsonElement element : arguments) {
            if (!element.isJsonObject()) {
                continue;
            }
            JsonObject arg = element.getAsJsonObject();
            String argType = firstValue(McpMarketplaceJson.getString(arg, "type"), "positional");
            String value = firstValue(
                McpMarketplaceJson.getString(arg, "value"),
                McpMarketplaceJson.getString(arg, "default", "defaultValue")
            );
            if (value == null) {
                String hint = McpMarketplaceJson.getString(arg, "valueHint", "value_hint");
                if (hint != null) {
                    value = "{" + hint + "}";
                }
            }
            if ("named".equalsIgnoreCase(argType)) {
                String name = McpMarketplaceJson.getString(arg, "name");
                if (name == null || name.trim().isEmpty()) {
                    continue;
                }
                result.add(name);
                if (value != null) {
                    result.add(value);
                }
            } else if (value != null) {
                result.add(value);
            }
        }
        return result;
    }

    /** Renders the package's {@code environmentVariables} into an env map, preserving placeholders. */
    private static Map<String, String> renderEnvironmentVariables(JsonArray environmentVariables) {
        Map<String, String> values = new LinkedHashMap<>();
        if (environmentVariables == null) {
            return values;
        }
        for (JsonElement element : environmentVariables) {
            if (!element.isJsonObject()) {
                continue;
            }
            JsonObject env = element.getAsJsonObject();
            String name = McpMarketplaceJson.getString(env, "name");
            if (name == null || name.trim().isEmpty()) {
                continue;
            }
            String value = firstValue(
                McpMarketplaceJson.getString(env, "value"),
                McpMarketplaceJson.getString(env, "default", "defaultValue")
            );
            if (value == null) {
                value = "{" + name.toLowerCase(Locale.ROOT) + "}";
            }
            values.put(name, value);
        }
        return values;
    }

    private static String normalizePackageTransport(String type) {
        if (type == null) {
            return "stdio";
        }
        String lower = type.toLowerCase(Locale.ROOT);
        if (lower.contains("sse")) {
            return "sse";
        }
        if (lower.contains("http")) {
            return "http";
        }
        return "stdio";
    }

    private static JsonArray getArrayAny(JsonObject object, String... keys) {
        for (String key : keys) {
            JsonArray array = McpMarketplaceJson.getArray(object, key);
            if (array != null) {
                return array;
            }
        }
        return null;
    }

    private static List<VariableDefinition> parseVariables(JsonObject object) {
        List<VariableDefinition> result = new ArrayList<>();
        JsonArray variables = McpMarketplaceJson.getArray(object, "variables");
        if (variables == null) {
            return result;
        }
        for (JsonElement element : variables) {
            if (element.isJsonObject()) {
                VariableDefinition definition = VariableDefinition.from(element.getAsJsonObject());
                if (definition.name != null) {
                    result.add(definition);
                }
            }
        }
        return result;
    }

    private static List<HeaderDefinition> parseHeaders(JsonObject object) {
        List<HeaderDefinition> result = new ArrayList<>();
        JsonArray headers = McpMarketplaceJson.getArray(object, "headers");
        if (headers == null) {
            return result;
        }
        for (JsonElement element : headers) {
            if (element.isJsonObject()) {
                HeaderDefinition definition = HeaderDefinition.from(element.getAsJsonObject());
                if (definition.name != null) {
                    result.add(definition);
                }
            }
        }
        return result;
    }

    private static Map<String, String> toEnvPlaceholders(List<VariableDefinition> variables) {
        Map<String, String> values = new LinkedHashMap<>();
        for (VariableDefinition variable : variables) {
            if (variable.name == null || variable.name.trim().isEmpty()) {
                continue;
            }
            String value = variable.defaultValue != null ? variable.defaultValue : "{" + variable.name.toLowerCase(Locale.ROOT) + "}";
            values.put(variable.name, value);
        }
        return values;
    }

    private static Map<String, String> toHeaderPlaceholders(List<HeaderDefinition> headers) {
        Map<String, String> values = new LinkedHashMap<>();
        for (HeaderDefinition header : headers) {
            if (header.name == null || header.name.trim().isEmpty()) {
                continue;
            }
            values.put(header.name, "{" + header.name.toLowerCase(Locale.ROOT).replace('-', '_') + "}");
        }
        return values;
    }

    /** The canonical modelcontextprotocol registry is the only source whose "official" _meta is trusted. */
    private static boolean isTrustedOfficialSource(McpMarketplaceSource source) {
        if (source == null || source.getUrl() == null) {
            return false;
        }
        try {
            String host = new URI(source.getUrl()).getHost();
            return host != null && host.equalsIgnoreCase("registry.modelcontextprotocol.io");
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean isOfficial(JsonObject envelope) {
        JsonObject meta = McpMarketplaceJson.getObject(envelope, "_meta");
        JsonObject official = McpMarketplaceJson.getObject(meta, "io.modelcontextprotocol.registry/official");
        if (official == null) {
            return false;
        }
        // Require the registry's own structured metadata rather than mere key presence,
        // which a malicious entry could forge to earn the "official" badge.
        return official.has("id") || official.has("publishedAt") || official.has("isLatest");
    }

    private static String getRepositoryUrl(JsonObject envelope) {
        JsonObject repository = McpMarketplaceJson.getObject(envelope, "repository");
        String repositoryUrl = McpMarketplaceJson.getString(repository, "url");
        if (repositoryUrl != null) {
            return repositoryUrl;
        }
        JsonObject versionDetail = McpMarketplaceJson.getObject(envelope, "version_detail");
        JsonObject nestedRepository = McpMarketplaceJson.getObject(versionDetail, "repository");
        return McpMarketplaceJson.getString(nestedRepository, "url");
    }

    private static String normalizeRegistryType(String registryType) {
        if (registryType == null) {
            return "";
        }
        String normalized = registryType.trim().toLowerCase(Locale.ROOT);
        if (normalized.contains("npm")) {
            return "npm";
        }
        if (normalized.contains("pypi") || normalized.contains("python") || normalized.contains("uv")) {
            return "pypi";
        }
        if (normalized.contains("docker") || normalized.contains("oci")) {
            return "docker";
        }
        return normalized;
    }

    private static String normalizeRemoteType(String transportType) {
        if (transportType == null) {
            return "http";
        }
        String lower = transportType.toLowerCase(Locale.ROOT);
        if (lower.contains("sse")) {
            return "sse";
        }
        return "http";
    }

    private static String shortName(String name) {
        if (name == null) {
            return "";
        }
        int slash = name.lastIndexOf('/');
        return slash >= 0 ? name.substring(slash + 1) : name;
    }

    private static String firstValue(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value;
            }
        }
        return null;
    }

    private static void appendMetadata(StringBuilder description, String value) {
        if (description.length() > 0) {
            description.append(" | ");
        }
        description.append(value);
    }

    private static final class PackageDefinition {
        private final String registryType;
        private final String name;
        private final String version;
        private final JsonObject raw;

        private PackageDefinition(String registryType, String name, String version, JsonObject raw) {
            this.registryType = registryType;
            this.name = name;
            this.version = version;
            this.raw = raw;
        }

        static PackageDefinition from(JsonObject object, String fallbackName) {
            String packageName = firstValue(McpMarketplaceJson.getString(object, "name", "identifier"), fallbackName);
            return new PackageDefinition(
                McpMarketplaceJson.getString(object, "registry_type", "registryType", "type"),
                packageName,
                McpMarketplaceJson.getString(object, "version"),
                object
            );
        }

        String installName() {
            // A leading '@' is an npm scope (e.g. @scope/pkg), not a version separator;
            // only treat '@' after the first character as an already-pinned version.
            if (version == null || version.trim().isEmpty() || name.lastIndexOf('@') > 0) {
                return name;
            }
            return name + "@" + version;
        }

        String runtimeHint() {
            return McpMarketplaceJson.getString(raw, "runtimeHint", "runtime_hint");
        }

        JsonArray runtimeArguments() {
            return getArrayAny(raw, "runtimeArguments", "runtime_arguments");
        }

        JsonArray packageArguments() {
            return getArrayAny(raw, "packageArguments", "package_arguments");
        }

        JsonArray environmentVariables() {
            return getArrayAny(raw, "environmentVariables", "environment_variables");
        }

        String transportType() {
            JsonObject transport = McpMarketplaceJson.getObject(raw, "transport");
            return McpMarketplaceJson.getString(transport, "type");
        }
    }

    private static final class VariableDefinition {
        private final String name;
        private final String defaultValue;

        private VariableDefinition(String name, String defaultValue) {
            this.name = name;
            this.defaultValue = defaultValue;
        }

        static VariableDefinition from(JsonObject object) {
            return new VariableDefinition(
                McpMarketplaceJson.getString(object, "name"),
                McpMarketplaceJson.getString(object, "default", "defaultValue")
            );
        }
    }

    private static final class HeaderDefinition {
        private final String name;

        private HeaderDefinition(String name) {
            this.name = name;
        }

        static HeaderDefinition from(JsonObject object) {
            return new HeaderDefinition(McpMarketplaceJson.getString(object, "name"));
        }
    }
}
