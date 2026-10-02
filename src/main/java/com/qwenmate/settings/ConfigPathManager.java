package com.qwenmate.settings;

import com.qwenmate.bridge.NodeDetector;
import com.intellij.openapi.diagnostic.Logger;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Configuration Path Manager.
 * Manages paths for all configuration files.
 */
public class ConfigPathManager {
    private static final Logger LOG = Logger.getInstance(ConfigPathManager.class);

    private static final String CONFIG_DIR_NAME = ".qwenmate";
    private static final String CONFIG_FILE_NAME = "config.json";
    private static final String BACKUP_FILE_NAME = "config.json.bak";
    private static final String AGENT_FILE_NAME = "agent.json";
    private static final String PROMPT_FILE_NAME = "prompt.json";

    /**
     * Get the configuration file path (~/.qwenmate/config.json).
     */
    public String getConfigPath() {
        LegacyDataDirMigrator.migrateHomeOnce();
        String homeDir = NodeDetector.resolveHomeForFileOps();
        return Paths.get(homeDir, CONFIG_DIR_NAME, CONFIG_FILE_NAME).toString();
    }

    /**
     * Get the backup file path.
     */
    public String getBackupPath() {
        String homeDir = NodeDetector.resolveHomeForFileOps();
        return Paths.get(homeDir, CONFIG_DIR_NAME, BACKUP_FILE_NAME).toString();
    }

    /**
     * Get the configuration directory as a Path object.
     */
    public Path getConfigDir() {
        LegacyDataDirMigrator.migrateHomeOnce();
        String homeDir = NodeDetector.resolveHomeForFileOps();
        return Paths.get(homeDir, CONFIG_DIR_NAME);
    }

    /**
     * Get the configuration file as a Path object.
     */
    public Path getConfigFilePath() {
        return getConfigDir().resolve(CONFIG_FILE_NAME);
    }

    /**
     * Get the agent.json file path.
     */
    public Path getAgentFilePath() {
        return getConfigDir().resolve(AGENT_FILE_NAME);
    }

    /**
     * Get the prompt.json file path.
     */
    public Path getPromptFilePath() {
        return getConfigDir().resolve(PROMPT_FILE_NAME);
    }

    /**
     * Ensure the configuration directory exists.
     */
    public void ensureConfigDirectory() throws IOException {
        Path configDir = getConfigDir();
        if (!Files.exists(configDir)) {
            Files.createDirectories(configDir);
            LOG.info("[ConfigPathManager] Created config directory: " + configDir);
        }
    }
}
