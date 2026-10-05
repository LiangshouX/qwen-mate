package com.qwenmate.handler.provider;

import com.qwenmate.handler.core.BaseMessageHandler;
import com.qwenmate.handler.core.HandlerContext;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;

/**
 * Provider message handler.
 * TODO: provider management messages (relay CRUD / cc-switch import) were
 * removed in the provider convergence; only the generic always-thinking
 * toggle remains here.
 */
public class ProviderHandler extends BaseMessageHandler {

    private static final Logger LOG = Logger.getInstance(ProviderHandler.class);
    private static final Gson GSON = new Gson();

    private static final String[] SUPPORTED_TYPES = {
        "get_thinking_enabled",
        "set_thinking_enabled",
    };

    public ProviderHandler(HandlerContext context) {
        super(context);
    }

    @Override
    public String[] getSupportedTypes() {
        return SUPPORTED_TYPES;
    }

    @Override
    public boolean handle(String type, String content) {
        switch (type) {
            case "get_thinking_enabled":
                handleGetThinkingEnabled();
                return true;
            case "set_thinking_enabled":
                handleSetThinkingEnabled(content);
                return true;
            default:
                return false;
        }
    }

    /**
     * Push the always-thinking toggle to the webview. Defaults to enabled
     * when the user never saved an explicit value.
     */
    private void handleGetThinkingEnabled() {
        try {
            Boolean enabled = context.getSettingsService().getAlwaysThinkingEnabled();
            boolean value = enabled != null ? enabled : true;

            JsonObject payload = new JsonObject();
            payload.addProperty("enabled", value);
            payload.addProperty("explicit", enabled != null);

            String json = GSON.toJson(payload);
            ApplicationManager.getApplication().invokeLater(() ->
                context.callJavaScript("window.updateThinkingEnabled", context.escapeJs(json)));
        } catch (Exception e) {
            LOG.error("[ProviderHandler] Failed to get thinking enabled: " + e.getMessage(), e);
        }
    }

    /**
     * Persist the always-thinking toggle sent by the webview.
     */
    private void handleSetThinkingEnabled(String content) {
        try {
            Boolean enabled = null;
            if (content != null && !content.trim().isEmpty()) {
                try {
                    JsonObject data = GSON.fromJson(content, JsonObject.class);
                    if (data != null && data.has("enabled") && !data.get("enabled").isJsonNull()) {
                        enabled = data.get("enabled").getAsBoolean();
                    }
                } catch (Exception e) {
                    LOG.debug("[ProviderHandler] Content is not JSON, treating as raw string", e);
                }
            }

            if (enabled == null) {
                enabled = Boolean.parseBoolean(content != null ? content.trim() : "false");
            }

            context.getSettingsService().setAlwaysThinkingEnabled(enabled);
        } catch (Exception e) {
            LOG.error("[ProviderHandler] Failed to set thinking enabled: " + e.getMessage(), e);
        }
    }
}
