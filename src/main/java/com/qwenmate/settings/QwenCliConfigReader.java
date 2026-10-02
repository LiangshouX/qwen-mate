package com.qwenmate.settings;

import com.qwenmate.bridge.NodeDetector;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.OptionalInt;

/**
 * Reads model options from the Qwen Code CLI configuration ({@code ~/.qwen/settings.json}).
 *
 * The GUI never overrides the CLI's own model configuration silently: when the
 * user picks "default" in the model selector, no model id is sent and the CLI
 * config decides. This reader exposes the configured model and the
 * {@code modelProviders} catalog so the GUI can list them.
 *
 * All parsing is tolerant — missing files, unknown shapes and dirty data
 * degrade to empty results instead of throwing.
 */
public final class QwenCliConfigReader {

    private static final Logger LOG = Logger.getInstance(QwenCliConfigReader.class);
    private static final String FALLBACK_CONFIGURED_MODEL_KEY = "model";

    /** Test-only override for the settings path; production always reads ~/.qwen/settings.json. */
    private static volatile Path settingsPathOverride;

    private QwenCliConfigReader() {
    }

    @org.jetbrains.annotations.TestOnly
    public static void setSettingsPathOverrideForTests(Path path) {
        settingsPathOverride = path;
    }

    /** Absolute path of the Qwen Code CLI settings file. */
    public static Path settingsPath() {
        Path override = settingsPathOverride;
        if (override != null) {
            return override;
        }
        return Paths.get(NodeDetector.resolveHomeForFileOps(), ".qwen", "settings.json");
    }

    /**
     * Read and parse {@code ~/.qwen/settings.json}, or {@code null} when the
     * file is missing or unparseable.
     */
    public static JsonObject readSettings() {
        Path path = settingsPath();
        if (!Files.exists(path)) {
            return null;
        }
        try {
            String json = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
            JsonElement parsed = JsonParser.parseString(json);
            return parsed != null && parsed.isJsonObject() ? parsed.getAsJsonObject() : null;
        } catch (IOException | RuntimeException e) {
            LOG.warn("[QwenCliConfigReader] Failed to read " + path + ": " + e.getMessage());
            return null;
        }
    }

    /**
     * The model currently configured by the CLI ({@code model.name} or a legacy
     * string {@code model}), or {@code ""} when unset.
     */
    public static String getConfiguredModelName() {
        JsonObject settings = readSettings();
        if (settings == null || !settings.has(FALLBACK_CONFIGURED_MODEL_KEY)) {
            return "";
        }
        try {
            JsonElement model = settings.get(FALLBACK_CONFIGURED_MODEL_KEY);
            if (model == null || model.isJsonNull()) {
                return "";
            }
            if (model.isJsonPrimitive()) {
                return model.getAsString().trim();
            }
            if (model.isJsonObject()) {
                JsonObject modelObj = model.getAsJsonObject();
                if (modelObj.has("name") && modelObj.get("name").isJsonPrimitive()) {
                    return modelObj.get("name").getAsString().trim();
                }
            }
        } catch (RuntimeException e) {
            LOG.debug("[QwenCliConfigReader] Unexpected model shape: " + e.getMessage());
        }
        return "";
    }

    /**
     * Model catalog declared under {@code modelProviders}: an object mapping
     * provider key → array of {@code {id, name, ...}} entries. Returns a flat
     * array of {@code {id, name, provider}}; never {@code null}.
     */
    public static JsonArray listModelOptions() {
        JsonArray result = new JsonArray();
        JsonObject settings = readSettings();
        if (settings == null || !settings.has("modelProviders") || !settings.get("modelProviders").isJsonObject()) {
            return result;
        }
        try {
            JsonObject providers = settings.getAsJsonObject("modelProviders");
            for (String providerKey : providers.keySet()) {
                JsonElement entries = providers.get(providerKey);
                if (entries == null || !entries.isJsonArray()) {
                    continue;
                }
                for (JsonElement entry : entries.getAsJsonArray()) {
                    if (entry == null || !entry.isJsonObject()) {
                        continue;
                    }
                    JsonObject entryObj = entry.getAsJsonObject();
                    String id = entryObj.has("id") && entryObj.get("id").isJsonPrimitive()
                            ? entryObj.get("id").getAsString().trim()
                            : "";
                    if (id.isEmpty()) {
                        continue;
                    }
                    String name = entryObj.has("name") && entryObj.get("name").isJsonPrimitive()
                            ? entryObj.get("name").getAsString().trim()
                            : id;
                    JsonObject item = new JsonObject();
                    item.addProperty("id", id);
                    item.addProperty("name", name);
                    item.addProperty("provider", providerKey);
                    Integer contextWindowSize = readContextWindowSize(entryObj);
                    if (contextWindowSize != null) {
                        item.addProperty("contextWindowSize", contextWindowSize);
                    }
                    result.add(item);
                }
            }
        } catch (RuntimeException e) {
            LOG.warn("[QwenCliConfigReader] Failed to parse modelProviders: " + e.getMessage());
        }
        return result;
    }

    /**
     * Context window of the given model as declared by the CLI config
     * ({@code modelProviders[].generationConfig.contextWindowSize}), or empty
     * when the model is unknown or declares no window.
     */
    public static OptionalInt findContextWindowSize(String modelId) {
        if (modelId == null || modelId.trim().isEmpty()) {
            return OptionalInt.empty();
        }
        String wanted = modelId.trim();
        for (com.google.gson.JsonElement entry : listModelOptions()) {
            JsonObject item = entry.getAsJsonObject();
            if (wanted.equals(item.get("id").getAsString())
                    && item.has("contextWindowSize")) {
                return OptionalInt.of(item.get("contextWindowSize").getAsInt());
            }
        }
        return OptionalInt.empty();
    }

    /**
     * Read {@code generationConfig.contextWindowSize} from a modelProviders entry.
     * Returns {@code null} when absent or not a positive integer.
     */
    private static Integer readContextWindowSize(JsonObject entryObj) {
        try {
            if (!entryObj.has("generationConfig") || !entryObj.get("generationConfig").isJsonObject()) {
                return null;
            }
            JsonObject generationConfig = entryObj.getAsJsonObject("generationConfig");
            if (!generationConfig.has("contextWindowSize")
                    || !generationConfig.get("contextWindowSize").isJsonPrimitive()) {
                return null;
            }
            int value = generationConfig.get("contextWindowSize").getAsInt();
            return value > 0 ? value : null;
        } catch (RuntimeException e) {
            LOG.debug("[QwenCliConfigReader] Ignoring malformed contextWindowSize: " + e.getMessage());
            return null;
        }
    }
}
