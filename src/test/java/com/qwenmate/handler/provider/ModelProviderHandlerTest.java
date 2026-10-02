package com.qwenmate.handler.provider;

import com.qwenmate.handler.UsagePushService;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.provider.CustomModelContextWindowProvider;
import com.qwenmate.session.QwenMateSession;
import com.google.gson.JsonObject;
import org.junit.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * Regression tests for model context limits and model/provider transitions in
 * {@link ModelProviderHandler}.
 */
public class ModelProviderHandlerTest {

    @Test
    public void shouldParseCapacitySuffixForCustomContextLimits() {
        assertEquals(500_000, ModelProviderHandler.getModelContextLimit("custom-model[500k]"));
        assertEquals(2_000_000, ModelProviderHandler.getModelContextLimit("custom-model[2m]"));
        assertEquals(100_000, ModelProviderHandler.getModelContextLimit("custom-model[100K]"));
    }

    @Test
    public void shouldUseBuiltinQwenContextWindowsWhenNothingConfigured() throws Exception {
        // Isolate from the developer's real ~/.qwen/settings.json.
        com.qwenmate.settings.QwenCliConfigReader.setSettingsPathOverrideForTests(
                Path.of("does-not-exist", "settings.json"));
        try {
            // Mirrors the Qwen Code CLI tokenLimits table.
            assertEquals(1_000_000, ModelProviderHandler.getModelContextLimit("qwen3-coder-plus"));
            assertEquals(1_000_000, ModelProviderHandler.getModelContextLimit("qwen3-coder-flash"));
            assertEquals(1_000_000, ModelProviderHandler.getModelContextLimit("qwen3.7-plus"));
            assertEquals(1_000_000, ModelProviderHandler.getModelContextLimit("coder-model"));
            assertEquals(256_000, ModelProviderHandler.getModelContextLimit("qwen3-max"));
            assertEquals(256_000, ModelProviderHandler.getModelContextLimit("qwen3-coder-next"));
            assertEquals(256_000, ModelProviderHandler.getModelContextLimit("qwen-max"));
            assertEquals(200_000, ModelProviderHandler.getModelContextLimit("totally-unknown-model"));
        } finally {
            com.qwenmate.settings.QwenCliConfigReader.setSettingsPathOverrideForTests(null);
        }
    }

    @Test
    public void shouldPreferCliConfigContextWindowOverBuiltin() throws Exception {
        com.qwenmate.settings.QwenCliConfigReader.setSettingsPathOverrideForTests(
                writeSettings("""
                        {
                          "modelProviders": {
                            "mimo": [
                              { "id": "qwen3-coder-plus", "generationConfig": { "contextWindowSize": 128000 } }
                            ]
                          }
                        }
                        """));
        try {
            assertEquals(128_000, ModelProviderHandler.getModelContextLimit("qwen3-coder-plus"));
        } finally {
            com.qwenmate.settings.QwenCliConfigReader.setSettingsPathOverrideForTests(null);
        }
    }

    @Test
    public void followCliDefaultResolvesConfiguredModelWindow() throws Exception {
        com.qwenmate.settings.QwenCliConfigReader.setSettingsPathOverrideForTests(
                writeSettings("""
                        {
                          "model": { "name": "mimo-v2.5-pro" },
                          "modelProviders": {
                            "mimo": [
                              { "id": "mimo-v2.5-pro", "generationConfig": { "contextWindowSize": 1000000 } }
                            ]
                          }
                        }
                        """));
        try {
            // Empty model = "follow CLI config": must pick up the configured model's window.
            assertEquals(1_000_000, ModelProviderHandler.getModelContextLimit(""));
        } finally {
            com.qwenmate.settings.QwenCliConfigReader.setSettingsPathOverrideForTests(null);
        }
    }

    private static Path writeSettings(String json) throws Exception {
        Path settings = Files.createTempFile("qwen-settings", ".json");
        Files.writeString(settings, json);
        return settings;
    }

    @Test
    public void shouldPreferConfiguredCustomContextAndKeepExistingFallbacks() throws Exception {
        Path config = Files.createTempFile("model-context-limit", ".json");
        Files.writeString(config, """
                {
                  "customModelContextWindows": {
                    "dsh": {
                      "custom-model": 750000
                    }
                  }
                }
                """);
        CustomModelContextWindowProvider.setInstanceForTests(
                CustomModelContextWindowProvider.createForTests(config)
        );

        try {
            assertEquals(750_000, ModelProviderHandler.getModelContextLimit("dsh", "custom-model"));
            assertEquals(1_000_000, ModelProviderHandler.getModelContextLimit("dsh", "custom-model[1m]"));
            assertEquals(500_000, ModelProviderHandler.getModelContextLimit("dsh", "legacy-model[500k]"));
            assertEquals(200_000, ModelProviderHandler.getModelContextLimit("dsh", "unknown-model"));
        } finally {
            CustomModelContextWindowProvider.setInstanceForTests(null);
        }
    }

    @Test
    public void shouldIgnoreConfiguredCustomContextForQwen() throws Exception {
        Path config = Files.createTempFile("model-context-limit", ".json");
        Files.writeString(config, """
                {
                  "customModelContextWindows": {
                    "qwen": {
                      "custom-qwen": 750000
                    }
                  }
                }
                """);
        CustomModelContextWindowProvider.setInstanceForTests(
                CustomModelContextWindowProvider.createForTests(config)
        );

        try {
            assertEquals(200_000, ModelProviderHandler.getModelContextLimit("qwen", "custom-qwen"));
            assertEquals(1_000_000, ModelProviderHandler.getModelContextLimit("qwen", "custom-qwen[1m]"));
        } finally {
            CustomModelContextWindowProvider.setInstanceForTests(null);
        }
    }

    /**
     * Verifies only a real cross-provider transition invalidates provider-owned context usage.
     */
    @Test
    public void shouldDetectOnlyActualProviderSwitches() {
        assertTrue(ModelProviderHandler.isActualProviderSwitch("qwen", "dsh"));
        assertFalse(ModelProviderHandler.isActualProviderSwitch("dsh", "dsh"));
        assertFalse(ModelProviderHandler.isActualProviderSwitch(null, "dsh"));
        assertFalse(ModelProviderHandler.isActualProviderSwitch("", "dsh"));
    }

    /**
     * Verifies same-model reaffirmation remains a no-op so dynamic context capacity is retained.
     */
    @Test
    public void shouldDetectOnlyActualModelSwitches() {
        assertTrue(ModelProviderHandler.isActualModelSwitch("qwen3-coder-plus", "qwen3-coder-max"));
        assertFalse(ModelProviderHandler.isActualModelSwitch("qwen3-coder-max", "qwen3-coder-max"));
        assertFalse(ModelProviderHandler.isActualModelSwitch(null, "qwen3-coder-max"));
        assertFalse(ModelProviderHandler.isActualModelSwitch("", "qwen3-coder-max"));
    }

    /**
     * Verifies startup model synchronization treats the restored Session model as
     * authoritative when HandlerContext still contains its default, preserving the
     * usage snapshot for a same-value frontend set_model command.
     */
    @Test
    public void handleSetModelPreservesUsageWhenRestoredSessionAlreadyOwnsModel() {
        HandlerContext context = createHandlerContext();
        QwenMateSession session = new QwenMateSession(null, null, null);
        session.setProvider("qwen");
        session.setModel("qwen3-coder-plus");
        JsonObject raw = new JsonObject();
        raw.add("usage", createUsage(49300, 258400));
        session.getState().addMessage(new QwenMateSession.Message(
                QwenMateSession.Message.Type.ASSISTANT, "restored", raw));
        context.setSession(session);
        context.setCurrentProvider("qwen");
        context.setCurrentModel(HandlerContext.DEFAULT_MODEL);
        RecordingUsagePushService usagePushService = new RecordingUsagePushService(context);

        new ModelProviderHandler(context, usagePushService).handleSetModel("qwen3-coder-plus");

        assertEquals("qwen3-coder-plus", context.getCurrentModel());
        assertTrue(raw.has("usage"));
        assertFalse(usagePushService.cleared);
        assertFalse(usagePushService.recalculated);
    }

    private static HandlerContext createHandlerContext() {
        return new HandlerContext(null, null, null, new HandlerContext.JsCallback() {
            @Override
            public void callJavaScript(String functionName, String... args) {
                // No-op callback for handler state tests.
            }

            @Override
            public String escapeJs(String str) {
                return str;
            }
        });
    }

    private static JsonObject createUsage(int inputTokens, int contextWindow) {
        JsonObject usage = new JsonObject();
        usage.addProperty("input_tokens", inputTokens);
        usage.addProperty("output_tokens", 0);
        usage.addProperty("model_context_window", contextWindow);
        return usage;
    }

    /**
     * Records whether a model command attempted to invalidate or recalculate usage.
     */
    private static final class RecordingUsagePushService extends UsagePushService {
        private boolean cleared;
        private boolean recalculated;

        private RecordingUsagePushService(HandlerContext context) {
            super(context);
        }

        @Override
        public void clearUsageDisplay() {
            cleared = true;
        }

        @Override
        public void pushUsageUpdateAfterModelChange(int newMaxTokens) {
            recalculated = true;
        }
    }
}
