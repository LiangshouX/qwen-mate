package com.qwenmate.settings;

import com.qwenmate.util.PlatformUtils;
import com.google.gson.JsonObject;
import org.junit.After;
import org.junit.Test;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class QwenMateSettingsServiceCommitAiConfigTest {
    private String originalHomeDir;

    @After
    public void tearDown() throws Exception {
        if (originalHomeDir != null) {
            setCachedHomeDirectory(originalHomeDir);
            originalHomeDir = null;
        }
    }

    @Test
    public void shouldDefaultToQwenModelWithAutoResolution() throws Exception {
        Path tempHome = Files.createTempDirectory("commit-ai-default-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        JsonObject config = service.getCommitAiConfig();

        assertTrue(config.get("provider").isJsonNull());
        // Empty model id = follow the Qwen CLI config
        assertEquals("", config.getAsJsonObject("models").get("qwen").getAsString());
        assertTrue(config.getAsJsonObject("availability").has("qwen"));
        assertAutoResolution(config, null);
    }

    @Test
    public void shouldPreferCurrentChatProviderInAutoModeWhenAvailable() throws Exception {
        Path tempHome = Files.createTempDirectory("commit-ai-prefer-chat-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        // Preferred provider is followed when its CLI is available, otherwise
        // resolution falls back to Qwen (availability depends on the machine).
        assertAutoResolution(service.getCommitAiConfig("qwen"), "qwen");
        // Unknown preferred provider is ignored -> plain Qwen fallback.
        assertAutoResolution(service.getCommitAiConfig("grok"), null);
    }

    @Test
    public void shouldPersistManualCommitAiProviderAndModels() throws Exception {
        Path tempHome = Files.createTempDirectory("commit-ai-manual-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        JsonObject models = new JsonObject();
        models.addProperty("qwen", "custom-qwen-model");
        service.setCommitAiConfig("qwen", models);

        JsonObject config = service.getCommitAiConfig();

        assertEquals("qwen", config.get("provider").getAsString());
        assertEquals("custom-qwen-model", config.getAsJsonObject("models").get("qwen").getAsString());
        if (config.getAsJsonObject("availability").get("qwen").getAsBoolean()) {
            assertEquals("manual", config.get("resolutionSource").getAsString());
            assertEquals("qwen", config.get("effectiveProvider").getAsString());
        } else {
            // Manual provider kept even when its CLI is not installed
            assertEquals("unavailable", config.get("resolutionSource").getAsString());
            assertTrue(config.get("effectiveProvider").isJsonNull());
        }
    }

    @Test
    public void shouldNotMutatePromptEnhancerConfigWhenSavingCommitAiConfig() throws Exception {
        Path tempHome = Files.createTempDirectory("commit-ai-isolated-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        JsonObject enhancerModels = new JsonObject();
        enhancerModels.addProperty("qwen", "enhancer-qwen-model");
        service.setPromptEnhancerConfig("qwen", enhancerModels);

        JsonObject commitModels = new JsonObject();
        commitModels.addProperty("qwen", "commit-qwen-model");
        service.setCommitAiConfig("qwen", commitModels);

        JsonObject promptEnhancerConfig = service.getPromptEnhancerConfig();
        JsonObject commitAiConfig = service.getCommitAiConfig();

        assertEquals("qwen", promptEnhancerConfig.get("provider").getAsString());
        assertEquals("enhancer-qwen-model", promptEnhancerConfig.getAsJsonObject("models").get("qwen").getAsString());

        assertEquals("qwen", commitAiConfig.get("provider").getAsString());
        assertEquals("commit-qwen-model", commitAiConfig.getAsJsonObject("models").get("qwen").getAsString());
    }

    /**
     * Asserts auto-mode resolution against the availability map reported in the
     * same response: preferred provider when available, otherwise Qwen.
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
