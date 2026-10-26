package com.qwenmate.handler;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.handler.core.BaseMessageHandler;
import com.qwenmate.handler.core.HandlerContext;
import com.qwenmate.skill.CommandService;
import com.qwenmate.skill.SlashCommandRegistry;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * Custom command management message handler.
 * Lists ~/.qwen/commands and project .qwen/commands entries and opens them
 * in the IDE editor. Commands are plain Markdown files, so all editing is
 * delegated to the IDE editor rather than a webview form.
 */
public class CommandHandler extends BaseMessageHandler {

    private static final Logger LOG = Logger.getInstance(CommandHandler.class);
    private static final Gson GSON = new Gson();

    private static final String[] SUPPORTED_TYPES = {
        "get_all_commands",
        "open_command"
    };

    public CommandHandler(HandlerContext context) {
        super(context);
    }

    @Override
    public String[] getSupportedTypes() {
        return SUPPORTED_TYPES;
    }

    @Override
    public boolean handle(String type, String content) {
        switch (type) {
            case "get_all_commands":
                handleGetAllCommands();
                return true;
            case "open_command":
                handleOpenCommand(content);
                return true;
            default:
                return false;
        }
    }

    /**
     * Get all custom commands (global + local).
     */
    private void handleGetAllCommands() {
        try {
            String workspaceRoot = context.getProject().getBasePath();

            JsonObject commands = CommandService.getAllCommands(workspaceRoot);

            String commandsJson = GSON.toJson(commands);

            ApplicationManager.getApplication().invokeLater(() -> {
                callJavaScript("window.updateCommands", escapeJs(commandsJson));
            });
        } catch (Exception e) {
            LOG.error("[CommandHandler] Failed to get all commands: " + e.getMessage(), e);
            String fallbackJson = "{\"global\":{},\"local\":{}}";
            ApplicationManager.getApplication().invokeLater(() -> {
                callJavaScript("window.updateCommands", escapeJs(fallbackJson));
            });
        }
    }

    /**
     * Open a command file in the editor.
     */
    private void handleOpenCommand(String content) {
        try {
            JsonObject json = GSON.fromJson(content, JsonObject.class);
            String commandPath = json.get("path").getAsString();

            // Validate path: reject traversal sequences, null bytes, and paths outside commands directories
            if (commandPath.contains("..") || commandPath.contains("\0")) {
                LOG.warn("[CommandHandler] Rejected open request with suspicious path: " + commandPath);
                return;
            }
            if (!isInsideCommandsDirectory(commandPath)) {
                LOG.warn("[CommandHandler] Rejected open request for path outside commands directories");
                return;
            }

            EditorFileOpener.open(context.getProject(), commandPath);
        } catch (Exception e) {
            LOG.error("[CommandHandler] Failed to open command: " + e.getMessage(), e);
        }
    }

    /**
     * Check if a path is inside any legitimate commands directory
     * (user-level or any project-level directory discovered by the upward scan).
     */
    private boolean isInsideCommandsDirectory(String path) {
        try {
            Path normalized = Paths.get(path).toAbsolutePath().normalize();
            String userHome = NodeDetector.resolveHomeForFileOps();
            String projectBase = context.getProject().getBasePath();

            List<Path> validBases = new ArrayList<>();
            if (userHome != null && !userHome.isEmpty()) {
                validBases.add(Paths.get(userHome, ".qwen", "commands"));
            }
            if (projectBase != null) {
                for (SlashCommandRegistry.SkillScanDir scanDir : SlashCommandRegistry.getCommandScanDirs(projectBase)) {
                    validBases.add(Paths.get(scanDir.path()));
                }
            }

            for (Path base : validBases) {
                if (normalized.startsWith(base.toAbsolutePath().normalize())) {
                    return true;
                }
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }
}
