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

    // Built-in commands mirroring the Qwen Code CLI command surface
    // (docs: users/features/commands). Descriptions are the official English ones
    // so the palette matches the CLI. Commands that the plugin intercepts locally
    // (source "gui") are executed by the webview instead of the CLI.
    // The runtime list pushed by the CLI init message prunes entries that the
    // headless/SDK mode does not register; this table is the static fallback used
    // before the first turn and for commands the CLI does not report.
    public static final List<SlashCommand> QWEN_BUILTIN = List.of(
            // Session & project management
            new SlashCommand("/init", "Analyze the current directory and create an initial context file", "builtin"),
            new SlashCommand("/summary", "Generate a project summary from conversation history", "builtin"),
            new SlashCommand("/compress", "Replace chat history with a summary to save tokens", "builtin"),
            new SlashCommand("/compress-fast", "Strip old tool output and thinking to free context", "builtin"),
            new SlashCommand("/recap", "Generate a one-line summary of the current session", "builtin"),
            new SlashCommand("/restore", "Restore project files to a checkpoint", "builtin"),
            new SlashCommand("/delete", "Delete a previous session", "builtin"),
            new SlashCommand("/branch", "Branch the current conversation into a new session", "builtin"),
            new SlashCommand("/fork", "Spawn a background agent that inherits the full conversation", "builtin"),
            new SlashCommand("/rewind", "Rewind the conversation to an earlier turn", "builtin"),
            new SlashCommand("/export", "Export session history to a file", "builtin"),
            new SlashCommand("/rename", "Rename or tag the current session", "builtin"),
            // Handled by the plugin UI (history view / plan mode / context dialog)
            new SlashCommand("/resume", "Resume a previous conversation", "gui"),
            new SlashCommand("/continue", "Resume the most recent conversation", "gui"),
            new SlashCommand("/plan", "Toggle plan mode", "gui"),
            new SlashCommand("/context", "Show context window usage breakdown", "gui"),
            // Interface & workspace control
            new SlashCommand("/clear", "Clear conversation history and free context", "gui"),
            new SlashCommand("/history", "Control history display preferences", "builtin"),
            new SlashCommand("/diff", "Open the interactive diff viewer", "builtin"),
            new SlashCommand("/theme", "Change the visual theme", "builtin"),
            new SlashCommand("/vim", "Toggle Vim editing mode for the input area", "builtin"),
            new SlashCommand("/voice", "Toggle voice dictation", "builtin"),
            new SlashCommand("/directory", "Manage the multi-directory workspace", "builtin"),
            new SlashCommand("/cd", "Move the session to a new working directory", "builtin"),
            new SlashCommand("/editor", "Open a dialog to choose a supported editor", "builtin"),
            new SlashCommand("/statusline", "Configure the status line", "builtin"),
            new SlashCommand("/terminal-setup", "Configure terminal multiline-input shortcuts", "builtin"),
            // Language
            new SlashCommand("/language", "View or change language settings", "builtin"),
            // Tools & model management
            new SlashCommand("/mcp", "List configured MCP servers and tools", "builtin"),
            new SlashCommand("/import-config", "Import MCP servers from Claude configuration", "builtin"),
            new SlashCommand("/tools", "Show the list of currently available tools", "builtin"),
            new SlashCommand("/skills", "Open the Skills panel to browse and start skills", "builtin"),
            new SlashCommand("/learn", "Create a reusable project skill from a file, URL or text", "builtin"),
            new SlashCommand("/curator", "Inspect, pin, archive, or restore inactive auto-skills", "builtin"),
            new SlashCommand("/approval-mode", "Change the tool approval mode", "builtin"),
            new SlashCommand("/peers", "View held peer messages and trusted controllers", "builtin"),
            new SlashCommand("/model", "Switch the session model", "builtin"),
            new SlashCommand("/effort", "Set reasoning effort for thinking models", "builtin"),
            new SlashCommand("/output-style", "Select an output style", "builtin"),
            new SlashCommand("/extensions", "Manage extensions", "builtin"),
            new SlashCommand("/memory", "Open the Memory Manager", "builtin"),
            new SlashCommand("/remember", "Save a persistent memory entry", "builtin"),
            new SlashCommand("/forget", "Remove matching entries from auto-memory", "builtin"),
            new SlashCommand("/dream", "Run auto-memory consolidation", "builtin"),
            new SlashCommand("/hooks", "Manage Qwen Code hooks", "builtin"),
            new SlashCommand("/reload-plugins", "Reload extension changes from disk", "builtin"),
            new SlashCommand("/permissions", "Manage permission rules", "builtin"),
            new SlashCommand("/agents", "Manage subagents", "builtin"),
            new SlashCommand("/arena", "Manage Arena sessions", "builtin"),
            new SlashCommand("/goal", "Keep working until a validator confirms the objective", "builtin"),
            new SlashCommand("/tasks", "List background tasks", "builtin"),
            new SlashCommand("/workflows", "Inspect workflow runs", "builtin"),
            new SlashCommand("/lsp", "Show LSP server status", "builtin"),
            new SlashCommand("/trust", "Manage folder trust settings", "builtin"),
            // Bundled skills (user-invocable, work in the GUI environment)
            new SlashCommand("/review", "Multi-agent code review", "bundled"),
            new SlashCommand("/coordinate", "Coordinate a read-only worker and a worktree writer", "bundled"),
            new SlashCommand("/loop", "Run a prompt on a recurring schedule", "bundled"),
            new SlashCommand("/goal-draft", "Turn a vague intent into a verifiable /goal objective", "bundled"),
            new SlashCommand("/simplify", "Review recent changes and apply safe cleanup edits", "bundled"),
            new SlashCommand("/qc-helper", "Answer questions about Qwen Code usage and configuration", "bundled"),
            new SlashCommand("/batch", "Execute batch operations on multiple files in parallel", "bundled"),
            // Side question & second opinion
            new SlashCommand("/btw", "Ask a quick side question without interrupting the conversation", "builtin"),
            new SlashCommand("/advisor", "Run an independent read-only review and return a second opinion", "builtin"),
            // Info, settings & help
            new SlashCommand("/help", "Show help for available commands", "builtin"),
            new SlashCommand("/status", "Show version info and paths", "builtin"),
            new SlashCommand("/stats", "Open the usage statistics dashboard", "builtin"),
            new SlashCommand("/settings", "Open the settings editor", "builtin"),
            new SlashCommand("/config", "Get or set any config value via dotted-path keys", "builtin"),
            new SlashCommand("/auth", "Change authentication method", "builtin"),
            new SlashCommand("/doctor", "Run installation and environment diagnostics", "builtin"),
            new SlashCommand("/docs", "Open the full Qwen Code documentation", "builtin"),
            new SlashCommand("/ide", "Manage IDE integration", "builtin"),
            new SlashCommand("/insight", "Generate programming insights from chat history", "builtin"),
            new SlashCommand("/setup-github", "Set up GitHub Actions", "builtin"),
            new SlashCommand("/bug", "File an issue about Qwen Code", "builtin"),
            new SlashCommand("/copy", "Copy reply, code, LaTeX or Mermaid to the clipboard", "builtin"),
            new SlashCommand("/quit", "Exit Qwen Code immediately", "builtin")
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
