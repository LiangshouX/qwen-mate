package com.qwenmate.util;

import com.qwenmate.provider.CustomPricingProvider;
import com.google.gson.JsonObject;
import org.junit.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class UsageCostCalculatorTest {

    @Test
    public void calculatesQwenTurnCostForKnownModel() {
        JsonObject usage = new JsonObject();
        usage.addProperty("input_tokens", 62000);
        usage.addProperty("cache_creation_input_tokens", 0);
        usage.addProperty("cache_read_input_tokens", 1178000);
        usage.addProperty("output_tokens", 11100);

        // qwen3-coder-plus: input 1.0 / output 5.0 / cacheRead 0.20 per 1M.
        // 0.062 * 1.0 + 1.178 * 0.20 + 0.0111 * 5.0 = 0.3531
        double cost = UsageCostCalculator.calculateTurnCostUsd("qwen", usage, "qwen3-coder-plus");

        assertEquals(0.3531, cost, 0.000001);
    }

    @Test
    public void pricesContextSuffixModelLikeItsBaseModel() {
        JsonObject usage = new JsonObject();
        usage.addProperty("input_tokens", 1_000_000);
        usage.addProperty("output_tokens", 500_000);

        // qwen-max: input 1.6 / output 6.4 per 1M => 1.6 + 3.2 = 4.8
        double baseCost = UsageCostCalculator.calculateTurnCostUsd("qwen", usage, "qwen-max");
        assertEquals(4.8, baseCost, 0.000001);
        assertEquals(baseCost, UsageCostCalculator.calculateTurnCostUsd("qwen", usage, "qwen-max[1m]"), 0.0);
        assertEquals(baseCost, UsageCostCalculator.calculateTurnCostUsd("qwen", usage, "qwen-max[500k]"), 0.0);
    }

    @Test
    public void pricesMappedCustomModelUsingConfiguredRates() throws Exception {
        Path config = Files.createTempFile("pricing-test", ".json");
        Files.writeString(config, "{\"customModelPricing\":{\"qwen\":{\"my-private-model\":{"
                + "\"inputCostPer1M\":1.0,\"outputCostPer1M\":2.0,\"cacheReadCostPer1M\":0.02}}}}");
        CustomPricingProvider.setInstanceForTests(CustomPricingProvider.createForTests(config));
        try {
            JsonObject usage = new JsonObject();
            usage.addProperty("input_tokens", 62000);
            usage.addProperty("cache_read_input_tokens", 1178000);
            usage.addProperty("output_tokens", 11100);

            // Custom pricing resolves the suffixed ID to its configured base model.
            double cost = UsageCostCalculator.calculateTurnCostUsd("qwen", usage, "my-private-model[1m]");

            // 0.062 * 1 + 1.178 * 0.02 + 0.0111 * 2 = 0.10776
            assertEquals(0.10776, cost, 0.00001);
        } finally {
            CustomPricingProvider.setInstanceForTests(null);
            Files.deleteIfExists(config);
        }
    }

    @Test
    public void returnsZeroCostForUnknownModelAndUnpricedProvider() {
        JsonObject usage = new JsonObject();
        usage.addProperty("input_tokens", 1200);
        usage.addProperty("output_tokens", 456);

        // Unknown models and unpriced providers stay free.
        assertEquals(0.0d, UsageCostCalculator.calculateTurnCostUsd("qwen", usage, "qwen-unknown-model"), 0.0);
        assertEquals(0.0d, UsageCostCalculator.calculateTurnCostUsd("custom-provider", usage, "custom-model"), 0.0);
    }

    @Test
    public void returnsNullWhenTurnUsageMissing() {
        assertNull(UsageCostCalculator.calculateTurnCostUsd("qwen", null, "qwen-max"));
    }
}
