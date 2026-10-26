package com.qwenmate.skill;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;
import org.snakeyaml.engine.v2.api.Load;
import org.snakeyaml.engine.v2.api.LoadSettings;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

final class SlashCommandJsonReader {

    private static final Logger LOG = Logger.getInstance(SlashCommandJsonReader.class);
    private static final long MAX_JSON_FILE_SIZE = 10 * 1024 * 1024;

    private SlashCommandJsonReader() {
    }

    static JsonObject readJsonObject(Path path) {
        if (path == null) {
            return null;
        }
        // Normalize so IntelliJ's MultiRoutingFileSystemProvider can resolve the path
        path = path.toAbsolutePath().normalize();

        if (!Files.isRegularFile(path)) {
            return null;
        }

        try {
            long size = Files.size(path);
            if (size > MAX_JSON_FILE_SIZE) {
                LOG.warn("JSON file too large, skipping: " + path + " (" + size + " bytes)");
                return null;
            }
        } catch (NoSuchFileException e) {
            return null;
        } catch (IOException e) {
            LOG.debug("Cannot check size for JSON file: " + path);
        }

        try (var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            JsonElement parsed = JsonParser.parseReader(reader);
            if (parsed != null && parsed.isJsonObject()) {
                return parsed.getAsJsonObject();
            }
        } catch (NoSuchFileException e) {
            // Expected when the file does not exist
        } catch (Exception e) {
            LOG.debug("Failed to read JSON: " + path);
        }

        return null;
    }

    /**
     * Parses a command file's YAML frontmatter into an ordered map.
     *
     * @return the frontmatter fields, or an empty map when absent/unparseable
     */
    static Map<String, Object> extractFrontmatterMap(Path mdPath) {
        String yamlText = SkillFrontmatterParser.extractFrontmatter(mdPath);
        if (yamlText == null) {
            return Map.of();
        }

        try {
            LoadSettings settings = LoadSettings.builder()
                    .setMaxAliasesForCollections(0)
                    .setCodePointLimit(8192)
                    .build();
            Load load = new Load(settings);
            Object parsed = load.loadFromString(yamlText);

            if (parsed instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> map = (Map<String, Object>) parsed;
                Map<String, Object> fields = new LinkedHashMap<>();
                for (Map.Entry<String, Object> entry : map.entrySet()) {
                    fields.put(String.valueOf(entry.getKey()), entry.getValue());
                }
                return fields;
            }
        } catch (Exception e) {
            LOG.debug("Failed to parse command frontmatter: " + mdPath);
        }
        return Map.of();
    }
}
