package com.qwenmate.skill;

import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;
import com.qwenmate.bridge.NodeDetector;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * Scans Qwen Code custom command directories (~/.qwen/commands, project
 * .qwen/commands) and builds the JSON payload for the command management UI.
 * Reuses {@link SlashCommandRegistry} scanning so the management list always
 * matches what the slash palette shows.
 */
public final class CommandService {

    private static final Logger LOG = Logger.getInstance(CommandService.class);

    private CommandService() {
    }

    /**
     * Gets all custom commands (global + local), including nested namespaces.
     */
    public static JsonObject getAllCommands(String workspaceRoot) {
        String home = NodeDetector.resolveHomeForFileOps();
        return getAllCommands(workspaceRoot, home != null ? home : "");
    }

    /**
     * Gets all custom commands with an explicit home path (test hook).
     */
    static JsonObject getAllCommands(String workspaceRoot, String userHome) {
        JsonObject result = new JsonObject();
        result.add("global", scanScope("global", globalCommandDirs(userHome)));
        result.add("local", scanScope("local", localCommandDirs(workspaceRoot, userHome)));
        return result;
    }

    private static List<SlashCommandRegistry.SkillScanDir> globalCommandDirs(String userHome) {
        if (userHome == null || userHome.isEmpty()) {
            return List.of();
        }
        return SlashCommandRegistry.getGlobalSkillScanDirs(userHome, "commands");
    }

    private static List<SlashCommandRegistry.SkillScanDir> localCommandDirs(String workspaceRoot, String userHome) {
        if (workspaceRoot == null || workspaceRoot.isEmpty()) {
            return List.of();
        }
        return SlashCommandRegistry.getSkillScanDirs(workspaceRoot, "commands", userHome);
    }

    private static JsonObject scanScope(String scope, List<SlashCommandRegistry.SkillScanDir> dirs) {
        JsonObject commands = new JsonObject();
        List<SlashCommandRegistry.CommandFile> files = new ArrayList<>();
        for (SlashCommandRegistry.SkillScanDir dir : dirs) {
            files.addAll(SlashCommandRegistry.scanCommandFiles(dir.path(), scope));
        }
        files.sort(Comparator.comparing(SlashCommandRegistry.CommandFile::name));

        for (SlashCommandRegistry.CommandFile file : files) {
            JsonObject entry = new JsonObject();
            String id = scope + ":" + file.path();
            entry.addProperty("id", id);
            entry.addProperty("name", file.name());
            entry.addProperty("scope", scope);
            entry.addProperty("path", file.path());
            entry.addProperty("description", file.description());
            entry.add("frontmatter", frontmatterToJson(file.frontmatter()));
            commands.add(id, entry);
        }

        LOG.info("[Commands] Found " + commands.size() + " commands (scope=" + scope + ")");
        return commands;
    }

    private static JsonObject frontmatterToJson(Map<String, Object> frontmatter) {
        JsonObject json = new JsonObject();
        for (Map.Entry<String, Object> entry : frontmatter.entrySet()) {
            json.addProperty(entry.getKey(), stringifyValue(entry.getValue()));
        }
        return json;
    }

    private static String stringifyValue(Object value) {
        if (value == null) {
            return "";
        }
        if (value instanceof List<?> list) {
            List<String> items = new ArrayList<>();
            for (Object item : list) {
                items.add(String.valueOf(item));
            }
            return String.join(", ", items);
        }
        return String.valueOf(value);
    }
}
