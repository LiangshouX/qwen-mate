package com.qwenmate.settings;

import com.qwenmate.model.PromptScope;
import com.google.gson.Gson;
import com.intellij.openapi.project.Project;

/**
 * Factory class for creating appropriate PromptManager implementations based on scope.
 * This factory encapsulates the logic for instantiating the correct manager type
 * (GlobalPromptManager or ProjectPromptManager) based on the PromptScope parameter.
 */
public class PromptManagerFactory {

    /**
     * Create an AbstractPromptManager instance based on the specified scope.
     *
     * @param scope The scope determining which manager type to create (GLOBAL or PROJECT)
     * @param gson Gson instance for JSON serialization/deserialization
     * @param pathManager ConfigPathManager for managing configuration paths (required for GLOBAL scope)
     * @param project IntelliJ Project instance (required for PROJECT scope, can be null for GLOBAL scope)
     * @return An AbstractPromptManager instance (either GlobalPromptManager or ProjectPromptManager)
     * @throws IllegalArgumentException if scope is null, unknown, or if required parameters are missing for the scope
     */
    public static AbstractPromptManager create(
            PromptScope scope,
            Gson gson,
            ConfigPathManager pathManager,
            Project project
    ) {
        if (scope == null) {
            throw new IllegalArgumentException("Scope cannot be null");
        }

        switch (scope) {
            case GLOBAL:
                if (pathManager == null) {
                    throw new IllegalArgumentException("ConfigPathManager required for GLOBAL scope");
                }
                return new GlobalPromptManager(gson, pathManager);

            case PROJECT:
                if (project == null) {
                    throw new IllegalArgumentException("Project required for PROJECT scope");
                }
                return new ProjectPromptManager(gson, project);

            default:
                throw new IllegalArgumentException("Unknown scope: " + scope);
        }
    }
}
