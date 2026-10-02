package com.qwenmate.dependency;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * SDK definition enum.
 * Defines the installable AI SDK package information.
 */
public enum SdkDefinition {

    QWEN_SDK(
        "qwen-sdk",
        "Qwen Code SDK",
        "@qwen-code/sdk",
        "latest",
        Collections.emptyList(),
        Collections.emptyList(),
        "Qwen Code AI 提供商所需，支持多模型对话和工具调用。",
        null // minRequiredVersion — no minimum enforced yet
    );

    private final String id;
    private final String displayName;
    private final String npmPackage;
    private final String version;
    private final List<String> dependencies;
    private final List<String> fallbackVersions;
    private final String description;
    private final String minRequiredVersion;

    SdkDefinition(String id, String displayName, String npmPackage, String version,
                  List<String> dependencies, List<String> fallbackVersions, String description,
                  String minRequiredVersion) {
        this.id = id;
        this.displayName = displayName;
        this.npmPackage = npmPackage;
        this.version = version;
        this.dependencies = dependencies;
        this.fallbackVersions = fallbackVersions;
        this.description = description;
        this.minRequiredVersion = minRequiredVersion;
    }

    public String getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getNpmPackage() {
        return npmPackage;
    }

    public String getVersion() {
        return version;
    }

    public List<String> getDependencies() {
        return dependencies;
    }

    public List<String> getFallbackVersions() {
        return fallbackVersions;
    }

    public String getDescription() {
        return description;
    }

    /**
     * Minimum installed version required for full feature support.
     * Null means no minimum is enforced.
     */
    public String getMinRequiredVersion() {
        return minRequiredVersion;
    }

    /**
     * Returns the full npm package specifier including the version.
     * For example: @qwen-code/sdk@^0.1.16
     */
    public String getFullPackageSpec() {
        return npmPackage + "@" + version;
    }

    /**
     * Returns all packages to install (main package + dependencies).
     */
    public List<String> getAllPackages() {
        if (dependencies.isEmpty()) {
            return Collections.singletonList(getFullPackageSpec());
        }
        ArrayList<String> all = new ArrayList<>();
        all.add(getFullPackageSpec());
        all.addAll(dependencies);
        return all;
    }

    /**
     * Finds an SDK definition by its ID.
     */
    public static SdkDefinition fromId(String id) {
        for (SdkDefinition sdk : values()) {
            if (sdk.getId().equals(id)) {
                return sdk;
            }
        }
        return null;
    }

    /**
     * Finds the corresponding SDK by provider name.
     */
    public static SdkDefinition fromProvider(String provider) {
        if ("qwen".equalsIgnoreCase(provider)) {
            return QWEN_SDK;
        }
        return null;
    }
}
