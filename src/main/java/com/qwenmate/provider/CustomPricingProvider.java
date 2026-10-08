package com.qwenmate.provider;

import com.qwenmate.settings.ConfigPathManager;
import com.qwenmate.settings.ModelPricing;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.jetbrains.annotations.TestOnly;

/**
 * Reads user-configured model pricing from {@code ~/.qwenmate/config.json}
 * and exposes it to the usage aggregators.
 *
 * <p>The usage-cost consumers are created in many
 * places without dependency injection, so this provider is a process-wide singleton that reads
 * the config file lazily and caches the parsed result keyed by the file's last-modified time.
 * When the file changes (e.g. the frontend writes a new price), the cache is invalidated
 * automatically on the next lookup.
 *
 * <p>This map is primarily for plugin-level custom models, plus pricing-only overrides for
 * the active Claude provider/settings.json mapped model names. Built-in Claude/Codex default
 * IDs still fall back to the aggregators' hardcoded tables unless the frontend explicitly
 * sends a matching pricing entry.
 */
public final class CustomPricingProvider {

    private static final Logger LOG = Logger.getInstance(CustomPricingProvider.class);
    private static final String ROOT_KEY = "customModelPricing";

    private static volatile CustomPricingProvider instance;

    private final ConfigPathManager pathManager;
    private final Gson gson;

    /** Cached parsed pricing, together with the mtime of the file it was parsed from. */
    private volatile CachedPricing cache;

    private CustomPricingProvider() {
        this(new ConfigPathManager());
    }

    CustomPricingProvider(ConfigPathManager pathManager) {
        this.pathManager = pathManager;
        this.gson = new Gson();
    }

    public static CustomPricingProvider getInstance() {
        CustomPricingProvider local = instance;
        if (local == null) {
            synchronized (CustomPricingProvider.class) {
                local = instance;
                if (local == null) {
                    local = new CustomPricingProvider();
                    instance = local;
                }
            }
        }
        return local;
    }

    /**
     * Replace the process-wide singleton so tests that exercise the usage aggregators do not
     * read the developer's real {@code ~/.qwenmate/config.json}. Pass {@code null} to restore
     * the default lazily-created instance.
     */
    @TestOnly
    public static void setInstanceForTests(CustomPricingProvider testInstance) {
        instance = testInstance;
    }

    /**
     * Build an isolated provider that reads pricing from the given config file path, for tests
     * outside this package that cannot reach the package-private constructor.
     */
    @TestOnly
    public static CustomPricingProvider createForTests(Path configFilePath) {
        return new CustomPricingProvider(new ConfigPathManager() {
            @Override
            public Path getConfigFilePath() {
                return configFilePath;
            }
        });
    }

    /**
     * Look up custom pricing for a model under a given provider family.
     *
     * @param provider provider id (e.g. "qwen")
     * @param modelId  the model ID
     * @return the configured pricing, or {@link Optional#empty()} if not configured
     */
    public Optional<ModelPricing> getPricing(String provider, String modelId) {
        if (provider == null || modelId == null || modelId.isBlank()) {
            return Optional.empty();
        }
        Map<String, ModelPricing> forProvider = getOrLoad().forProvider(provider);
        String trimmedModelId = modelId.trim();
        ModelPricing exactPricing = forProvider.get(trimmedModelId);
        if (exactPricing != null) {
            return Optional.of(exactPricing);
        }

        // The webview can append "[1m]" to Claude model IDs when long-context mode
        // is enabled. Custom models are configured by their base ID, so look up that
        // base ID as a fallback while preserving exact-match precedence above.
        String baseModelId = stripOneMillionContextSuffix(trimmedModelId);
        if (!baseModelId.equals(trimmedModelId)) {
            ModelPricing basePricing = forProvider.get(baseModelId);
            if (basePricing != null) {
                return Optional.of(basePricing);
            }
        }

        // Some model platforms use a route prefix in the configured/requested model ID
        // (for example "ppio/pa/gpt-5.5"), while Claude history may persist only the
        // routed model ID ("pa/gpt-5.5"). Treat the first slash-separated segment of
        // configured pricing keys as an optional route prefix, but only use this fallback
        // when it resolves to one unique configured model. This keeps exact matches
        // authoritative and avoids silently choosing between ambiguous providers such as
        // "ppio/pa/gpt-5.5" and "openrouter/pa/gpt-5.5".
        if ("qwen".equals(provider)) {
            Optional<ModelPricing> contextSuffixPricing =
                    findUniqueConfiguredContextSuffixPricing(forProvider, trimmedModelId);
            if (contextSuffixPricing.isPresent()) {
                return contextSuffixPricing;
            }

            Optional<ModelPricing> routePrefixPricing = findUniqueRoutePrefixPricing(forProvider, trimmedModelId);
            if (routePrefixPricing.isPresent()) {
                return routePrefixPricing;
            }
        }
        return Optional.empty();
    }

    /**
     * Force-clear the in-memory cache. Used by the pricing update handler after writing
     * config; automatic mtime-based invalidation remains the normal lookup fallback.
     */
    public void invalidateCache() {
        cache = null;
    }

    private CachedPricing getOrLoad() {
        CachedPricing local = cache;
        Path configPath = pathManager.getConfigFilePath();
        long currentMtime = readMtimeSafe(configPath);
        if (local != null && local.mtime == currentMtime) {
            return local;
        }
        synchronized (this) {
            local = cache;
            if (local != null && local.mtime == currentMtime) {
                return local;
            }
            local = loadFromDisk(configPath, currentMtime);
            cache = local;
            return local;
        }
    }

    private CachedPricing loadFromDisk(Path configPath, long mtime) {
        Map<String, Map<String, ModelPricing>> empty = Map.of();
        if (!Files.exists(configPath)) {
            return new CachedPricing(mtime, empty);
        }
        try {
            String content = Files.readString(configPath);
            JsonObject root = gson.fromJson(content, JsonObject.class);
            if (root == null || !root.has(ROOT_KEY) || !root.get(ROOT_KEY).isJsonObject()) {
                return new CachedPricing(mtime, empty);
            }
            JsonObject rootObj = root.getAsJsonObject(ROOT_KEY);
            Map<String, Map<String, ModelPricing>> result = new HashMap<>();
            // Pricing is stored per provider key (e.g. "qwen"); load every
            // configured provider node instead of a hard-coded provider list.
            for (String provider : rootObj.keySet()) {
                if (!rootObj.get(provider).isJsonObject()) {
                    continue;
                }
                JsonObject providerObj = rootObj.getAsJsonObject(provider);
                Map<String, ModelPricing> modelMap = new HashMap<>();
                for (String modelId : providerObj.keySet()) {
                    if (!providerObj.get(modelId).isJsonObject()) {
                        continue;
                    }
                    JsonObject p = providerObj.getAsJsonObject(modelId);
                    ModelPricing pricing = new ModelPricing(
                            readDouble(p, "inputCostPer1M"),
                            readDouble(p, "outputCostPer1M"),
                            readDouble(p, "cacheWriteCostPer1M"),
                            readDouble(p, "cacheReadCostPer1M")
                    );
                    modelMap.put(modelId, pricing);
                }
                result.put(provider, Map.copyOf(modelMap));
            }
            return new CachedPricing(mtime, Map.copyOf(result));
        } catch (IOException e) {
            LOG.warn("[CustomPricingProvider] Failed to read config: " + e.getMessage());
            return new CachedPricing(mtime, empty);
        } catch (Exception e) {
            LOG.warn("[CustomPricingProvider] Failed to parse config: " + e.getMessage());
            return new CachedPricing(mtime, empty);
        }
    }

    private static Double readDouble(JsonObject obj, String key) {
        if (obj == null || !obj.has(key) || obj.get(key).isJsonNull()) {
            return null;
        }
        try {
            double value = obj.get(key).getAsDouble();
            return Double.isFinite(value) && value >= 0 ? value : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static Optional<ModelPricing> findUniqueConfiguredContextSuffixPricing(
            Map<String, ModelPricing> pricingByModel,
            String requestedModelId
    ) {
        Set<String> requestedComparableIds = requestedComparableIds(requestedModelId);
        ModelPricing matchedPricing = null;
        String matchedModelId = null;

        for (Map.Entry<String, ModelPricing> entry : pricingByModel.entrySet()) {
            String configuredModelId = entry.getKey() == null ? "" : entry.getKey().trim();
            String configuredBaseModelId = stripOneMillionContextSuffix(configuredModelId);
            if (configuredBaseModelId.equals(configuredModelId)
                    || !requestedComparableIds.contains(configuredBaseModelId)) {
                continue;
            }
            if (matchedPricing != null && !entry.getKey().equals(matchedModelId)) {
                return Optional.empty();
            }
            matchedPricing = entry.getValue();
            matchedModelId = entry.getKey();
        }

        return Optional.ofNullable(matchedPricing);
    }

    private static Optional<ModelPricing> findUniqueRoutePrefixPricing(
            Map<String, ModelPricing> pricingByModel,
            String requestedModelId
    ) {
        Set<String> requestedComparableIds = requestedComparableIds(requestedModelId);
        ModelPricing matchedPricing = null;
        String matchedModelId = null;

        for (Map.Entry<String, ModelPricing> entry : pricingByModel.entrySet()) {
            if (!intersects(requestedComparableIds, configuredRouteComparableIds(entry.getKey()))) {
                continue;
            }
            if (matchedPricing != null && !entry.getKey().equals(matchedModelId)) {
                return Optional.empty();
            }
            matchedPricing = entry.getValue();
            matchedModelId = entry.getKey();
        }

        return Optional.ofNullable(matchedPricing);
    }

    private static Set<String> requestedComparableIds(String modelId) {
        Set<String> ids = new LinkedHashSet<>();
        addIfNotBlank(ids, modelId);
        addIfNotBlank(ids, stripOneMillionContextSuffix(modelId));
        return ids;
    }

    private static Set<String> configuredRouteComparableIds(String modelId) {
        Set<String> ids = new LinkedHashSet<>();
        String trimmed = modelId == null ? "" : modelId.trim();
        String withoutContextSuffix = stripOneMillionContextSuffix(trimmed);
        addRouteStrippedIds(ids, trimmed);
        addRouteStrippedIds(ids, withoutContextSuffix);
        return ids;
    }

    private static void addRouteStrippedIds(Set<String> ids, String modelId) {
        if (modelId == null || modelId.isBlank()) {
            return;
        }
        int slashIndex = modelId.indexOf('/');
        if (slashIndex <= 0 || slashIndex == modelId.length() - 1) {
            return;
        }
        addIfNotBlank(ids, modelId.substring(slashIndex + 1));
    }

    private static boolean intersects(Set<String> left, Set<String> right) {
        for (String value : left) {
            if (right.contains(value)) {
                return true;
            }
        }
        return false;
    }

    private static void addIfNotBlank(Set<String> ids, String modelId) {
        if (modelId == null) {
            return;
        }
        String trimmed = modelId.trim();
        if (!trimmed.isEmpty()) {
            ids.add(trimmed);
        }
    }

    private static String stripOneMillionContextSuffix(String modelId) {
        return modelId.replaceFirst("(?i)\\[1m]$", "");
    }

    private static long readMtimeSafe(Path path) {
        try {
            FileTime t = Files.getLastModifiedTime(path);
            return t == null ? 0L : t.toMillis();
        } catch (IOException e) {
            return 0L;
        }
    }

    /** Immutable cache entry: parsed pricing keyed by provider, plus the source file mtime. */
    private static final class CachedPricing {
        final long mtime;
        final Map<String, Map<String, ModelPricing>> byProvider;

        CachedPricing(long mtime, Map<String, Map<String, ModelPricing>> byProvider) {
            this.mtime = mtime;
            this.byProvider = byProvider;
        }

        Map<String, ModelPricing> forProvider(String provider) {
            return byProvider.getOrDefault(provider, Map.of());
        }
    }
}
