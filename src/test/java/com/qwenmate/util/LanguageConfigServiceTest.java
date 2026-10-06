package com.qwenmate.util;

import com.qwenmate.settings.QwenMateSettingsService;
import com.google.gson.JsonObject;
import org.junit.Assert;
import org.junit.Test;

import java.io.IOException;

/**
 * Tests for the three-state language resolution:
 * manual language > explicit follow-IDE choice > product default (Chinese).
 */
public class LanguageConfigServiceTest {

    /**
     * In-memory stand-in: only the language storage methods are exercised,
     * so no config file is ever read or written.
     */
    private static class FakeSettings extends QwenMateSettingsService {
        private String stored;
        private boolean throwOnRead;

        FakeSettings(String stored) {
            this.stored = stored;
        }

        static FakeSettings throwing() {
            FakeSettings settings = new FakeSettings(null);
            settings.throwOnRead = true;
            return settings;
        }

        @Override
        public String getUserLanguage() throws IOException {
            if (throwOnRead) {
                throw new IOException("simulated read failure");
            }
            return stored;
        }

        @Override
        public void setUserLanguage(String language) {
            this.stored = language;
        }
    }

    @Test
    public void defaultsToChineseWhenNeverSet() {
        JsonObject config = LanguageConfigService.getLanguageConfig(new FakeSettings(null));

        Assert.assertEquals("default", config.get("source").getAsString());
        Assert.assertEquals("zh", config.get("language").getAsString());
    }

    @Test
    public void usesManualLanguageWhenStored() {
        JsonObject config = LanguageConfigService.getLanguageConfig(new FakeSettings("ja"));

        Assert.assertEquals("user", config.get("source").getAsString());
        Assert.assertEquals("ja", config.get("language").getAsString());
    }

    @Test
    public void followIdeaSentinelSelectsIdeaSource() {
        JsonObject config = LanguageConfigService.getLanguageConfig(new FakeSettings("idea"));

        Assert.assertEquals("idea", config.get("source").getAsString());
        String language = config.get("language").getAsString();
        Assert.assertFalse(language.isEmpty());
    }

    @Test
    public void unsupportedStoredValueFallsBackToDefault() {
        JsonObject config = LanguageConfigService.getLanguageConfig(new FakeSettings("xx"));

        Assert.assertEquals("default", config.get("source").getAsString());
        Assert.assertEquals("zh", config.get("language").getAsString());
    }

    @Test
    public void storageFailureFallsBackToDefault() {
        JsonObject config = LanguageConfigService.getLanguageConfig(FakeSettings.throwing());

        Assert.assertEquals("fallback", config.get("source").getAsString());
        Assert.assertEquals("zh", config.get("language").getAsString());
    }

    @Test
    public void setFollowIdeaLanguageStoresSentinel() throws IOException {
        FakeSettings settings = new FakeSettings("en");

        LanguageConfigService.setFollowIdeaLanguage(settings);

        Assert.assertEquals("idea", settings.stored);
        Assert.assertNull(LanguageConfigService.getUserLanguage(settings));
    }

    @Test
    public void getUserLanguageExcludesFollowIdeaSentinel() {
        Assert.assertNull(LanguageConfigService.getUserLanguage(new FakeSettings("idea")));
        Assert.assertEquals("en", LanguageConfigService.getUserLanguage(new FakeSettings("en")));
        Assert.assertNull(LanguageConfigService.getUserLanguage(new FakeSettings(null)));
    }
}
