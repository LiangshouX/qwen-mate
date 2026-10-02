package com.qwenmate.settings;

import com.google.gson.Gson;
import com.intellij.openapi.project.Project;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Project Prompt Manager.
 * Manages prompts stored in the project directory (<project>/.qwenmate/prompt.json).
 * These prompts are specific to the current project.
 */
public class ProjectPromptManager extends AbstractPromptManager {
    private final Project project;

    /**
     * Constructor for ProjectPromptManager.
     * @param gson Gson instance for JSON serialization/deserialization
     * @param project IntelliJ Project instance for accessing project base path
     */
    public ProjectPromptManager(Gson gson, Project project) {
        super(gson);
        this.project = project;
    }

    /**
     * Get the storage path for project-specific prompts.
     * @return Path to <project>/.qwenmate/prompt.json
     * @throws IllegalStateException if project is not available or has no base path
     */
    @Override
    protected Path getStoragePath() throws IOException {
        if (project == null || project.getBasePath() == null) {
            throw new IllegalStateException("Project not available");
        }
        LegacyDataDirMigrator.migrateProjectOnce(project.getBasePath());
        return Paths.get(project.getBasePath(), ".qwenmate", "prompt.json");
    }

    /**
     * Ensure the storage directory exists.
     * Creates <project>/.qwenmate directory if it doesn't exist.
     * @throws IOException if directory creation fails
     */
    @Override
    protected void ensureStorageDirectory() throws IOException {
        Path dir = getStoragePath().getParent();
        Path filePath = getStoragePath();

        com.intellij.openapi.diagnostic.Logger LOG =
            com.intellij.openapi.diagnostic.Logger.getInstance(ProjectPromptManager.class);

        LOG.warn("[ProjectPromptManager] Ensuring directory exists: " + dir);
        LOG.warn("[ProjectPromptManager] Target file path: " + filePath);

        if (!Files.exists(dir)) {
            Files.createDirectories(dir);
            LOG.warn("[ProjectPromptManager] ✓ Created directory: " + dir);
        } else {
            LOG.warn("[ProjectPromptManager] Directory already exists: " + dir);
        }
    }
}
