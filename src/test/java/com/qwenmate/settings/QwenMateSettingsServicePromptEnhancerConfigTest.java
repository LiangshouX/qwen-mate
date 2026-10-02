package com.qwenmate.settings;

import com.qwenmate.util.PlatformUtils;
import com.google.gson.JsonObject;
import org.junit.After;
import org.junit.Test;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class QwenMateSettingsServicePromptEnhancerConfigTest {
    private String originalHomeDir;

    @After
    public void tearDown() throws Exception {
        if (originalHomeDir != null) {
            setCachedHomeDirectory(originalHomeDir);
            originalHomeDir = null;
        }
    }

    @Test
    public void shouldDefaultToQwenDshModelsWithAutoResolution() throws Exception {
        Path tempHome = Files.createTempDirectory("prompt-enhancer-default-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        JsonObject config = service.getPromptEnhancerConfig();

        assertTrue(config.get("provider").isJsonNull());
        // Empty model id = follow the Qwen CLI config
        assertEquals("", config.getAsJsonObject("models").get("qwen").getAsString());
        assertEquals("auto", config.getAsJsonObject("models").get("dsh").getAsString());
        // Same provider set as the main chat selector
        assertTrue(config.getAsJsonObject("availability").has("qwen"));
        assertTrue(config.getAsJsonObject("availability").has("dsh"));
        assertAutoResolution(config, null);
    }

    @Test
    public void shouldPreferCurrentChatProviderInAutoModeWhenAvailable() throws Exception {
        Path tempHome = Files.createTempDirectory("prompt-enhancer-prefer-chat-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        // Preferred provider is followed when its CLI is available, otherwise
        // resolution falls back to Qwen -> DSH (availability depends on the machine).
        assertAutoResolution(service.getPromptEnhancerConfig("qwen"), "qwen");
        assertAutoResolution(service.getPromptEnhancerConfig("dsh"), "dsh");
        // Unknown preferred provider is ignored -> plain Qwen -> DSH fallback.
        assertAutoResolution(service.getPromptEnhancerConfig("grok"), null);
    }

    @Test
    public void shouldPersistManualProviderAndProviderSpecificModels() throws Exception {
        Path tempHome = Files.createTempDirectory("prompt-enhancer-manual-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        JsonObject models = new JsonObject();
        models.addProperty("qwen", "custom-qwen-model");
        models.addProperty("dsh", "custom-dsh-model");
        service.setPromptEnhancerConfig("qwen", models);

        JsonObject config = service.getPromptEnhancerConfig();

        assertEquals("qwen", config.get("provider").getAsString());
        assertEquals("custom-qwen-model", config.getAsJsonObject("models").get("qwen").getAsString());
        assertEquals("custom-dsh-model", config.getAsJsonObject("models").get("dsh").getAsString());
        if (config.getAsJsonObject("availability").get("qwen").getAsBoolean()) {
            assertEquals("manual", config.get("resolutionSource").getAsString());
            assertEquals("qwen", config.get("effectiveProvider").getAsString());
        } else {
            assertEquals("unavailable", config.get("resolutionSource").getAsString());
            assertTrue(config.get("effectiveProvider").isJsonNull());
        }
    }

    @Test
    public void shouldIgnoreUnknownProvidersInModelsMap() throws Exception {
        Path tempHome = Files.createTempDirectory("prompt-enhancer-unknown-provider-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        JsonObject models = new JsonObject();
        models.addProperty("qwen", "custom-qwen-model");
        models.addProperty("claude", "claude-sonnet-5"); // retired provider, must be dropped
        service.setPromptEnhancerConfig(null, models);

        JsonObject config = service.getPromptEnhancerConfig();
        JsonObject savedModels = config.getAsJsonObject("models");

        assertEquals(2, savedModels.size());
        assertEquals("custom-qwen-model", savedModels.get("qwen").getAsString());
        // Partial model map keeps the default for missing providers
        assertEquals("auto", savedModels.get("dsh").getAsString());
        assertFalse(savedModels.has("claude"));
    }

    @Test
    public void shouldResetToAutoModeWhenProviderCleared() throws Exception {
        Path tempHome = Files.createTempDirectory("prompt-enhancer-reset-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        JsonObject models = new JsonObject();
        models.addProperty("qwen", "custom-qwen-model");
        service.setPromptEnhancerConfig("qwen", models);

        service.setPromptEnhancerConfig(null, null);

        JsonObject config = service.getPromptEnhancerConfig();
        assertTrue(config.get("provider").isJsonNull());
        // Models survive a provider reset (only the manual provider is cleared)
        assertEquals("custom-qwen-model", config.getAsJsonObject("models").get("qwen").getAsString());
    }

    /**
     * Asserts auto-mode resolution against the availability map reported in the
     * same response: preferred provider when available, otherwise Qwen -> DSH.
     * Machine-dependent CLI availability is read from the response itself.
     */
    private static void assertAutoResolution(JsonObject config, String preferredProvider) {
        assertTrue(config.get("provider").isJsonNull());
        JsonObject availability = config.getAsJsonObject("availability");

        String expected = null;
        if (preferredProvider != null && availability.get(preferredProvider).getAsBoolean()) {
            expected = preferredProvider;
        } else if (availability.get("qwen").getAsBoolean()) {
            expected = "qwen";
        } else if (availability.get("dsh").getAsBoolean()) {
            expected = "dsh";
        }

        if (expected == null) {
            assertTrue(config.get("effectiveProvider").isJsonNull());
            assertEquals("unavailable", config.get("resolutionSource").getAsString());
        } else {
            assertEquals(expected, config.get("effectiveProvider").getAsString());
            assertEquals("auto", config.get("resolutionSource").getAsString());
        }
    }

    private void useTemporaryHomeDirectory(Path tempHome) throws Exception {
        if (originalHomeDir == null) {
            originalHomeDir = getCachedHomeDirectory();
        }
        setCachedHomeDirectory(tempHome.toString());
        Files.createDirectories(tempHome.resolve(".qwenmate"));
    }

    private String getCachedHomeDirectory() throws Exception {
        Field field = PlatformUtils.class.getDeclaredField("cachedRealHomeDir");
        field.setAccessible(true);
        return (String) field.get(null);
    }

    private void setCachedHomeDirectory(String homeDir) throws Exception {
        Field field = PlatformUtils.class.getDeclaredField("cachedRealHomeDir");
        field.setAccessible(true);
        field.set(null, homeDir);
    }
}
