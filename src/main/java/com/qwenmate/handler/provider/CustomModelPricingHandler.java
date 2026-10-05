package com.qwenmate.handler.provider;

import com.qwenmate.handler.core.BaseMessageHandler;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.provider.CustomPricingProvider;
import com.qwenmate.settings.QwenMateSettingsService;
import com.qwenmate.settings.ModelPricing;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Handles persistence of user-configured model pricing.
 *
 * <p>The frontend sends {@code set_custom_model_pricing} whenever plugin-level custom models or
 * pricing-only configured models change. The payload shape is:
 * <pre>
 * { "provider": "qwen", "models": [ { "id": "...", "pricing": { ... } } ] }
 * </pre>
 * Pricing is supported for the qwen provider family. Context-window metadata is not accepted;
 * qwen's context behavior stays runtime-controlled.
 */
public class CustomModelPricingHandler extends BaseMessageHandler {

    private static final Logger LOG = Logger.getInstance(CustomModelPricingHandler.class);

    static final String SET_TYPE = "set_custom_model_pricing";

    private final QwenMateSettingsService settingsService;

    public CustomModelPricingHandler(HandlerContext context, QwenMateSettingsService settingsService) {
        super(context);
        this.settingsService = settingsService;
    }

    @Override
    public boolean handle(String type, String content) {
        if (!SET_TYPE.equals(type)) {
            return false;
        }
        try {
            JsonObject payload = JsonParser.parseString(content).getAsJsonObject();
            String provider = payload.has("provider") && !payload.get("provider").isJsonNull()
                    ? payload.get("provider").getAsString()
                    : null;
            if (!"qwen".equals(provider)) {
                LOG.warn("[CustomModelPricingHandler] Rejected unknown provider: " + provider);
                return true;
            }

            Map<String, ModelPricing> pricingMap = new LinkedHashMap<>();
            if (payload.has("models") && payload.get("models").isJsonArray()) {
                JsonArray models = payload.getAsJsonArray("models");
                for (JsonElement el : models) {
                    if (!el.isJsonObject()) {
                        continue;
                    }
                    JsonObject model = el.getAsJsonObject();
                    if (!model.has("id") || model.get("id").isJsonNull()) {
                        continue;
                    }
                    String id = model.get("id").getAsString().trim();
                    if (id.isEmpty()) {
                        continue;
                    }
                    ModelPricing pricing = parsePricing(model);
                    if (pricing != null) {
                        pricingMap.put(id, pricing);
                    }
                }
            }

            settingsService.setCustomModelPricing(provider, pricingMap);
            CustomPricingProvider.getInstance().invalidateCache();
            LOG.info("[CustomModelPricingHandler] Persisted " + pricingMap.size()
                    + " custom model pricing entries"
                    + " for " + provider);
        } catch (Exception e) {
            LOG.error("[CustomModelPricingHandler] Failed to handle " + type + ": " + e.getMessage(), e);
        }
        return true;
    }

    @Override
    public String[] getSupportedTypes() {
        return new String[]{SET_TYPE};
    }

    private ModelPricing parsePricing(JsonObject model) {
        if (!model.has("pricing") || !model.get("pricing").isJsonObject()) {
            return null;
        }
        JsonObject p = model.getAsJsonObject("pricing");
        Double input = readDouble(p, "inputCostPer1M");
        Double output = readDouble(p, "outputCostPer1M");
        Double cacheWrite = readDouble(p, "cacheWriteCostPer1M");
        Double cacheRead = readDouble(p, "cacheReadCostPer1M");
        if (input == null && output == null && cacheWrite == null && cacheRead == null) {
            return null;
        }
        return new ModelPricing(input, output, cacheWrite, cacheRead);
    }

    private static Double readDouble(JsonObject obj, String key) {
        if (obj == null || !obj.has(key) || obj.get(key).isJsonNull()) {
            return null;
        }
        try {
            double v = obj.get(key).getAsDouble();
            return Double.isFinite(v) && v >= 0 ? v : null;
        } catch (Exception e) {
            return null;
        }
    }
}
