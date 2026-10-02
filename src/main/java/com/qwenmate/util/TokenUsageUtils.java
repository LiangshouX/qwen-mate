package com.qwenmate.util;

import com.qwenmate.session.QwenMateSession;
import com.google.gson.JsonObject;

import java.util.List;

/**
 * Utility class for token usage calculation across providers.
 * Centralizes provider-aware token extraction and usage JSON lookup
 * — used by MessageJsonConverter, SettingsHandler, and QwenMateSession.
 */
public final class TokenUsageUtils {

    private TokenUsageUtils() {
    } // utility class, no instances

    /**
     * Calculate total token usage for display in status bar.
     * Formula: input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens
     * This matches CLI's status bar display which shows total tokens used (not just context window).
     */
    public static int calculateTotalTokens(int inputTokens, int cacheCreationTokens, int cacheReadTokens, int outputTokens) {
        return inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens;
    }

    public static int extractContextTokens(JsonObject usage, String provider) {
        if (usage == null) {
            return 0;
        }
        int input = firstInt(usage, "input_tokens");
        int cacheCreation = firstInt(usage, "cache_creation_input_tokens", "cached_write_tokens");
        int cacheRead = firstInt(usage, "cache_read_input_tokens", "cached_read_tokens",
                "cached_input_tokens", "cached_tokens");
        return input + cacheCreation + cacheRead;
    }

    /**
     * Extract used token count from a usage JSON object.
     * Formula: input + cache_creation + cache_read + output (total tokens, matches CLI status bar).
     */
    public static int extractUsedTokens(JsonObject usage, String provider) {
        if (usage == null) { return 0; }
        int input = firstInt(usage, "input_tokens");
        int output = firstInt(usage, "output_tokens") + firstInt(usage, "thought_tokens");
        int cacheCreation = firstInt(usage, "cache_creation_input_tokens", "cached_write_tokens");
        int cacheRead = firstInt(usage, "cache_read_input_tokens", "cached_read_tokens",
                "cached_input_tokens", "cached_tokens");
        return calculateTotalTokens(input, cacheCreation, cacheRead, output);
    }

    private static int firstInt(JsonObject usage, String... keys) {
        for (String key : keys) {
            if (usage.has(key) && !usage.get(key).isJsonNull()) {
                return usage.get(key).getAsInt();
            }
        }
        return 0;
    }

    /**
     * Resolve the effective context window retained in provider usage metadata.
     * Providers that do not report a session-specific value keep the supplied
     * static model limit as a compatibility fallback.
     */
    public static int extractMaxTokens(JsonObject usage, int fallbackMaxTokens) {
        if (usage != null) {
            String[] keys = {"model_context_window", "maxTokens", "limit"};
            for (String key : keys) {
                if (!usage.has(key) || usage.get(key).isJsonNull()) {
                    continue;
                }
                try {
                    int value = usage.get(key).getAsInt();
                    if (value > 0) {
                        return value;
                    }
                } catch (RuntimeException ignored) {
                    // Ignore malformed provider metadata and retain the static fallback.
                }
            }
        }
        return Math.max(0, fallbackMaxTokens);
    }

    /**
     * Find the last usage JSON from a list of raw server messages (JsonObject).
     * Scans from end to find the last assistant message with usage data.
     */
    public static JsonObject findLastUsageFromRawMessages(List<JsonObject> messages) {
        return findLastUsageFromRawMessages(messages, null);
    }

    public static JsonObject findLastUsageFromRawMessages(List<JsonObject> messages, String provider) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            JsonObject msg = messages.get(i);
            if (!msg.has("type") || !"assistant".equals(msg.get("type").getAsString())) { continue; }
            JsonObject rootUsage = msg.has("usage") && msg.get("usage").isJsonObject()
                    ? msg.getAsJsonObject("usage") : null;
            if (msg.has("message") && msg.get("message").isJsonObject()) {
                JsonObject message = msg.getAsJsonObject("message");
                if (message.has("usage") && message.get("usage").isJsonObject()) {
                    return message.getAsJsonObject("usage");
                }
            }
            if (rootUsage != null) {
                return rootUsage;
            }
        }
        return null;
    }

    /**
     * Find the last usage JSON from a list of parsed session messages.
     * Scans from end to find the last assistant message with usage data.
     */
    public static JsonObject findLastUsageFromSessionMessages(List<QwenMateSession.Message> messages) {
        return findLastUsageFromSessionMessages(messages, null);
    }

    public static JsonObject findLastUsageFromSessionMessages(
            List<QwenMateSession.Message> messages,
            String provider
    ) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            QwenMateSession.Message msg = messages.get(i);
            if (msg.type != QwenMateSession.Message.Type.ASSISTANT || msg.raw == null) { continue; }
            JsonObject rootUsage = msg.raw.has("usage") && msg.raw.get("usage").isJsonObject()
                    ? msg.raw.getAsJsonObject("usage") : null;
            // Check usage inside message object
            if (msg.raw.has("message") && msg.raw.get("message").isJsonObject()) {
                JsonObject message = msg.raw.getAsJsonObject("message");
                if (message.has("usage") && message.get("usage").isJsonObject()) {
                    return message.getAsJsonObject("usage");
                }
            }
            if (rootUsage != null) {
                return rootUsage;
            }
        }
        return null;
    }

    /**
     * Remove provider/model-specific current-context snapshots from retained messages.
     * Historical per-turn accounting remains intact because turnUsage and turnCostUsd
     * are deliberately not touched.
     */
    public static void clearContextUsageFromSessionMessages(List<QwenMateSession.Message> messages) {
        if (messages == null) {
            return;
        }
        for (QwenMateSession.Message message : messages) {
            if (message == null || message.raw == null) {
                continue;
            }
            message.raw.remove("usage");
            if (message.raw.has("message") && message.raw.get("message").isJsonObject()) {
                message.raw.getAsJsonObject("message").remove("usage");
            }
        }
    }
}
