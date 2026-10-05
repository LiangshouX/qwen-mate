package com.qwenmate.handler.provider;

import com.qwenmate.settings.QwenMateSettingsService;
import com.qwenmate.settings.ModelPricing;
import org.junit.Test;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class CustomModelPricingHandlerTest {

    @Test
    public void shouldPersistOnlyModelsWithValidPricing() {
        CapturingSettingsService settings = new CapturingSettingsService();
        CustomModelPricingHandler handler = new CustomModelPricingHandler(null, settings);

        boolean handled = handler.handle(CustomModelPricingHandler.SET_TYPE, """
                {
                  "provider": "qwen",
                  "models": [
                    {
                      "id": "custom-model",
                      "pricing": {
                        "inputCostPer1M": 0.2,
                        "outputCostPer1M": 0.8,
                        "cacheReadCostPer1M": 0.02
                      }
                    },
                    {
                      "id": "default-price-model"
                    },
                    {
                      "id": "partial-price-model",
                      "pricing": {
                        "inputCostPer1M": 0.3,
                        "outputCostPer1M": -1
                      }
                    }
                  ]
                }
                """);

        assertTrue(handled);
        assertEquals("qwen", settings.providerRef.get());
        Map<String, ModelPricing> savedPricing = settings.pricingRef.get();
        assertEquals(2, savedPricing.size());
        assertEquals(0.2, savedPricing.get("custom-model").inputCostPer1M(), 0.000001);
        assertEquals(0.8, savedPricing.get("custom-model").outputCostPer1M(), 0.000001);
        assertEquals(0.02, savedPricing.get("custom-model").cacheReadCostPer1M(), 0.000001);
        assertEquals(0.3, savedPricing.get("partial-price-model").inputCostPer1M(), 0.000001);
        assertNull(savedPricing.get("partial-price-model").outputCostPer1M());
    }

    @Test
    public void shouldIgnoreUnknownProvider() {
        CapturingSettingsService settings = new CapturingSettingsService();
        CustomModelPricingHandler handler = new CustomModelPricingHandler(null, settings);

        boolean handled = handler.handle(CustomModelPricingHandler.SET_TYPE, "{\"provider\":\"other\",\"models\":[]}");

        assertTrue(handled);
        assertNull(settings.providerRef.get());
        assertNull(settings.pricingRef.get());
    }

    @Test
    public void shouldKeepQwenPricingAndIgnoreContextWindowTokens() {
        CapturingSettingsService settings = new CapturingSettingsService();
        CustomModelPricingHandler handler = new CustomModelPricingHandler(null, settings);

        boolean handled = handler.handle(CustomModelPricingHandler.SET_TYPE,
                "{\"provider\":\"qwen\",\"models\":[{\"id\":\"custom-qwen\","
                        + "\"contextWindowTokens\":500000,\"pricing\":{\"inputCostPer1M\":0.2}}]}");

        assertTrue(handled);
        assertEquals("qwen", settings.providerRef.get());
        assertEquals(0.2, settings.pricingRef.get().get("custom-qwen").inputCostPer1M(), 0.000001);
    }

    private static final class CapturingSettingsService extends QwenMateSettingsService {
        private final AtomicReference<String> providerRef = new AtomicReference<>();
        private final AtomicReference<Map<String, ModelPricing>> pricingRef = new AtomicReference<>();

        @Override
        public void setCustomModelPricing(String provider, Map<String, ModelPricing> pricing) throws IOException {
            providerRef.set(provider);
            pricingRef.set(pricing);
        }
    }
}
