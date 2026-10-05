package com.qwenmate.util;

import com.qwenmate.provider.pricing.QwenPricing;
import com.qwenmate.provider.pricing.QwenPricingTable;
import com.google.gson.JsonObject;

/**
 * Calculates estimated per-turn usage cost using {@link QwenPricingTable}
 * (built-in Qwen pricing with user-configured overrides), the same pricing
 * configuration the frontend model dialog edits.
 *
 * <p>An unknown model or an unpriced provider yields {@code 0.0} ("unknown is
 * free"), while absent turn usage still yields {@code null} so callers can distinguish
 * "no usage" from "no pricing".
 */
public final class UsageCostCalculator {

    private UsageCostCalculator() {
    }

    public static Double calculateTurnCostUsd(String provider, JsonObject turnUsage, String model) {
        if (turnUsage == null) {
            return null;
        }
        if (!"qwen".equalsIgnoreCase(provider)) {
            // Any provider without a price list is reported as free.
            return 0.0d;
        }
        QwenPricing pricing = QwenPricingTable.resolve(model);
        if (pricing == null) {
            // Unknown model: stay free rather than guessing a price.
            return 0.0d;
        }
        long inputTokens = readLong(turnUsage, "input_tokens");
        // Thinking tokens bill as output; qwen reports them separately.
        long outputTokens = readLong(turnUsage, "output_tokens") + readLong(turnUsage, "thought_tokens");
        long cacheWriteTokens = readLong(turnUsage, "cache_creation_input_tokens", "cached_write_tokens");
        long cacheReadTokens = readLong(turnUsage, "cache_read_input_tokens", "cached_input_tokens",
                "cached_read_tokens", "cached_tokens");
        return pricing.costUsd(inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens);
    }

    private static long readLong(JsonObject json, String... keys) {
        if (json == null) {
            return 0;
        }
        for (String key : keys) {
            if (json.has(key) && !json.get(key).isJsonNull()) {
                return Math.max(0, json.get(key).getAsLong());
            }
        }
        return 0;
    }
}
