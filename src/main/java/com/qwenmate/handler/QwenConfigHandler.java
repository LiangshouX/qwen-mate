package com.qwenmate.handler;

import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.settings.QwenMateSettingsService;
import com.qwenmate.settings.QwenCliConfigReader;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

/**
 * Handles the Qwen auth configuration for Settings → Qwen 配置
 * (auth method / API key / base URL).
 *
 * Protocol (webview ↔ Java):
 *  - `get_qwen_config`        → `window.updateCurrentQwenConfig(json)`
 *  - `set_qwen_config:<json>` → `window.qwenConfigResult(json)`
 */
public class QwenConfigHandler {

    private static final Logger LOG = Logger.getInstance(QwenConfigHandler.class);

    private static final String AUTH_METHOD_API_KEY = "api_key";
    private static final String AUTH_METHOD_BASE_URL = "base_url";
    private static final String AUTH_METHOD_ENV = "env";

    private final HandlerContext context;
    private final Gson gson = new Gson();

    public QwenConfigHandler(HandlerContext context) {
        this.context = context;
    }

    /**
     * Push the persisted Qwen auth configuration to the webview.
     */
    public void handleGetQwenConfig() {
        JsonObject response = new JsonObject();
        try {
            QwenMateSettingsService settings = context.getSettingsService();
            response.addProperty("authMethod", normalizeAuthMethod(settings.getQwenAuthMethod()));
            response.addProperty("apiKey", nullToEmpty(settings.getQwenApiKey()));
            response.addProperty("apiBaseUrl", nullToEmpty(settings.getQwenApiBaseUrl()));
        } catch (Exception e) {
            LOG.error("[QwenConfigHandler] Failed to read Qwen config: " + e.getMessage(), e);
            response.addProperty("authMethod", AUTH_METHOD_API_KEY);
            response.addProperty("apiKey", "");
            response.addProperty("apiBaseUrl", "");
        }
        context.callJavaScript("window.updateCurrentQwenConfig", context.escapeJs(gson.toJson(response)));
    }

    /**
     * Push the model options declared by the Qwen Code CLI config
     * ({@code ~/.qwen/settings.json}) to the webview so the model selector can
     * list them and show which model the CLI resolves by default.
     */
    public void handleGetQwenModelOptions() {
        JsonObject response = new JsonObject();
        response.addProperty("configuredModel", QwenCliConfigReader.getConfiguredModelName());
        response.add("models", QwenCliConfigReader.listModelOptions());
        context.callJavaScript("window.updateQwenModelOptions", context.escapeJs(gson.toJson(response)));
    }

    /**
     * Persist the Qwen auth configuration sent by the webview and reply
     * with the operation result.
     */
    public void handleSetQwenConfig(String content) {
        JsonObject result = new JsonObject();
        try {
            JsonObject json = gson.fromJson(content, JsonObject.class);
            if (json == null) {
                throw new IllegalArgumentException("empty payload");
            }
            String authMethod = normalizeAuthMethod(optString(json, "authMethod"));
            String apiKey = optString(json, "apiKey").trim();
            String apiBaseUrl = optString(json, "apiBaseUrl").trim();

            QwenMateSettingsService settings = context.getSettingsService();
            settings.setQwenAuthMethod(authMethod);
            settings.setQwenApiKey(apiKey);
            settings.setQwenApiBaseUrl(apiBaseUrl);
            LOG.info("[QwenConfigHandler] Saved Qwen config (authMethod=" + authMethod + ")");

            result.addProperty("success", true);
        } catch (Exception e) {
            LOG.error("[QwenConfigHandler] Failed to save Qwen config: " + e.getMessage(), e);
            result.addProperty("success", false);
            result.addProperty("error", e.getMessage() != null ? e.getMessage() : "save failed");
        }
        context.callJavaScript("window.qwenConfigResult", context.escapeJs(gson.toJson(result)));
    }

    private static String normalizeAuthMethod(String method) {
        if (AUTH_METHOD_BASE_URL.equals(method) || AUTH_METHOD_ENV.equals(method)) {
            return method;
        }
        return AUTH_METHOD_API_KEY;
    }

    private static String optString(JsonObject json, String key) {
        return (json.has(key) && !json.get(key).isJsonNull()) ? json.get(key).getAsString() : "";
    }

    private static String nullToEmpty(String value) {
        return value != null ? value : "";
    }
}
