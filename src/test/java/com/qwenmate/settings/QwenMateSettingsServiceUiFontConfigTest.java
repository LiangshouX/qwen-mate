package com.qwenmate.settings;

import com.qwenmate.util.PlatformUtils;
import com.google.gson.JsonObject;
import org.junit.After;
import org.junit.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.fail;

public class QwenMateSettingsServiceUiFontConfigTest {
    private String originalHomeDir;

    @After
    public void tearDown() throws Exception {
        if (originalHomeDir != null) {
            setCachedHomeDirectory(originalHomeDir);
            originalHomeDir = null;
        }
    }

    @Test
    public void shouldDefaultUiFontConfigToFollowEditor() throws Exception {
        Path tempHome = Files.createTempDirectory("ui-font-default-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();
        JsonObject config = invokeGetUiFontConfig(service);

        assertEquals("followEditor", config.get("mode").getAsString());
        assertFalse(config.has("presetId"));
        assertFalse(config.has("customFontPath"));
    }

    @Test
    public void shouldOnlyPersistFollowEditorAndCustomUiFontConfig() throws Exception {
        Path tempHome = Files.createTempDirectory("ui-font-roundtrip-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        invokeSetUiFontConfig(service, "preset", null);
        JsonObject normalizedLegacyPresetConfig = invokeGetUiFontConfig(service);
        assertEquals("followEditor", normalizedLegacyPresetConfig.get("mode").getAsString());
        assertFalse(normalizedLegacyPresetConfig.has("presetId"));
        assertFalse(normalizedLegacyPresetConfig.has("customFontPath"));

        invokeSetUiFontConfig(service, "customFile", "/tmp/custom-font.ttf");
        JsonObject customConfig = invokeGetUiFontConfig(service);
        assertEquals("customFile", customConfig.get("mode").getAsString());
        assertEquals("/tmp/custom-font.ttf", customConfig.get("customFontPath").getAsString());
        assertFalse(customConfig.has("presetId"));
    }

    @Test
    public void shouldDefaultCodeFontConfigToFollowEditor() throws Exception {
        Path tempHome = Files.createTempDirectory("code-font-default-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();
        JsonObject config = invokeGetCodeFontConfig(service);

        assertEquals("followEditor", config.get("mode").getAsString());
        assertFalse(config.has("presetId"));
        assertFalse(config.has("customFontPath"));
    }

    @Test
    public void shouldOnlyPersistFollowEditorAndCustomCodeFontConfig() throws Exception {
        Path tempHome = Files.createTempDirectory("code-font-roundtrip-home");
        useTemporaryHomeDirectory(tempHome);

        QwenMateSettingsService service = new QwenMateSettingsService();

        invokeSetCodeFontConfig(service, "preset", null);
        JsonObject normalizedLegacyPresetConfig = invokeGetCodeFontConfig(service);
        assertEquals("followEditor", normalizedLegacyPresetConfig.get("mode").getAsString());
        assertFalse(normalizedLegacyPresetConfig.has("presetId"));
        assertFalse(normalizedLegacyPresetConfig.has("customFontPath"));

        invokeSetCodeFontConfig(service, "customFile", "/tmp/custom-code-font.ttf");
        JsonObject customConfig = invokeGetCodeFontConfig(service);
        assertEquals("customFile", customConfig.get("mode").getAsString());
        assertEquals("/tmp/custom-code-font.ttf", customConfig.get("customFontPath").getAsString());
        assertFalse(customConfig.has("presetId"));
    }

    private JsonObject invokeGetUiFontConfig(QwenMateSettingsService service) throws Exception {
        Method method;
        try {
            method = QwenMateSettingsService.class.getMethod("getUiFontConfig");
        } catch (NoSuchMethodException e) {
            fail("QwenMateSettingsService should expose getUiFontConfig()");
            throw e;
        }
        return (JsonObject) method.invoke(service);
    }

    private void invokeSetUiFontConfig(QwenMateSettingsService service, String mode, String customFontPath)
            throws Exception {
        Method method;
        try {
            method = QwenMateSettingsService.class.getMethod(
                    "setUiFontConfig",
                    String.class,
                    String.class
            );
        } catch (NoSuchMethodException e) {
            fail("QwenMateSettingsService should expose setUiFontConfig(mode, customFontPath)");
            throw e;
        }
        method.invoke(service, mode, customFontPath);
    }

    private JsonObject invokeGetCodeFontConfig(QwenMateSettingsService service) throws Exception {
        Method method;
        try {
            method = QwenMateSettingsService.class.getMethod("getCodeFontConfig");
        } catch (NoSuchMethodException e) {
            fail("QwenMateSettingsService should expose getCodeFontConfig()");
            throw e;
        }
        return (JsonObject) method.invoke(service);
    }

    private void invokeSetCodeFontConfig(QwenMateSettingsService service, String mode, String customFontPath)
            throws Exception {
        Method method;
        try {
            method = QwenMateSettingsService.class.getMethod(
                    "setCodeFontConfig",
                    String.class,
                    String.class
            );
        } catch (NoSuchMethodException e) {
            fail("QwenMateSettingsService should expose setCodeFontConfig(mode, customFontPath)");
            throw e;
        }
        method.invoke(service, mode, customFontPath);
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
