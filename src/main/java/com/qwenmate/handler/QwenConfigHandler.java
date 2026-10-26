package com.qwenmate.handler;

import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.settings.QwenMateSettingsService;
import com.qwenmate.settings.QwenCliConfigReader;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;

/**
 * Handles the Qwen auth configuration for Settings → Qwen 配置
 * (auth method / API key / base URL) and the CLI's global default model.
 *
 * Protocol (webview ↔ Java):
 *  - `get_qwen_config`              → `window.updateCurrentQwenConfig(json)`
 *  - `set_qwen_config:<json>`       → `window.qwenConfigResult(json)`
 *  - `set_qwen_default_model:<json>`→ `window.onQwenDefaultModelResult(json)`
 *
 * The default-model write is delegated to the same JSONC-preserving settings
 * writer as the provider management page, so comments/formatting in
 * {@code ~/.qwen/settings.json} survive (CLI parity).
 */
public class QwenConfigHandler {

    private static final Logger LOG = Logger.getInstance(QwenConfigHandler.class);

    private static final String AUTH_METHOD_API_KEY = "api_key";
    private static final String AUTH_METHOD_BASE_URL = "base_url";
    private static final String AUTH_METHOD_ENV = "env";

    /** Seam for tests: runs one settings-writer op and returns its JSON result. */
    interface ConfigRunner {
        String run(String settingsPath, String payloadJson) throws Exception;
    }

    private final HandlerContext context;
    private final Gson gson = new Gson();
    private final ConfigRunner runner;

    public QwenConfigHandler(HandlerContext context) {
        this(context, null);
    }

    QwenConfigHandler(HandlerContext context, ConfigRunner runner) {
        this.context = context;
        this.runner = runner != null ? runner : new NodeRunner(context);
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

    /**
     * Persist the CLI's global default model (`model` in ~/.qwen/settings.json)
     * and reply once the JSONC writer finishes.
     *
     * Payload: {@code {modelId: string, provider?: string}}. A success also
     * re-pushes the model catalog so the selector's "current" badge follows
     * the new default without a plugin restart.
     */
    public void handleSetQwenDefaultModel(String content) {
        JsonObject response = new JsonObject();
        String modelId = "";
        try {
            JsonObject json = gson.fromJson(content, JsonObject.class);
            if (json == null) {
                throw new IllegalArgumentException("empty payload");
            }
            modelId = optString(json, "modelId").trim();
            if (modelId.isEmpty()) {
                throw new IllegalArgumentException("modelId is required");
            }

            JsonObject payload = new JsonObject();
            payload.addProperty("op", "setDefaultModel");
            payload.addProperty("modelId", modelId);
            String provider = optString(json, "provider").trim();
            if (!provider.isEmpty()) {
                payload.addProperty("provider", provider);
            }

            String raw = runner.run(QwenCliConfigReader.settingsPath().toString(), gson.toJson(payload));
            JsonObject result = parseWriterResult(raw);
            boolean ok = result.has("ok") && result.get("ok").getAsBoolean();
            response.addProperty("success", ok);
            response.addProperty("modelId", modelId);
            if (!ok) {
                response.addProperty("code", optString(result, "code"));
                response.addProperty("error", optString(result, "message"));
            }
        } catch (Exception e) {
            // warn (not error): Logger.error throws AssertionError under tests,
            // and an invalid request is an expected path, not a defect.
            LOG.warn("[QwenConfigHandler] Failed to set default model: " + e.getMessage());
            response.addProperty("success", false);
            if (!modelId.isEmpty()) {
                response.addProperty("modelId", modelId);
            }
            response.addProperty("error", e.getMessage() != null ? e.getMessage() : "save failed");
        }
        context.callJavaScript("window.onQwenDefaultModelResult", context.escapeJs(gson.toJson(response)));
        if (response.has("success") && response.get("success").getAsBoolean()) {
            handleGetQwenModelOptions();
        }
    }

    private static JsonObject parseWriterResult(String raw) {
        try {
            JsonObject parsed = JsonParser.parseString(raw).getAsJsonObject();
            if (parsed.has("ok")) {
                return parsed;
            }
        } catch (RuntimeException ignored) {
            // Fall through to the canonical error shape below.
        }
        JsonObject fallback = new JsonObject();
        fallback.addProperty("ok", false);
        fallback.addProperty("code", "bridge_error");
        fallback.addProperty("message", "settings writer returned no result");
        return fallback;
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

    private static final class NodeRunner implements ConfigRunner {
        private final NodeJsServiceCaller caller;

        private NodeRunner(HandlerContext context) {
            this.caller = new NodeJsServiceCaller(context);
        }

        @Override
        public String run(String settingsPath, String payloadJson) throws Exception {
            // User scope only: this writes the global default, never the
            // project-scoped settings file.
            return caller.callProviderConfigService(settingsPath, "", payloadJson);
        }
    }
}
