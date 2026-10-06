package com.qwenmate.skill;

import com.qwenmate.bridge.NodeDetector;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Merges built-in slash commands with skill-derived commands per provider.
 * Produces a deduplicated command list in the same JSON format as the SDK.
 */
public final class SlashCommandRegistry {

    private static final Logger LOG = Logger.getInstance(SlashCommandRegistry.class);

    private SlashCommandRegistry() {
    }

    /**
     * A slash command with name (including / prefix), description, and source.
     */
    public record SlashCommand(String name, String description, String source) {
    }

    /**
     * Represents a directory to scan for skills or commands, with its scope.
     */
    public record SkillScanDir(String path, String scope) {
    }

    // Built-in commands (GUI-relevant only; CLI-only and frontend-local ones are excluded)
    // Includes commands that work via SDK or are handled by frontend locally
    // 'local-jsx' commands (TUI UI) that have GUI equivalents are included
    // Bundled skills from CLI that are userInvocable and work in GUI environment
    public static final List<SlashCommand> QWEN_BUILTIN = List.of(
            new SlashCommand("/compact", "Summarize conversation to free context", "builtin"),
            new SlashCommand("/context", "Visualize current context usage as a colored grid", "builtin"),
            new SlashCommand("/goal", "Keep working across turns until the goal condition is met", "builtin"),
            new SlashCommand("/init", "Initialize a new QWEN.md file with codebase documentation", "builtin"),
            new SlashCommand("/mcp", "List configured MCP servers and their connection status", "builtin"),
            new SlashCommand("/plan", "Switch to plan mode", "builtin"),
            new SlashCommand("/resume", "Resume a previous conversation", "builtin"),
            new SlashCommand("/review", "Review a pull request", "builtin"),
            // Bundled skills (userInvocable, no ANT-only restriction)
            new SlashCommand("/batch", "Execute large-scale changes in parallel across isolated worktrees", "bundled"),
            new SlashCommand("/debug", "Enable debug logging and diagnose session issues", "bundled"),
            new SlashCommand("/loop", "Run a prompt or command on a recurring interval", "bundled"),
            new SlashCommand("/simplify", "Review changed code for reuse, quality, and efficiency", "bundled"),
            new SlashCommand("/update-config", "Configure settings.json (hooks, permissions, env vars)", "bundled")
    );

    /**
     * Gets the list of directories to scan for skills or commands.
     * Scans from CWD upward to home directory.
     */
    public static List<SkillScanDir> getSkillScanDirs(String cwd, String type) {
        return getSkillScanDirs(cwd, type, resolveUserHome());
    }

    /**
     * Gets the list of directories to scan for skills or commands with explicit home path.
     */
    static List<SkillScanDir> getSkillScanDirs(String cwd, String type, String userHome) {
        return AdditionalDirectoryResolver.getSkillScanDirs(cwd, type, userHome);
    }

    /**
     * Gets the user-level (global) scan directories for skills or commands
     * (~/.qwen/commands, ~/.qwen/skills).
     */
    static List<SkillScanDir> getGlobalSkillScanDirs(String userHome, String type) {
        return List.of(new SkillScanDir(userHome + File.separator + ".qwen" + File.separator + type, "user"));
    }

    public static List<SkillScanDir> getCommandScanDirs(String cwd) {
        return getSkillScanDirs(cwd, "commands");
    }

    public static List<SkillScanDir> getSkillsScanDirs(String cwd) {
        return getSkillScanDirs(cwd, "skills");
    }

    /**
     * Matches current file against conditional path patterns.
     */
    public static boolean matchesPathPatterns(Path currentFile, List<String> patterns) {
        return SlashCommandPathPolicy.matchesPathPatterns(currentFile, patterns);
    }

    /**
     * Gets the merged slash command list for a given provider and working directory.
     */
    public static List<SlashCommand> getCommands(String provider, String cwd) {
        return getCommands(provider, cwd, null);
    }

    /**
     * Gets the merged slash command list for a given provider and working directory.
     */
    public static List<SlashCommand> getCommands(String provider, String cwd, String currentFilePath) {
        return getCommands(provider, cwd, currentFilePath, resolveUserHome());
    }

    /**
     * Gets the merged slash command list with an explicit home path (test hook).
     */
    static List<SlashCommand> getCommands(String provider, String cwd, String currentFilePath, String userHome) {
        List<SlashCommand> builtins = QWEN_BUILTIN;
        Path currentFile = SlashCommandPathPolicy.toNormalizedPath(currentFilePath);

        List<SlashCommand> globalCmdCommands;
        List<SlashCommand> globalSkillCommands;
        List<SlashCommand> localCmdCommands = List.of();
        List<SlashCommand> localSkillCommands = List.of();

        if (userHome == null || userHome.isEmpty()) {
            globalCmdCommands = List.of();
            globalSkillCommands = List.of();
        } else {
            globalCmdCommands = scanCommandsFromDirs(
                    getGlobalSkillScanDirs(userHome, "commands"), "user");
            globalSkillCommands = scanSkillsFromDirs(
                    getGlobalSkillScanDirs(userHome, "skills"), "user", null, currentFile);
        }

        if (cwd != null && !cwd.isEmpty()) {
            List<SkillScanDir> cmdDirs = getCommandScanDirs(cwd);
            List<SkillScanDir> skillDirs = getSkillsScanDirs(cwd);

            localCmdCommands = scanCommandsFromDirs(cmdDirs, "local");
            localSkillCommands = scanSkillsFromDirs(skillDirs, "local", null, currentFile);
        }

        return mergeCommandsInOrder(
                builtins,
                localCmdCommands,
                localSkillCommands,
                globalCmdCommands,
                globalSkillCommands
        );
    }

    /**
     * Serializes a command list to JSON array format.
     */
    public static String toJson(List<SlashCommand> commands) {
        JsonArray array = new JsonArray();
        for (SlashCommand cmd : commands) {
            JsonObject obj = new JsonObject();
            obj.addProperty("name", cmd.name());
            obj.addProperty("description", cmd.description());
            if (cmd.source() != null && !cmd.source().isEmpty()) {
                obj.addProperty("source", cmd.source());
            }
            array.add(obj);
        }
        return new Gson().toJson(array);
    }

    /**
     * Scans multiple skill directories and returns aggregated slash commands.
     * Child directories keep precedence over parent directories.
     */
    private static List<SlashCommand> scanSkillsFromDirs(
            List<SkillScanDir> scanDirs,
            String source,
            String namespacePrefix,
            Path currentFilePath
    ) {
        Map<String, SlashCommand> merged = new LinkedHashMap<>();
        for (SkillScanDir scanDir : scanDirs) {
            List<SlashCommand> commands = scanSkillsAsCommands(
                    scanDir.path(), source, namespacePrefix, currentFilePath);
            for (SlashCommand cmd : commands) {
                merged.putIfAbsent(cmd.name(), cmd);
            }
        }
        return new ArrayList<>(merged.values());
    }

    /**
     * Scans multiple command directories and returns aggregated slash commands.
     * Child directories keep precedence over parent directories.
     */
    private static List<SlashCommand> scanCommandsFromDirs(List<SkillScanDir> scanDirs, String source) {
        Map<String, SlashCommand> merged = new LinkedHashMap<>();
        for (SkillScanDir scanDir : scanDirs) {
            List<SlashCommand> commands = scanCommandsAsCommands(scanDir.path(), source);
            for (SlashCommand cmd : commands) {
                merged.putIfAbsent(cmd.name(), cmd);
            }
        }
        return new ArrayList<>(merged.values());
    }

    /**
     * Scans a skills directory for valid skill subdirectories and converts them to slash commands.
     * Skips plain files and hidden directories.
     */
    static List<SlashCommand> scanSkillsAsCommands(
            String dirPath,
            String source,
            String namespacePrefix,
            Path currentFilePath
    ) {
        if (dirPath == null || dirPath.isEmpty()) {
            return List.of();
        }
        File dir = new File(dirPath);
        if (!dir.isDirectory()) {
            return List.of();
        }

        File[] entries = dir.listFiles();
        if (entries == null) {
            return List.of();
        }

        List<SlashCommand> commands = new ArrayList<>();
        for (File entry : entries) {
            if (!entry.isDirectory() || entry.getName().startsWith(".")) {
                continue;
            }

            SkillFrontmatterParser.SkillMetadata metadata =
                    SkillFrontmatterParser.parse(entry.toPath());
            if (metadata == null) {
                LOG.debug("Skipping skill directory with invalid metadata: " + entry.getName());
                continue;
            }

            if (!metadata.userInvocable()) {
                continue;
            }

            if (!ConditionalSkillFilter.filter(metadata, currentFilePath)) {
                continue;
            }

            String commandName = namespacePrefix != null && !namespacePrefix.isEmpty()
                    ? "/" + namespacePrefix + ":" + metadata.name()
                    : "/" + metadata.name();

            commands.add(new SlashCommand(commandName, metadata.description(), source));
        }
        return commands;
    }

    /**
     * Scans a commands directory recursively for .md files and converts them to slash commands.
     */
    static List<SlashCommand> scanCommandsAsCommands(String dirPath, String source) {
        if (dirPath == null || dirPath.isEmpty()) {
            return List.of();
        }
        Path baseDir = Paths.get(dirPath).toAbsolutePath().normalize();
        if (!Files.isDirectory(baseDir)) {
            return List.of();
        }

        List<SlashCommand> commands = new ArrayList<>();
        scanCommandsRecursive(baseDir.toFile(), baseDir, source, commands, 0);
        return commands;
    }

    // Max recursion depth for command directory scanning to prevent runaway traversal.
    private static final int MAX_COMMAND_SCAN_DEPTH = 10;

    /**
     * Recursively scans a directory for command .md files.
     */
    private static void scanCommandsRecursive(
            File dir,
            Path baseDir,
            String source,
            List<SlashCommand> commands,
            int depth
    ) {
        if (depth > MAX_COMMAND_SCAN_DEPTH) {
            LOG.warn("Max command scan depth exceeded, skipping: " + dir);
            return;
        }
        File[] entries = dir.listFiles();
        if (entries == null) {
            return;
        }

        boolean hasSkillMd = false;
        for (File entry : entries) {
            if (entry.isFile() && "skill.md".equalsIgnoreCase(entry.getName())) {
                hasSkillMd = true;
                break;
            }
        }

        for (File entry : entries) {
            if (entry.getName().startsWith(".")) {
                continue;
            }

            if (entry.isFile() && entry.getName().toLowerCase().endsWith(".md")) {
                String namespace = deriveCommandNamespace(entry, baseDir);
                SlashCommand cmd = parseCommandFile(entry, namespace, source);
                if (cmd != null) {
                    commands.add(cmd);
                }
            } else if (entry.isDirectory() && !hasSkillMd) {
                scanCommandsRecursive(entry, baseDir, source, commands, depth + 1);
            }
        }
    }

    /**
     * Derives the colon-separated namespace from a command file's relative path.
     */
    private static String deriveCommandNamespace(File mdFile, Path baseDir) {
        Path parent = mdFile.getParentFile().toPath().toAbsolutePath().normalize();
        Path base = baseDir.toAbsolutePath().normalize();
        if (parent.equals(base)) {
            return null;
        }
        Path relative = base.relativize(parent);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < relative.getNameCount(); i++) {
            if (i > 0) {
                sb.append(':');
            }
            sb.append(relative.getName(i));
        }
        return !sb.isEmpty() ? sb.toString() : null;
    }

    /**
     * Parses a single command .md file to extract name and description from frontmatter.
     */
    private static SlashCommand parseCommandFile(File mdFile, String namespace, String source) {
        String baseName = mdFile.getName().replaceFirst("\\.md$", "");
        String commandName = namespace != null
                ? "/" + namespace + ":" + baseName
                : "/" + baseName;

        String description = SlashCommandJsonReader.extractCommandDescription(mdFile.toPath());
        if (description == null) {
            description = "";
        }

        return new SlashCommand(commandName, description, source);
    }

    private static String resolveUserHome() {
        String home = NodeDetector.resolveHomeForFileOps();
        return home != null ? home : "";
    }

    @SafeVarargs
    static List<SlashCommand> mergeCommandsInOrder(List<SlashCommand>... commandSources) {
        Map<String, SlashCommand> merged = new LinkedHashMap<>();
        for (List<SlashCommand> source : commandSources) {
            if (source == null) {
                continue;
            }
            for (SlashCommand cmd : source) {
                merged.put(cmd.name(), cmd);
            }
        }
        return new ArrayList<>(merged.values());
    }
}
