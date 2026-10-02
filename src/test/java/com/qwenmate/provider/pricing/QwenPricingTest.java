package com.qwenmate.provider.pricing;

import com.qwenmate.provider.CustomPricingProvider;
import org.junit.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public class QwenPricingTest {

    @Test
    public void resolvesKnownModels() {
        QwenPricing coderPlus = QwenPricingTable.resolve("qwen3-coder-plus");
        assertNotNull(coderPlus);
        assertEquals(1.0, coderPlus.inputCostPer1M(), 0.0);
        assertEquals(5.0, coderPlus.outputCostPer1M(), 0.0);

        QwenPricing max = QwenPricingTable.resolve("qwen-max");
        assertNotNull(max);
        assertEquals(1.60, max.inputCostPer1M(), 0.0);
        assertEquals(6.40, max.outputCostPer1M(), 0.0);

        // Dated/versioned variants price as their base model.
        assertEquals(max, QwenPricingTable.resolve("qwen-max-2025-01-25"));
        assertEquals(max, QwenPricingTable.resolve("qwen-max-latest"));
    }

    @Test
    public void unknownModelResolvesToNull() {
        assertNull(QwenPricingTable.resolve("qwen-unknown-model"));
        assertNull(QwenPricingTable.resolve("some-private-model"));
        assertNull(QwenPricingTable.resolve(""));
        assertNull(QwenPricingTable.resolve(null));
    }

    @Test
    public void customPricingOverridesBuiltInTable() throws Exception {
        Path config = Files.createTempFile("qwen-pricing-test", ".json");
        Files.writeString(config, "{\"customModelPricing\":{\"qwen\":{\"qwen3-coder-plus\":{"
                + "\"inputCostPer1M\":2.0,\"outputCostPer1M\":10.0}}}}");
        CustomPricingProvider.setInstanceForTests(CustomPricingProvider.createForTests(config));
        try {
            QwenPricing pricing = QwenPricingTable.resolve("qwen3-coder-plus");
            assertNotNull(pricing);
            assertEquals(2.0, pricing.inputCostPer1M(), 0.0);
            assertEquals(10.0, pricing.outputCostPer1M(), 0.0);
            // Unspecified dimensions keep the model's own built-in rate.
            assertEquals(1.0, pricing.cacheWriteCostPer1M(), 0.0);
            assertEquals(0.20, pricing.cacheReadCostPer1M(), 0.0);
        } finally {
            CustomPricingProvider.setInstanceForTests(null);
            Files.deleteIfExists(config);
        }
    }

    @Test
    public void customPricingPricesModelUnknownToBuiltInTable() throws Exception {
        Path config = Files.createTempFile("qwen-pricing-test", ".json");
        Files.writeString(config, "{\"customModelPricing\":{\"qwen\":{\"my-private-model\":{"
                + "\"inputCostPer1M\":0.5,\"outputCostPer1M\":2.5}}}}");
        CustomPricingProvider.setInstanceForTests(CustomPricingProvider.createForTests(config));
        try {
            QwenPricing pricing = QwenPricingTable.resolve("my-private-model");
            assertNotNull(pricing);
            assertEquals(0.5, pricing.inputCostPer1M(), 0.0);
            assertEquals(2.5, pricing.outputCostPer1M(), 0.0);
            // No built-in rate to fall back to: remaining dimensions stay free.
            assertEquals(0.0, pricing.cacheWriteCostPer1M(), 0.0);
            assertEquals(0.0, pricing.cacheReadCostPer1M(), 0.0);
        } finally {
            CustomPricingProvider.setInstanceForTests(null);
            Files.deleteIfExists(config);
        }
    }

    @Test
    public void contextWindowSuffixResolvesLikeBaseModel() {
        QwenPricing base = QwenPricingTable.resolve("qwen-max");
        assertNotNull(base);
        assertEquals(base, QwenPricingTable.resolve("qwen-max[1m]"));
        assertEquals(base, QwenPricingTable.resolve("qwen-max[500k]"));

        QwenPricing coderPlus = QwenPricingTable.resolve("qwen3-coder-plus");
        assertEquals(coderPlus, QwenPricingTable.resolve("qwen3-coder-plus[1m]"));
        assertEquals(coderPlus, QwenPricingTable.resolve("qwen3-coder-plus[500k]"));
    }

    @Test
    public void customPricingAppliesToContextSuffixModelId() throws Exception {
        Path config = Files.createTempFile("qwen-pricing-test", ".json");
        Files.writeString(config, "{\"customModelPricing\":{\"qwen\":{\"qwen-plus\":{"
                + "\"inputCostPer1M\":0.8}}}}");
        CustomPricingProvider.setInstanceForTests(CustomPricingProvider.createForTests(config));
        try {
            QwenPricing base = QwenPricingTable.resolve("qwen-plus");
            assertNotNull(base);
            assertEquals(0.8, base.inputCostPer1M(), 0.0);
            // Suffixed IDs resolve to the base model's custom pricing as well.
            assertEquals(base, QwenPricingTable.resolve("qwen-plus[1m]"));
            assertEquals(base, QwenPricingTable.resolve("qwen-plus[500k]"));
        } finally {
            CustomPricingProvider.setInstanceForTests(null);
            Files.deleteIfExists(config);
        }
    }
}
