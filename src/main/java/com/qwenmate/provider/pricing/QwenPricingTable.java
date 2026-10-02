package com.qwenmate.provider.pricing;

import com.qwenmate.provider.CustomPricingProvider;
import com.qwenmate.settings.ModelPricing;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Single source of truth for Qwen built-in pricing, model normalization, and
 * user-configured pricing resolution. {@code UsageCostCalculator} resolves pricing
 * through here so the per-turn footer cost can never disagree with custom overrides.
 *
 * <p>Prices are approximate values (USD per 1M tokens) based on public Alibaba Cloud
 * Bailian / DashScope pricing; user-configured pricing can override them per model
 * ({@link CustomPricingProvider}).
 */
public final class QwenPricingTable {

    private static final String QWEN_PROVIDER = "qwen";

    /** Context-window suffix appended by long-context mode, e.g. "qwen-max[500k]". */
    private static final Pattern CONTEXT_SUFFIX = Pattern.compile("\\s*\\[[0-9.]+[kKmM]]\\s*$");

    private static final QwenPricing QWEN3_CODER_PLUS_PRICING = new QwenPricing(1.0, 5.0, 1.0, 0.20);
    private static final QwenPricing QWEN3_CODER_FLASH_PRICING = new QwenPricing(0.30, 1.50, 0.30, 0.06);
    private static final QwenPricing QWEN3_MAX_PRICING = new QwenPricing(1.20, 6.00, 1.20, 0.24);
    private static final QwenPricing QWEN3_PLUS_PRICING = new QwenPricing(0.40, 1.20, 0.40, 0.08);
    private static final QwenPricing QWEN3_TURBO_PRICING = new QwenPricing(0.06, 0.24, 0.06, 0.012);
    private static final QwenPricing QWEN_MAX_PRICING = new QwenPricing(1.60, 6.40, 1.60, 0.32);
    private static final QwenPricing QWEN_PLUS_PRICING = new QwenPricing(0.40, 1.20, 0.40, 0.08);
    private static final QwenPricing QWEN_TURBO_PRICING = new QwenPricing(0.05, 0.20, 0.05, 0.01);
    private static final QwenPricing QWEN2_5_CODER_PRICING = new QwenPricing(0.10, 0.30, 0.10, 0.02);

    private static final Map<String, QwenPricing> MODEL_PRICING = Map.ofEntries(
            Map.entry("qwen3-coder-plus", QWEN3_CODER_PLUS_PRICING),
            Map.entry("qwen3-coder-flash", QWEN3_CODER_FLASH_PRICING),
            Map.entry("qwen3-max", QWEN3_MAX_PRICING),
            Map.entry("qwen3-plus", QWEN3_PLUS_PRICING),
            Map.entry("qwen3-turbo", QWEN3_TURBO_PRICING),
            Map.entry("qwen-max", QWEN_MAX_PRICING),
            Map.entry("qwen-plus", QWEN_PLUS_PRICING),
            Map.entry("qwen-turbo", QWEN_TURBO_PRICING),
            Map.entry("qwen2.5-coder", QWEN2_5_CODER_PRICING)
    );

    /** Longest first so dated/versioned variants (e.g. "qwen-max-2025-01-25") hit the right row. */
    private static final List<String> MODEL_PREFIXES = List.of(
            "qwen3-coder-plus",
            "qwen3-coder-flash",
            "qwen2.5-coder",
            "qwen3-turbo",
            "qwen3-plus",
            "qwen3-max",
            "qwen-turbo",
            "qwen-plus",
            "qwen-max"
    );

    private QwenPricingTable() {
    }

    /**
     * User-configured or built-in pricing for {@code model}, or {@code null} when the model
     * matches neither (callers treat that as zero cost). User-configured pricing takes
     * precedence over the built-in table.
     */
    public static QwenPricing resolve(String model) {
        QwenPricing builtin = builtinFor(model);
        QwenPricing custom = customFor(model, builtin);
        return custom != null ? custom : builtin;
    }

    private static QwenPricing builtinFor(String model) {
        String normalized = normalize(model);
        return normalized == null ? null : MODEL_PRICING.get(normalized);
    }

    /**
     * User-configured pricing, or {@code null} if none. Unspecified dimensions fall back to the
     * overridden model's OWN built-in rate when it is a known model, otherwise 0 — never a
     * guessed default rate, which would turn a partial custom price into an over-estimate.
     */
    private static QwenPricing customFor(String model, QwenPricing builtin) {
        if (model == null || model.isBlank()) {
            return null;
        }
        Optional<ModelPricing> configured = CustomPricingProvider.getInstance().getPricing(QWEN_PROVIDER, model);
        // Custom models are configured by their base ID, while long-context mode may append
        // "[1m]"/"[500k]" to the requested ID. Retry with the suffix stripped; the exact-match
        // attempt above keeps suffixed configured keys authoritative when present.
        String stripped = stripContextSuffix(model.trim());
        if (configured.isEmpty() && !stripped.equals(model.trim())) {
            configured = CustomPricingProvider.getInstance().getPricing(QWEN_PROVIDER, stripped);
        }
        return configured.map(p -> merge(p, builtin)).orElse(null);
    }

    private static QwenPricing merge(ModelPricing configured, QwenPricing builtin) {
        return new QwenPricing(
                configured.inputCostPer1M() != null ? configured.inputCostPer1M()
                        : (builtin != null ? builtin.inputCostPer1M() : 0.0d),
                configured.outputCostPer1M() != null ? configured.outputCostPer1M()
                        : (builtin != null ? builtin.outputCostPer1M() : 0.0d),
                configured.cacheWriteCostPer1M() != null ? configured.cacheWriteCostPer1M()
                        : (builtin != null ? builtin.cacheWriteCostPer1M() : 0.0d),
                configured.cacheReadCostPer1M() != null ? configured.cacheReadCostPer1M()
                        : (builtin != null ? builtin.cacheReadCostPer1M() : 0.0d));
    }

    private static String normalize(String model) {
        if (model == null || model.isBlank()) {
            return null;
        }
        String candidate = stripContextSuffix(model.trim().toLowerCase(Locale.ROOT));
        return MODEL_PREFIXES.stream()
                .filter(candidate::startsWith)
                .findFirst()
                .orElse(candidate);
    }

    private static String stripContextSuffix(String modelId) {
        return CONTEXT_SUFFIX.matcher(modelId).replaceAll("");
    }
}
