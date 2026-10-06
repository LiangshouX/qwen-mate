package com.qwenmate.util;

import com.qwenmate.settings.QwenMateSettingsService;
import com.google.gson.JsonObject;
import com.intellij.DynamicBundle;
import com.intellij.openapi.diagnostic.Logger;

import java.io.IOException;
import java.util.Locale;
import java.util.Set;

/**
 * Language configuration service.
 * Resolves the UI language from the persisted preference, with three states:
 * a manually chosen language, an explicit "follow IDEA language" choice, and
 * the never-set state, which defaults to Chinese.
 */
public class LanguageConfigService {

    private static final Logger LOG = Logger.getInstance(LanguageConfigService.class);
    private static final Set<String> SUPPORTED_LANGUAGES = Set.of(
            "zh", "en", "zh-TW", "hi", "es", "fr", "ja", "ru", "ko", "pt-BR"
    );

    /** Stored config value meaning "follow the IDE language" (not a language code). */
    public static final String FOLLOW_IDEA_LANGUAGE = "idea";
    /** Product default language used when the user has never chosen one. */
    public static final String DEFAULT_LANGUAGE = "zh";

    /**
     * Map IDEA locale codes to i18n-supported language codes.
     * IDEA locale format: zh_CN, en, ja, ko, etc.
     * Supported i18n languages: zh, en, zh-TW, hi, es, fr, ja, ru, ko, pt-BR
     *
     * @param ideaLocale the IDEA Locale
     * @return the i18n language code
     */
    private static String mapIdeaLocaleToI18n(Locale ideaLocale) {
        if (ideaLocale == null) {
            return "en";  // default to English
        }

        String language = ideaLocale.getLanguage();
        String country = ideaLocale.getCountry();

        // Special handling for Chinese: distinguish Simplified and Traditional
        if ("zh".equals(language)) {
            if ("TW".equals(country) || "HK".equals(country)) {
                return "zh-TW";  // Traditional Chinese
            }
            return "zh";  // Simplified Chinese
        }

        // Direct mapping for other languages
        switch (language) {
            case "en":
                return "en";
            case "hi":
                return "hi";
            case "es":
                return "es";
            case "fr":
                return "fr";
            case "ja":
                return "ja";
            case "ru":
                return "ru";
            case "ko":
                return "ko";
            case "pt":
                return "pt-BR";  // Portuguese -> Brazilian Portuguese
            default:
                // Unsupported language, fall back to English
                LOG.info("[LanguageConfig] Unsupported language '" + language + "', falling back to English");
                return "en";
        }
    }

    /**
     * Get user's manually set language preference.
     *
     * @return the user's language preference, or null if not manually set
     */
    public static String getUserLanguage(QwenMateSettingsService settingsService) {
        if (settingsService == null) {
            return null;
        }
        try {
            String userLanguage = settingsService.getUserLanguage();
            if (userLanguage == null || userLanguage.isEmpty()) {
                return null;
            }
            if (FOLLOW_IDEA_LANGUAGE.equals(userLanguage)) {
                // Follow-IDE mode is not a manually chosen language.
                return null;
            }
            if (!SUPPORTED_LANGUAGES.contains(userLanguage)) {
                LOG.warn("[LanguageConfig] Ignoring unsupported user language in ~/.qwenmate/config.json: " + userLanguage);
                return null;
            }
            LOG.info("[LanguageConfig] User manually set language: " + userLanguage);
            return userLanguage;
        } catch (Exception e) {
            LOG.warn("[LanguageConfig] Failed to read user language from ~/.qwenmate/config.json: " + e.getMessage());
            return null;
        }
    }

    /**
     * Set user's manual language preference.
     *
     * @param language the language code to save
     */
    public static void setUserLanguage(QwenMateSettingsService settingsService, String language) throws IOException {
        if (settingsService == null) {
            throw new IllegalArgumentException("settingsService must not be null");
        }
        if (language == null || !SUPPORTED_LANGUAGES.contains(language.trim())) {
            throw new IllegalArgumentException("Unsupported language: " + language);
        }
        settingsService.setUserLanguage(language.trim());
        LOG.info("[LanguageConfig] Saved user language preference: " + language);
    }

    /**
     * Switch to follow-IDE-language mode by storing the {@link #FOLLOW_IDEA_LANGUAGE}
     * sentinel. Distinct from the never-set state, which defaults to Chinese.
     */
    public static void setFollowIdeaLanguage(QwenMateSettingsService settingsService) throws IOException {
        if (settingsService == null) {
            throw new IllegalArgumentException("settingsService must not be null");
        }
        settingsService.setUserLanguage(FOLLOW_IDEA_LANGUAGE);
        LOG.info("[LanguageConfig] Language mode set to follow IDEA language");
    }

    /**
     * Get the current language configuration.
     * Resolution: manual language > explicit follow-IDE choice > product default (Chinese).
     *
     * @return a JsonObject containing the language configuration
     */
    public static JsonObject getLanguageConfig(QwenMateSettingsService settingsService) {
        JsonObject config = new JsonObject();

        try {
            String stored = settingsService != null ? settingsService.getUserLanguage() : null;

            if (stored != null && SUPPORTED_LANGUAGES.contains(stored)) {
                // A manually chosen language always wins.
                config.addProperty("language", stored);
                config.addProperty("source", "user");
                config.addProperty("ideaLocale", "");

                LOG.info("[LanguageConfig] Using user's manual language: " + stored);
            } else if (FOLLOW_IDEA_LANGUAGE.equals(stored)) {
                // Explicit follow-IDE choice.
                Locale currentLocale = DynamicBundle.getLocale();
                String i18nLanguage = mapIdeaLocaleToI18n(currentLocale);

                config.addProperty("language", i18nLanguage);
                config.addProperty("source", "idea");
                config.addProperty("ideaLocale", currentLocale.toString());

                LOG.info("[LanguageConfig] Using IDEA language config: ideaLocale=" + currentLocale
                        + ", i18nLanguage=" + i18nLanguage);
            } else {
                // Never set (or an unsupported stored value): product default.
                if (stored != null && !stored.isEmpty()) {
                    LOG.warn("[LanguageConfig] Ignoring unsupported user language in ~/.qwenmate/config.json: " + stored);
                }
                config.addProperty("language", DEFAULT_LANGUAGE);
                config.addProperty("source", "default");
                config.addProperty("ideaLocale", "");

                LOG.info("[LanguageConfig] No stored preference, using product default: " + DEFAULT_LANGUAGE);
            }

        } catch (Exception e) {
            // Fall back to the product default on exception
            config.addProperty("language", DEFAULT_LANGUAGE);
            config.addProperty("source", "fallback");
            config.addProperty("ideaLocale", "");
            LOG.warn("[LanguageConfig] Failed to get language config, using default (" + DEFAULT_LANGUAGE + "): " + e.getMessage());
        }

        return config;
    }

    /**
     * Get the language configuration as a JSON string.
     *
     * @return the JSON string
     */
    public static String getLanguageConfigJson(QwenMateSettingsService settingsService) {
        return getLanguageConfig(settingsService).toString();
    }
}
