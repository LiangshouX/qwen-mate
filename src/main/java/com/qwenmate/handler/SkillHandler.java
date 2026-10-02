package com.qwenmate.handler;

import com.qwenmate.bridge.NodeDetector;
import com.qwenmate.handler.core.BaseMessageHandler;
import com.qwenmate.handler.core.HandlerContext;

import com.qwenmate.skill.SkillService;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ReadAction;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.util.concurrency.AppExecutorUtil;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Skill management message handler.
 */
public class SkillHandler extends BaseMessageHandler {

    private static final Logger LOG = Logger.getInstance(SkillHandler.class);
    private static final Gson GSON = new Gson();

    private static final String[] SUPPORTED_TYPES = {
        "get_all_skills",
        "import_skill",
        "delete_skill",
        "open_skill",
        "toggle_skill"
    };

    public SkillHandler(HandlerContext context) {
        super(context);
    }

    @Override
    public String[] getSupportedTypes() {
        return SUPPORTED_TYPES;
    }

    @Override
    public boolean handle(String type, String content) {
        switch (type) {
            case "get_all_skills":
                handleGetAllSkills();
                return true;
            case "import_skill":
                handleImportSkill(content);
                return true;
            case "delete_skill":
                handleDeleteSkill(content);
                return true;
            case "open_skill":
                handleOpenSkill(content);
                return true;
            case "toggle_skill":
                handleToggleSkill(content);
                return true;
            default:
                return false;
        }
    }

    /**
     * Get all skills.
     */
    private void handleGetAllSkills() {
        try {
            String workspaceRoot = context.getProject().getBasePath();

            JsonObject skills = SkillService.getAllSkills(workspaceRoot);

            String skillsJson = GSON.toJson(skills);

            ApplicationManager.getApplication().invokeLater(() -> {
                callJavaScript("window.updateSkills", escapeJs(skillsJson));
            });
        } catch (Exception e) {
            LOG.error("[SkillHandler] Failed to get all skills: " + e.getMessage(), e);
            String fallbackJson = "{\"global\":{},\"local\":{}}";
            ApplicationManager.getApplication().invokeLater(() -> {
                callJavaScript("window.updateSkills", escapeJs(fallbackJson));
            });
        }
    }

    /**
     * Import a skill (show file chooser dialog).
     */
    private void handleImportSkill(String content) {
        try {
            JsonObject json = GSON.fromJson(content, JsonObject.class);
            String scope = json.has("scope") ? json.get("scope").getAsString() : "global";

            ApplicationManager.getApplication().invokeLater(() -> {
                FileChooserDescriptor descriptor = new FileChooserDescriptor(
                    true,  // chooseFiles
                    true,  // chooseFolders
                    false, // chooseJars
                    false, // chooseJarsAsFiles
                    false, // chooseJarContents
                    true   // chooseMultiple
                );
                descriptor.setTitle("选择 Skill 文件或文件夹");

                // Set initial directory to project base path
                VirtualFile initialDir = null;
                String projectPath = context.getProject().getBasePath();
                if (projectPath != null) {
                    initialDir = LocalFileSystem.getInstance().findFileByPath(NodeDetector.toVfsPath(projectPath));
                }

                VirtualFile[] selectedFiles = FileChooser.chooseFiles(descriptor, context.getProject(), initialDir);
                if (selectedFiles.length > 0) {
                    List<String> paths = new ArrayList<>();
                    for (VirtualFile vf : selectedFiles) {
                        paths.add(vf.getPath());
                    }

                    CompletableFuture.runAsync(() -> {
                        try {
                            String workspaceRoot = context.getProject().getBasePath();
                            JsonObject importResult = SkillService.importSkills(paths, scope, workspaceRoot);
                            String resultJson = GSON.toJson(importResult);

                            ApplicationManager.getApplication().invokeLater(() -> {
                                callJavaScript("window.skillImportResult", escapeJs(resultJson));
                            });
                        } catch (Exception e) {
                            LOG.error("[SkillHandler] Import skill failed: " + e.getMessage(), e);
                            JsonObject errorResult = new JsonObject();
                            errorResult.addProperty("success", false);
                            errorResult.addProperty("error", e.getMessage());
                            ApplicationManager.getApplication().invokeLater(() -> {
                                callJavaScript("window.skillImportResult", escapeJs(GSON.toJson(errorResult)));
                            });
                        }
                    }, AppExecutorUtil.getAppExecutorService());
                }
            });
        } catch (Exception e) {
            LOG.error("[SkillHandler] Failed to handle import skill: " + e.getMessage(), e);
        }
    }

    /**
     * Delete a skill.
     */
    private void handleDeleteSkill(String content) {
        try {
            JsonObject json = GSON.fromJson(content, JsonObject.class);
            String skillName = json.get("name").getAsString();
            String scope = json.has("scope") ? json.get("scope").getAsString() : "global";
            boolean enabled = json.has("enabled") ? json.get("enabled").getAsBoolean() : true;
            String workspaceRoot = context.getProject().getBasePath();

            CompletableFuture.runAsync(() -> {
                try {
                    JsonObject result = SkillService.deleteSkill(skillName, scope, enabled, workspaceRoot);
                    String resultJson = GSON.toJson(result);

                    ApplicationManager.getApplication().invokeLater(() -> {
                        callJavaScript("window.skillDeleteResult", escapeJs(resultJson));
                    });
                } catch (Exception e) {
                    LOG.error("[SkillHandler] Delete skill failed: " + e.getMessage(), e);
                    JsonObject errorResult = new JsonObject();
                    errorResult.addProperty("success", false);
                    errorResult.addProperty("error", e.getMessage());
                    ApplicationManager.getApplication().invokeLater(() -> {
                        callJavaScript("window.skillDeleteResult", escapeJs(GSON.toJson(errorResult)));
                    });
                }
            }, AppExecutorUtil.getAppExecutorService());
        } catch (Exception e) {
            LOG.error("[SkillHandler] Failed to delete skill: " + e.getMessage(), e);
            JsonObject errorResult = new JsonObject();
            errorResult.addProperty("success", false);
            errorResult.addProperty("error", e.getMessage());
            ApplicationManager.getApplication().invokeLater(() -> {
                callJavaScript("window.skillDeleteResult", escapeJs(GSON.toJson(errorResult)));
            });
        }
    }

    /**
     * Enable/disable a skill.
     */
    private void handleToggleSkill(String content) {
        try {
            JsonObject json = GSON.fromJson(content, JsonObject.class);
            String skillName = json.get("name").getAsString();
            String skillId = json.has("id") ? json.get("id").getAsString() : null;
            String requestId = json.has("requestId") ? json.get("requestId").getAsString() : null;
            String scope = json.has("scope") ? json.get("scope").getAsString() : "global";
            boolean currentEnabled = json.has("enabled") ? json.get("enabled").getAsBoolean() : true;
            String workspaceRoot = context.getProject().getBasePath();

            CompletableFuture.runAsync(() -> {
                try {
                    JsonObject result = SkillService.toggleSkill(skillName, scope, currentEnabled, workspaceRoot);
                    attachToggleCorrelation(result, skillId, requestId, skillName);
                    String resultJson = GSON.toJson(result);

                    ApplicationManager.getApplication().invokeLater(() -> {
                        callJavaScript("window.skillToggleResult", escapeJs(resultJson));
                    });
                } catch (Exception e) {
                    LOG.error("[SkillHandler] Toggle skill failed: " + e.getMessage(), e);
                    JsonObject errorResult = new JsonObject();
                    errorResult.addProperty("success", false);
                    errorResult.addProperty("error", e.getMessage());
                    attachToggleCorrelation(errorResult, skillId, requestId, skillName);
                    ApplicationManager.getApplication().invokeLater(() -> {
                        callJavaScript("window.skillToggleResult", escapeJs(GSON.toJson(errorResult)));
                    });
                }
            }, AppExecutorUtil.getAppExecutorService());
        } catch (Exception e) {
            LOG.error("[SkillHandler] Failed to toggle skill: " + e.getMessage(), e);
            JsonObject errorResult = new JsonObject();
            errorResult.addProperty("success", false);
            errorResult.addProperty("error", e.getMessage());
            attachToggleCorrelationFromContent(errorResult, content);
            ApplicationManager.getApplication().invokeLater(() -> {
                callJavaScript("window.skillToggleResult", escapeJs(GSON.toJson(errorResult)));
            });
        }
    }

    private static void attachToggleCorrelation(
            JsonObject result,
            String skillId,
            String requestId,
            String skillName) {
        if (skillId != null && !skillId.isEmpty()) {
            result.addProperty("id", skillId);
        }
        if (requestId != null && !requestId.isEmpty()) {
            result.addProperty("requestId", requestId);
        }
        result.addProperty("name", skillName);
    }

    private static void attachToggleCorrelationFromContent(JsonObject result, String content) {
        try {
            JsonObject request = GSON.fromJson(content, JsonObject.class);
            String skillId = request.has("id") && request.get("id").isJsonPrimitive()
                    ? request.get("id").getAsString()
                    : null;
            String skillName = request.has("name") && request.get("name").isJsonPrimitive()
                    ? request.get("name").getAsString()
                    : null;
            String requestId = request.has("requestId") && request.get("requestId").isJsonPrimitive()
                    ? request.get("requestId").getAsString()
                    : null;
            attachToggleCorrelation(result, skillId, requestId, skillName);
        } catch (Exception ignored) {
            // Invalid requests cannot be correlated safely.
        }
    }

    /**
     * Check if a path is inside any legitimate skills directory.
     */
    private boolean isInsideSkillsDirectory(String path) {
        try {
            Path normalized = Paths.get(path).toAbsolutePath().normalize();
            String userHome = NodeDetector.resolveHomeForFileOps();
            String projectBase = context.getProject().getBasePath();

            // Qwen Code skills/commands directories
            List<Path> validBases = new ArrayList<>();
            validBases.add(Paths.get(userHome, ".qwen", "skills"));
            validBases.add(Paths.get(userHome, ".qwen", "commands"));
            validBases.add(Paths.get(userHome, ".qwenmate", "skills"));

            if (projectBase != null) {
                validBases.add(Paths.get(projectBase, ".qwen", "skills"));
                validBases.add(Paths.get(projectBase, ".qwen", "commands"));
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

    /**
     * Open a skill in the editor.
     */
    private void handleOpenSkill(String content) {
        try {
            JsonObject json = GSON.fromJson(content, JsonObject.class);
            String skillPath = json.get("path").getAsString();

            // Validate path: reject traversal sequences, null bytes, and paths outside skills directories
            if (skillPath.contains("..") || skillPath.contains("\0")) {
                LOG.warn("[SkillHandler] Rejected open request with suspicious path: " + skillPath);
                return;
            }
            if (!isInsideSkillsDirectory(skillPath)) {
                LOG.warn("[SkillHandler] Rejected open request for path outside skills directories");
                return;
            }

            File skillFile = new File(skillPath);
            String targetPath = skillPath;

            // If it's a directory, try opening skill.md or SKILL.md
            if (skillFile.isDirectory()) {
                File skillMd = new File(skillFile, "skill.md");
                if (!skillMd.exists()) {
                    skillMd = new File(skillFile, "SKILL.md");
                }
                if (skillMd.exists()) {
                    targetPath = skillMd.getAbsolutePath();
                }
            }

            final String fileToOpen = targetPath;

            // Use ReadAction.nonBlocking() to find the file in a background thread
            ReadAction
                .nonBlocking(() -> {
                    // Find the file in a background thread (this is a slow operation)
                    return LocalFileSystem.getInstance().findFileByPath(NodeDetector.toVfsPath(fileToOpen));
                })
                .finishOnUiThread(com.intellij.openapi.application.ModalityState.defaultModalityState(), virtualFile -> {
                    // Open the file on the UI thread
                    if (virtualFile != null) {
                        FileEditorManager.getInstance(context.getProject()).openFile(virtualFile, true);
                    } else {
                        LOG.error("[SkillHandler] Cannot find file: " + fileToOpen);
                    }
                })
                .submit(AppExecutorUtil.getAppExecutorService());

        } catch (Exception e) {
            LOG.error("[SkillHandler] Failed to open skill: " + e.getMessage(), e);
        }
    }
}
