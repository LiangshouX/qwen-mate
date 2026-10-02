package com.qwenmate.settings;

import com.google.gson.Gson;

import java.io.IOException;
import java.nio.file.Path;

/**
 * Global Prompt Manager.
 * Manages prompts stored in the user's home directory (~/.qwenmate/prompt.json).
 * These prompts are available across all projects for the user.
 */
public class GlobalPromptManager extends AbstractPromptManager {
    private final ConfigPathManager pathManager;

    /**
     * Constructor for GlobalPromptManager.
     * @param gson Gson instance for JSON serialization/deserialization
     * @param pathManager ConfigPathManager for managing configuration paths
     */
    public GlobalPromptManager(Gson gson, ConfigPathManager pathManager) {
        super(gson);
        this.pathManager = pathManager;
    }

    /**
     * Get the storage path for global prompts.
     * @return Path to ~/.qwenmate/prompt.json
     */
    @Override
    protected Path getStoragePath() {
        return pathManager.getPromptFilePath();
    }

    /**
     * Ensure the storage directory exists.
     * Creates ~/.qwenmate directory if it doesn't exist.
     */
    @Override
    protected void ensureStorageDirectory() throws IOException {
        pathManager.ensureConfigDirectory();
    }
}
