package com.qwenmate.handler;

import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.settings.QwenCliConfigReader;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;

/**
 * Visual provider/model configuration (Settings → 供应商管理).
 *
 * Protocol (webview ↔ Java):
 *  - `get_provider_config`       → window.updateProviderConfig(json)
 *  - `provider_config_op:<json>` → window.providerConfigResult(json)
 *
 * Every read and write is executed by ai-bridge/services/settings-writer-
 * service.cjs — a port of the CLI's own JSONC settings writer — so the GUI
 * never edits settings.json itself and the file's format, comments and
 * structure survive byte-for-byte (CLI parity). Snapshots are redacted at
 * the source: API key values never reach the webview, only per-key status.
 *
 * SECURITY: neither the inbound payload (may contain a freshly typed API
 * key) nor the raw Node output is ever logged here — only op names and
 * result codes.
 */
public class ProviderConfigHandler {

    private static final Logger LOG = Logger.getInstance(ProviderConfigHandler.class);

    /** Seam for tests: runs one op and returns the service's JSON result. */
    interface ConfigRunner {
        String run(String settingsPath, String projectSettingsPath, String payloadJson) throws Exception;
    }

    private final HandlerContext context;
    private final Gson gson = new Gson();
    private final ConfigRunner runner;

    public ProviderConfigHandler(HandlerContext context) {
        this(context, null);
    }

    ProviderConfigHandler(HandlerContext context, ConfigRunner runner) {
        this.context = context;
        this.runner = runner != null ? runner : new NodeRunner(context);
    }

    /** Push the redacted provider-config snapshot to the webview. */
    public void handleGetProviderConfig() {
        dispatch("{\"op\":\"snapshot\"}", "window.updateProviderConfig", null);
    }

    /** Execute one mutating provider-config op and push the result. */
    public void handleProviderConfigOp(String content) {
        String requestId = null;
        try {
            JsonObject payload = JsonParser.parseString(content).getAsJsonObject();
            if (payload.has("requestId") && !payload.get("requestId").isJsonNull()) {
                requestId = payload.get("requestId").getAsString();
            }
        } catch (RuntimeException e) {
            // Malformed payload — let the service produce the canonical error.
        }
        dispatch(content, "window.providerConfigResult", requestId);
    }

    private void dispatch(String payloadJson, String callback, String requestId) {
        JsonObject result;
        try {
            String settingsPath = QwenCliConfigReader.settingsPath().toString();
            String projectSettingsPath = resolveProjectSettingsPath();
            String raw = runner.run(settingsPath, projectSettingsPath, payloadJson);
            result = parseResult(raw);
        } catch (Exception e) {
            // Never include the payload: it can carry an API key.
            // warn (not error): Logger.error throws AssertionError under tests,
            // and this is an expected transport-failure path, not a defect.
            LOG.warn("[ProviderConfigHandler] service call failed: " + e.getMessage());
            result = new JsonObject();
            result.addProperty("ok", false);
            result.addProperty("code", "bridge_error");
            result.addProperty("message", e.getMessage() != null ? e.getMessage() : "node service failed");
        }
        if (requestId != null) {
            result.addProperty("requestId", requestId);
        }
        context.callJavaScript(callback, context.escapeJs(gson.toJson(result)));
    }

    private static JsonObject parseResult(String raw) {
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
        fallback.addProperty("message", "provider-config service returned no result");
        return fallback;
    }

    /**
     * Project-scoped settings file that may shadow user-scope modelProviders:
     * the effective working directory's {@code .qwen/settings.json} (empty
     * string when no project is open — user scope only).
     */
    private String resolveProjectSettingsPath() {
        try {
            String workingDir = context.resolveEffectiveWorkingDirectory();
            if (workingDir == null || workingDir.isEmpty()) {
                return "";
            }
            return workingDir + "/.qwen/settings.json";
        } catch (RuntimeException e) {
            return "";
        }
    }

    private static final class NodeRunner implements ConfigRunner {
        private final NodeJsServiceCaller caller;

        private NodeRunner(HandlerContext context) {
            this.caller = new NodeJsServiceCaller(context);
        }

        @Override
        public String run(String settingsPath, String projectSettingsPath, String payloadJson) throws Exception {
            return caller.callProviderConfigService(settingsPath, projectSettingsPath, payloadJson);
        }
    }
}
