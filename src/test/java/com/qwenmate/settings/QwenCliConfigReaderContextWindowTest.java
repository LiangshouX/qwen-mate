package com.qwenmate.settings;

import org.junit.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * Regression tests for reading {@code generationConfig.contextWindowSize}
 * from the Qwen Code CLI settings ({@code ~/.qwen/settings.json}).
 */
public class QwenCliConfigReaderContextWindowTest {

    @Test
    public void readsContextWindowSizeFromModelProviders() throws Exception {
        Path settings = Files.createTempFile("qwen-settings", ".json");
        Files.writeString(settings, """
                {
                  "modelProviders": {
                    "xiaomimimo": [
                      {
                        "id": "mimo-v2.5-pro",
                        "name": "mimo-v2.5-pro",
                        "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1",
                        "envKey": "MIMO_API_KEY",
                        "generationConfig": {
                          "contextWindowSize": 1000000,
                          "samplingParams": { "max_tokens": 131072 }
                        }
                      },
                      {
                        "id": "no-window-model",
                        "name": "no-window-model"
                      }
                    ]
                  }
                }
                """);
        QwenCliConfigReader.setSettingsPathOverrideForTests(settings);
        try {
            assertTrue(QwenCliConfigReader.findContextWindowSize("mimo-v2.5-pro").isPresent());
            assertEquals(1_000_000, QwenCliConfigReader.findContextWindowSize("mimo-v2.5-pro").getAsInt());
            assertFalse(QwenCliConfigReader.findContextWindowSize("no-window-model").isPresent());
            assertFalse(QwenCliConfigReader.findContextWindowSize("unknown-model").isPresent());
        } finally {
            QwenCliConfigReader.setSettingsPathOverrideForTests(null);
        }
    }

    @Test
    public void listModelOptionsExposesContextWindowSize() throws Exception {
        Path settings = Files.createTempFile("qwen-settings", ".json");
        Files.writeString(settings, """
                {
                  "modelProviders": {
                    "mimo": [
                      {
                        "id": "mimo-v2.5-pro",
                        "generationConfig": { "contextWindowSize": 1000000 }
                      }
                    ]
                  }
                }
                """);
        QwenCliConfigReader.setSettingsPathOverrideForTests(settings);
        try {
            var options = QwenCliConfigReader.listModelOptions();
            assertEquals(1, options.size());
            assertEquals(1_000_000,
                    options.get(0).getAsJsonObject().get("contextWindowSize").getAsInt());
        } finally {
            QwenCliConfigReader.setSettingsPathOverrideForTests(null);
        }
    }

    @Test
    public void missingSettingsYieldsEmptyContextWindow() {
        QwenCliConfigReader.setSettingsPathOverrideForTests(
                Path.of("does-not-exist", "settings.json"));
        try {
            assertFalse(QwenCliConfigReader.findContextWindowSize("any-model").isPresent());
        } finally {
            QwenCliConfigReader.setSettingsPathOverrideForTests(null);
        }
    }
}
