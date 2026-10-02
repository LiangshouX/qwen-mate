package com.qwenmate.mcp.marketplace;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/**
 * Small JSON helper focused on registry metadata parsing.
 */
final class McpMarketplaceJson {

    private McpMarketplaceJson() {
    }

    static String getString(JsonObject object, String... keys) {
        if (object == null) {
            return null;
        }
        for (String key : keys) {
            if (object.has(key) && !object.get(key).isJsonNull()) {
                JsonElement element = object.get(key);
                if (element.isJsonPrimitive()) {
                    return element.getAsString();
                }
            }
        }
        return null;
    }

    static boolean getBoolean(JsonObject object, String key, boolean defaultValue) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) {
            return defaultValue;
        }
        JsonElement element = object.get(key);
        return element.isJsonPrimitive() ? element.getAsBoolean() : defaultValue;
    }

    static int getInt(JsonObject object, String key, int defaultValue) {
        if (object == null || !object.has(key) || object.get(key).isJsonNull()) {
            return defaultValue;
        }
        JsonElement element = object.get(key);
        return element.isJsonPrimitive() ? element.getAsInt() : defaultValue;
    }

    static JsonObject getObject(JsonObject object, String key) {
        if (object != null && object.has(key) && object.get(key).isJsonObject()) {
            return object.getAsJsonObject(key);
        }
        return null;
    }

    static JsonArray getArray(JsonObject object, String key) {
        if (object != null && object.has(key) && object.get(key).isJsonArray()) {
            return object.getAsJsonArray(key);
        }
        return null;
    }
}
