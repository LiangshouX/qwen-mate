package com.qwenmate.settings;

import com.qwenmate.cli.CliStatusDetector;
import com.qwenmate.cli.CliToolStatus;
import com.qwenmate.util.FontConfigService;
import com.qwenmate.i18n.QwenMateBundle;
import com.qwenmate.model.ConflictStrategy;
import com.qwenmate.model.PromptScope;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;

import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.io.Writer;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * QwenMate configuration service (Facade pattern).
 * Delegates specific functionality to specialized managers.
 */
public class QwenMateSettingsService {

    private static final Logger LOG = Logger.getInstance(QwenMateSettingsService.class);
    private static final int CONFIG_VERSION = 2;
    private static final String UI_FONT_CONFIG_KEY = "uiFont";
    private static final String CODE_FONT_CONFIG_KEY = "codeFont";
    // Shared by both UI font and code font: the persisted JSON keys ("mode" /
    // "customFontPath") and the set of valid modes are identical for the two font kinds,
    // so they reuse these UI_FONT_*-named constants. They are NOT UI-only despite the name.
    private static final String UI_FONT_MODE_KEY = "mode";
    private static final String UI_FONT_CUSTOM_PATH_KEY = "customFontPath";
    private static final Set<String> VALID_UI_FONT_MODES = Set.of(
            FontConfigService.UI_FONT_MODE_FOLLOW_EDITOR,
            FontConfigService.UI_FONT_MODE_CUSTOM_FILE
    );

    public static final String QWEN_AUTH_METHOD_API_KEY = "api_key";
    public static final String DEFAULT_QWEN_AUTH_METHOD = QWEN_AUTH_METHOD_API_KEY;

    private String redactUrl(String url) {
        if (url == null || url.trim().isEmpty()) {
            return "(empty)";
        }
        return url.trim();
    }

    // ============================================================================
    // Qwen Code connection settings
    // ============================================================================

    public String getQwenAuthMethod() throws IOException {
        JsonObject config = readConfig();
        if (!config.has("qwen") || config.get("qwen").isJsonNull()) {
            return DEFAULT_QWEN_AUTH_METHOD;
        }
        JsonObject qwen = config.getAsJsonObject("qwen");
        if (!qwen.has("authMethod") || qwen.get("authMethod").isJsonNull()) {
            return DEFAULT_QWEN_AUTH_METHOD;
        }
        return qwen.get("authMethod").getAsString();
    }

    public void setQwenAuthMethod(String method) throws IOException {
        JsonObject config = readConfig();
        JsonObject qwen = config.has("qwen") && !config.get("qwen").isJsonNull()
                ? config.getAsJsonObject("qwen")
                : new JsonObject();
        String value = method != null ? method.trim() : "";
        if (value.isEmpty()) {
            qwen.remove("authMethod");
        } else {
            qwen.addProperty("authMethod", value);
        }
        config.add("qwen", qwen);
        writeConfig(config);
        LOG.info("[QwenMateSettingsService] Set qwen.authMethod=" + value);
    }

    public String getQwenApiKey() throws IOException {
        JsonObject config = readConfig();
        if (!config.has("qwen") || config.get("qwen").isJsonNull()) {
            return "";
        }
        JsonObject qwen = config.getAsJsonObject("qwen");
        if (!qwen.has("apiKey") || qwen.get("apiKey").isJsonNull()) {
            return "";
        }
        return qwen.get("apiKey").getAsString();
    }

    public void setQwenApiKey(String apiKey) throws IOException {
        JsonObject config = readConfig();
        JsonObject qwen = config.has("qwen") && !config.get("qwen").isJsonNull()
                ? config.getAsJsonObject("qwen")
                : new JsonObject();
        String value = apiKey != null ? apiKey.trim() : "";
        if (value.isEmpty()) {
            qwen.remove("apiKey");
        } else {
            qwen.addProperty("apiKey", value);
        }
        config.add("qwen", qwen);
        writeConfig(config);
        LOG.info("[QwenMateSettingsService] Updated qwen.apiKey (present=" + !value.isEmpty() + ")");
    }

    public String getQwenApiBaseUrl() throws IOException {
        return getQwenStringSetting("apiBaseUrl");
    }

    public void setQwenApiBaseUrl(String url) throws IOException {
        setQwenStringSetting("apiBaseUrl", url);
        LOG.info("[QwenMateSettingsService] Set qwen.apiBaseUrl=" + redactUrl(url));
    }

    private String getQwenStringSetting(String field) throws IOException {
        JsonObject config = readConfig();
        if (!config.has("qwen") || config.get("qwen").isJsonNull()) {
            return "";
        }
        JsonObject qwen = config.getAsJsonObject("qwen");
        if (!qwen.has(field) || qwen.get(field).isJsonNull()) {
            return "";
        }
        return qwen.get(field).getAsString();
    }

    private void setQwenStringSetting(String field, String value) throws IOException {
        JsonObject config = readConfig();
        JsonObject qwen = config.has("qwen") && !config.get("qwen").isJsonNull()
                ? config.getAsJsonObject("qwen")
                : new JsonObject();
        String v = value != null ? value.trim() : "";
        if (v.isEmpty()) {
            qwen.remove(field);
        } else {
            qwen.addProperty(field, v);
        }
        config.add("qwen", qwen);
        writeConfig(config);
    }

    private static final String COMMIT_AI_KEY = "commitAi";
    private static final String PROMPT_ENHANCER_KEY = "promptEnhancer";
    private static final String AI_FEATURE_PROVIDER_KEY = "provider";
    private static final String AI_FEATURE_MODELS_KEY = "models";
    private static final String AI_FEATURE_EFFECTIVE_PROVIDER_KEY = "effectiveProvider";
    private static final String AI_FEATURE_RESOLUTION_SOURCE_KEY = "resolutionSource";
    private static final String AI_FEATURE_AVAILABILITY_KEY = "availability";
    private static final String AI_FEATURE_PROVIDER_QWEN = "qwen";
    /** Same order as webview AVAILABLE_PROVIDERS / chat CLI selector. */
    private static final String[] AI_FEATURE_PROVIDERS = {
            AI_FEATURE_PROVIDER_QWEN
    };
    private static final String AI_FEATURE_RESOLUTION_MANUAL = "manual";
    private static final String AI_FEATURE_RESOLUTION_AUTO = "auto";
    private static final String AI_FEATURE_RESOLUTION_UNAVAILABLE = "unavailable";
    // Keep in sync with webview DEFAULT_AI_FEATURE_MODELS (ChatInputBox defaults).
    /** Empty model id means "follow the Qwen CLI config" ({@code ~/.qwen/settings.json}). */
    private static final String DEFAULT_AI_FEATURE_QWEN_MODEL = "";
    private static final String USER_LANGUAGE_CONFIG_KEY = "language";

    private final Gson gson;

    // Managers
    private final ConfigPathManager pathManager;
    private final WorkingDirectoryManager workingDirectoryManager;
    private final AgentManager agentManager;
    private final SkillManager skillManager;
    private final McpServerManager mcpServerManager;

    public QwenMateSettingsService() {
        this.gson = new GsonBuilder().setPrettyPrinting().serializeNulls().create();

        // Initialize ConfigPathManager
        this.pathManager = new ConfigPathManager();

        // Initialize WorkingDirectoryManager
        this.workingDirectoryManager = new WorkingDirectoryManager(
                (ignored) -> {
                    try {
                        return readConfig();
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                },
                (config) -> {
                    try {
                        writeConfig(config);
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                }
        );

        // Initialize AgentManager
        this.agentManager = new AgentManager(gson, pathManager);

        // Initialize SkillManager
        this.skillManager = new SkillManager(
                (ignored) -> {
                    try {
                        return readConfig();
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                },
                (config) -> {
                    try {
                        writeConfig(config);
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                }
        );

        // Initialize McpServerManager
        this.mcpServerManager = new McpServerManager(
                gson,
                (ignored) -> {
                    try {
                        return readConfig();
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                },
                (config) -> {
                    try {
                        writeConfig(config);
                    } catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                }
        );
    }

    // ==================== Basic Config Management ====================

    /**
     * Get config file path (~/.qwenmate/config.json).
     */
    public String getConfigPath() {
        return pathManager.getConfigPath();
    }

    /**
     * Read the config file.
     */
    public JsonObject readConfig() throws IOException {
        String configPath = getConfigPath();
        File configFile = new File(configPath);

        if (!configFile.exists()) {
            LOG.info("[QwenMateSettings] Config file not found, creating default: " + configPath);
            return createDefaultConfig();
        }

        try (FileReader reader = new FileReader(configFile, StandardCharsets.UTF_8)) {
            JsonObject config = JsonParser.parseReader(reader).getAsJsonObject();
            LOG.info("[QwenMateSettings] Successfully read config from: " + configPath);
            return config;
        } catch (Exception e) {
            LOG.warn("[QwenMateSettings] Failed to read config: " + e.getMessage());
            return createDefaultConfig();
        }
    }

    /**
     * Write the config file.
     */
    public void writeConfig(JsonObject config) throws IOException {
        pathManager.ensureConfigDirectory();

        // Back up existing config
        backupConfig();

        Path configPath = pathManager.getConfigFilePath();
        Path parent = configPath.getParent();
        Path tempPath = Files.createTempFile(parent, "config.json-", ".tmp");
        try {
            hardenFilePermissions(tempPath);
            try (Writer writer = Files.newBufferedWriter(tempPath, StandardCharsets.UTF_8)) {
                gson.toJson(config, writer);
            }
            try {
                Files.move(tempPath, configPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(tempPath, configPath, StandardCopyOption.REPLACE_EXISTING);
            }
            LOG.info("[QwenMateSettings] Successfully wrote config to: " + configPath);
        } catch (Exception e) {
            LOG.warn("[QwenMateSettings] Failed to write config: " + e.getMessage());
            throw e;
        } finally {
            Files.deleteIfExists(tempPath);
        }
        // Security (J): config.json holds provider API keys/tokens; restrict to 0600.
        hardenFilePermissions(configPath);
    }

    private void backupConfig() {
        try {
            Path configPath = pathManager.getConfigFilePath();
            if (Files.exists(configPath)) {
                Path backupPath = Paths.get(pathManager.getBackupPath());
                Files.copy(configPath, backupPath, StandardCopyOption.REPLACE_EXISTING);
                // Security (J): the .bak copy also contains secrets; restrict to 0600.
                hardenFilePermissions(backupPath);
            }
        } catch (Exception e) {
            LOG.warn("[QwenMateSettings] Failed to backup config: " + e.getMessage());
        }
    }

    /**
     * Best-effort restrict a file to owner read/write (0600). No-op on non-POSIX
     * filesystems (e.g. Windows), where the per-user home directory ACL applies. (Security J)
     */
    private static void hardenFilePermissions(Path path) {
        try {
            Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException | IOException e) {
            LOG.debug("[QwenMateSettings] Could not set 0600 on " + path + ": " + e.getMessage());
        }
    }

    /**
     * Create default config.
     */
    private JsonObject createDefaultConfig() {
        JsonObject config = new JsonObject();
        config.addProperty("version", CONFIG_VERSION);

        return config;
    }

    // ==================== Language Config Management ====================

    /**
     * Get the stored UI language preference.
     *
     * @return stored value: a language code, the follow-IDE sentinel ({@code idea}),
     *         or null when the user has never chosen a language
     */
    public String getUserLanguage() throws IOException {
        JsonObject config = readConfig();
        if (!config.has(USER_LANGUAGE_CONFIG_KEY) || config.get(USER_LANGUAGE_CONFIG_KEY).isJsonNull()) {
            return null;
        }
        String language = config.get(USER_LANGUAGE_CONFIG_KEY).getAsString();
        return language == null || language.trim().isEmpty() ? null : language.trim();
    }

    /**
     * Persist the UI language preference.
     *
     * @param language supported UI language code, or the {@code idea} follow-IDE sentinel
     */
    public void setUserLanguage(String language) throws IOException {
        JsonObject config = readConfig();
        config.addProperty(USER_LANGUAGE_CONFIG_KEY, language);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set user language: " + language);
    }

    // ==================== Working Directory Management ====================

    public String getCustomWorkingDirectory(String projectPath) throws IOException {
        return workingDirectoryManager.getCustomWorkingDirectory(projectPath);
    }

    public void setCustomWorkingDirectory(String projectPath, String customWorkingDir) throws IOException {
        workingDirectoryManager.setCustomWorkingDirectory(projectPath, customWorkingDir);
    }

    /**
     * Resolve the normalized effective working directory for a project (custom
     * directory if configured and valid, otherwise the normalized project path).
     * This is the directory Qwen runs in and the key history is stored under.
     */
    public String getEffectiveWorkingDirectory(String projectPath) {
        return workingDirectoryManager.resolveEffectiveWorkingDirectory(projectPath);
    }

    public Map<String, String> getAllWorkingDirectories() throws IOException {
        return workingDirectoryManager.getAllWorkingDirectories();
    }

    // ==================== Commit Prompt Config Management ====================

    /**
     * Get the commit AI prompt.
     *
     * @return commit prompt
     */
    public String getCommitPrompt() throws IOException {
        JsonObject config = readConfig();

        // Check for commitPrompt config
        if (config.has("commitPrompt")) {
            return config.get("commitPrompt").getAsString();
        }

        // Return default value (from i18n resource bundle)
        return QwenMateBundle.message("commit.defaultPrompt");
    }

    /**
     * Set the commit AI prompt.
     *
     * @param prompt commit prompt
     */
    public void setCommitPrompt(String prompt) throws IOException {
        JsonObject config = readConfig();

        // Save config
        config.addProperty("commitPrompt", prompt);

        writeConfig(config);
        LOG.info("[QwenMateSettings] Set commit prompt: " + prompt);
    }

    /**
     * Get project-level commit AI prompt.
     *
     * @param projectPath project path
     * @return project commit prompt, empty string if not configured
     */
    public String getProjectCommitPrompt(String projectPath) throws IOException {
        if (projectPath == null) {
            return "";
        }
        JsonObject config = readConfig();
        if (config.has("projectCommitPrompt")) {
            JsonObject projectPrompts = config.getAsJsonObject("projectCommitPrompt");
            if (projectPrompts.has(projectPath)) {
                return projectPrompts.get(projectPath).getAsString();
            }
        }
        return "";
    }

    /**
     * Set project-level commit AI prompt.
     *
     * @param projectPath project path
     * @param prompt commit prompt
     */
    public void setProjectCommitPrompt(String projectPath, String prompt) throws IOException {
        if (projectPath == null) {
            return;
        }
        JsonObject config = readConfig();
        JsonObject projectPrompts;
        if (config.has("projectCommitPrompt")) {
            projectPrompts = config.getAsJsonObject("projectCommitPrompt");
        } else {
            projectPrompts = new JsonObject();
            config.add("projectCommitPrompt", projectPrompts);
        }
        projectPrompts.addProperty(projectPath, prompt);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set project commit prompt for project: " + projectPath);
    }

    // ==================== UI Font Config Management ====================

    /**
     * Get persisted UI font configuration.
     *
     * @return normalized UI font configuration
     */
    public JsonObject getUiFontConfig() throws IOException {
        JsonObject config = readConfig();
        if (!config.has(UI_FONT_CONFIG_KEY) || !config.get(UI_FONT_CONFIG_KEY).isJsonObject()) {
            return createDefaultUiFontConfig();
        }
        return normalizeUiFontConfig(config.getAsJsonObject(UI_FONT_CONFIG_KEY));
    }

    /**
     * Persist UI font configuration.
     *
     * @param mode requested mode
     * @param customFontPath custom font path for custom file mode
     */
    public void setUiFontConfig(String mode, String customFontPath) throws IOException {
        JsonObject config = readConfig();
        config.add(UI_FONT_CONFIG_KEY, createUiFontConfig(mode, customFontPath));
        writeConfig(config);
        LOG.debug("[QwenMateSettings] Set UI font config: mode=" + mode
                + ", customFontPath=" + customFontPath);
    }

    /**
     * Get persisted code font configuration.
     *
     * @return normalized code font configuration
     */
    public JsonObject getCodeFontConfig() throws IOException {
        JsonObject config = readConfig();
        if (!config.has(CODE_FONT_CONFIG_KEY) || !config.get(CODE_FONT_CONFIG_KEY).isJsonObject()) {
            return createDefaultCodeFontConfig();
        }
        return normalizeCodeFontConfig(config.getAsJsonObject(CODE_FONT_CONFIG_KEY));
    }

    /**
     * Persist code font configuration.
     *
     * @param mode requested mode
     * @param customFontPath custom font path for custom file mode
     */
    public void setCodeFontConfig(String mode, String customFontPath) throws IOException {
        JsonObject config = readConfig();
        config.add(CODE_FONT_CONFIG_KEY, createCodeFontConfig(mode, customFontPath));
        writeConfig(config);
        LOG.debug("[QwenMateSettings] Set code font config: mode=" + mode
                + ", customFontPath=" + customFontPath);
    }

    // ==================== Permission Dialog Timeout Config Management ====================

    public static final int DEFAULT_PERMISSION_DIALOG_TIMEOUT_SECONDS =
            PermissionDialogTimeoutSettings.DEFAULT_PERMISSION_DIALOG_TIMEOUT_SECONDS;
    public static final int MIN_PERMISSION_DIALOG_TIMEOUT_SECONDS =
            PermissionDialogTimeoutSettings.MIN_PERMISSION_DIALOG_TIMEOUT_SECONDS;
    public static final int MAX_PERMISSION_DIALOG_TIMEOUT_SECONDS =
            PermissionDialogTimeoutSettings.MAX_PERMISSION_DIALOG_TIMEOUT_SECONDS;
    public static final long PERMISSION_SAFETY_NET_BUFFER_SECONDS =
            PermissionDialogTimeoutSettings.PERMISSION_SAFETY_NET_BUFFER_SECONDS;

    public static int clampPermissionDialogTimeoutSeconds(int seconds) {
        return PermissionDialogTimeoutSettings.clampPermissionDialogTimeoutSeconds(seconds);
    }

    public int getPermissionDialogTimeoutSeconds() throws IOException {
        return PermissionDialogTimeoutSettings.getPermissionDialogTimeoutSeconds(this);
    }

    public void setPermissionDialogTimeoutSeconds(int seconds) throws IOException {
        PermissionDialogTimeoutSettings.setPermissionDialogTimeoutSeconds(this, seconds);
    }

    // ==================== Streaming Config Management ====================

    /**
     * Get streaming configuration.
     *
     * @param projectPath project path
     * @return whether streaming is enabled
     */
    public boolean getStreamingEnabled(String projectPath) throws IOException {
        JsonObject config = readConfig();

        // Check for streaming config
        if (!config.has("streaming")) {
            return true;
        }

        JsonObject streaming = config.getAsJsonObject("streaming");

        // Check project-specific config first
        if (projectPath != null && streaming.has(projectPath)) {
            return streaming.get(projectPath).getAsBoolean();
        }

        // Fall back to global default if no project-specific config
        if (streaming.has("default")) {
            return streaming.get("default").getAsBoolean();
        }

        return true;
    }

    private JsonObject createDefaultUiFontConfig() {
        JsonObject uiFont = new JsonObject();
        uiFont.addProperty(UI_FONT_MODE_KEY, FontConfigService.UI_FONT_MODE_FOLLOW_EDITOR);
        return uiFont;
    }

    private JsonObject createDefaultCodeFontConfig() {
        JsonObject codeFont = new JsonObject();
        codeFont.addProperty(UI_FONT_MODE_KEY, FontConfigService.UI_FONT_MODE_FOLLOW_EDITOR);
        return codeFont;
    }

    private JsonObject normalizeUiFontConfig(JsonObject rawConfig) {
        if (rawConfig == null) {
            return createDefaultUiFontConfig();
        }
        String requestedMode = rawConfig.has(UI_FONT_MODE_KEY) && !rawConfig.get(UI_FONT_MODE_KEY).isJsonNull()
                ? rawConfig.get(UI_FONT_MODE_KEY).getAsString()
                : FontConfigService.UI_FONT_MODE_FOLLOW_EDITOR;
        String customFontPath = rawConfig.has(UI_FONT_CUSTOM_PATH_KEY) && !rawConfig.get(UI_FONT_CUSTOM_PATH_KEY).isJsonNull()
                ? rawConfig.get(UI_FONT_CUSTOM_PATH_KEY).getAsString()
                : null;
        return createUiFontConfig(requestedMode, customFontPath);
    }

    private JsonObject createUiFontConfig(String mode, String customFontPath) {
        String normalizedMode = VALID_UI_FONT_MODES.contains(mode)
                ? mode
                : FontConfigService.UI_FONT_MODE_FOLLOW_EDITOR;
        JsonObject uiFont = new JsonObject();
        uiFont.addProperty(UI_FONT_MODE_KEY, normalizedMode);

        if (FontConfigService.UI_FONT_MODE_CUSTOM_FILE.equals(normalizedMode)
                && customFontPath != null
                && !customFontPath.trim().isEmpty()) {
            uiFont.addProperty(UI_FONT_CUSTOM_PATH_KEY, customFontPath.trim());
        }

        return uiFont;
    }

    private JsonObject normalizeCodeFontConfig(JsonObject rawConfig) {
        if (rawConfig == null) {
            return createDefaultCodeFontConfig();
        }
        String requestedMode = rawConfig.has(UI_FONT_MODE_KEY) && !rawConfig.get(UI_FONT_MODE_KEY).isJsonNull()
                ? rawConfig.get(UI_FONT_MODE_KEY).getAsString()
                : FontConfigService.UI_FONT_MODE_FOLLOW_EDITOR;
        String customFontPath = rawConfig.has(UI_FONT_CUSTOM_PATH_KEY) && !rawConfig.get(UI_FONT_CUSTOM_PATH_KEY).isJsonNull()
                ? rawConfig.get(UI_FONT_CUSTOM_PATH_KEY).getAsString()
                : null;
        return createCodeFontConfig(requestedMode, customFontPath);
    }

    private JsonObject createCodeFontConfig(String mode, String customFontPath) {
        // UI font and code font share the same valid-mode set (see VALID_UI_FONT_MODES).
        String normalizedMode = VALID_UI_FONT_MODES.contains(mode)
                ? mode
                : FontConfigService.UI_FONT_MODE_FOLLOW_EDITOR;
        JsonObject codeFont = new JsonObject();
        codeFont.addProperty(UI_FONT_MODE_KEY, normalizedMode);

        if (FontConfigService.UI_FONT_MODE_CUSTOM_FILE.equals(normalizedMode)
                && customFontPath != null
                && !customFontPath.trim().isEmpty()) {
            codeFont.addProperty(UI_FONT_CUSTOM_PATH_KEY, customFontPath.trim());
        }

        return codeFont;
    }

    /**
     * Set streaming configuration.
     *
     * @param projectPath project path
     * @param enabled     whether to enable
     */
    public void setStreamingEnabled(String projectPath, boolean enabled) throws IOException {
        JsonObject config = readConfig();

        // Ensure streaming object exists
        JsonObject streaming;
        if (config.has("streaming")) {
            streaming = config.getAsJsonObject("streaming");
        } else {
            streaming = new JsonObject();
            config.add("streaming", streaming);
        }

        // Save project-specific config (also serves as default)
        if (projectPath != null) {
            streaming.addProperty(projectPath, enabled);
        }
        streaming.addProperty("default", enabled);

        writeConfig(config);
        LOG.info("[QwenMateSettings] Set streaming enabled to " + enabled + " for project: " + projectPath);
    }

    // ==================== Always Thinking Config Management ====================

    /**
     * Get the "always thinking" toggle.
     *
     * @return the saved value, or {@code null} when the user never set one
     */
    public Boolean getAlwaysThinkingEnabled() throws IOException {
        JsonObject config = readConfig();
        if (!config.has("alwaysThinkingEnabled") || config.get("alwaysThinkingEnabled").isJsonNull()) {
            return null;
        }
        return config.get("alwaysThinkingEnabled").getAsBoolean();
    }

    /**
     * Set the "always thinking" toggle.
     *
     * @param enabled whether assistant thinking should always be requested
     */
    public void setAlwaysThinkingEnabled(boolean enabled) throws IOException {
        JsonObject config = readConfig();
        config.addProperty("alwaysThinkingEnabled", enabled);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set always thinking enabled to " + enabled);
    }

    // ==================== Auto Open File Config Management ====================

    /**
     * Get auto-open file configuration.
     *
     * @param projectPath project path
     * @return whether auto-open file is enabled
     */
    public boolean getAutoOpenFileEnabled(String projectPath) throws IOException {
        JsonObject config = readConfig();

        // Check for autoOpenFile config
        if (!config.has("autoOpenFile")) {
            return false;
        }

        JsonObject autoOpenFile = config.getAsJsonObject("autoOpenFile");

        // Check project-specific config first
        if (projectPath != null && autoOpenFile.has(projectPath)) {
            return autoOpenFile.get(projectPath).getAsBoolean();
        }

        // Fall back to global default if no project-specific config
        if (autoOpenFile.has("default")) {
            return autoOpenFile.get("default").getAsBoolean();
        }

        return false;
    }

    /**
     * Set auto-open file configuration.
     *
     * @param projectPath project path
     * @param enabled     whether to enable
     */
    public void setAutoOpenFileEnabled(String projectPath, boolean enabled) throws IOException {
        JsonObject config = readConfig();

        // Ensure autoOpenFile object exists
        JsonObject autoOpenFile;
        if (config.has("autoOpenFile")) {
            autoOpenFile = config.getAsJsonObject("autoOpenFile");
        } else {
            autoOpenFile = new JsonObject();
            config.add("autoOpenFile", autoOpenFile);
        }

        // Save project-specific config (also serves as default)
        if (projectPath != null) {
            autoOpenFile.addProperty(projectPath, enabled);
        }
        autoOpenFile.addProperty("default", enabled);

        writeConfig(config);
        LOG.info("[QwenMateSettings] Set auto open file enabled to " + enabled + " for project: " + projectPath);
    }

    // ==================== MCP Server Management ====================

    public List<JsonObject> getMcpServers() throws IOException {
        return mcpServerManager.getMcpServers();
    }

    public List<JsonObject> getMcpServersWithProjectPath(String projectPath) throws IOException {
        return mcpServerManager.getMcpServersWithProjectPath(projectPath);
    }

    public void upsertMcpServer(JsonObject server) throws IOException {
        mcpServerManager.upsertMcpServer(server);
    }

    public void upsertMcpServer(JsonObject server, String projectPath) throws IOException {
        mcpServerManager.upsertMcpServer(server, projectPath);
    }

    public boolean deleteMcpServer(String serverId) throws IOException {
        return mcpServerManager.deleteMcpServer(serverId);
    }

    public Map<String, Object> validateMcpServer(JsonObject server) {
        return mcpServerManager.validateMcpServer(server);
    }

    // ==================== Skills Management ====================

    public List<JsonObject> getSkills() throws IOException {
        return skillManager.getSkills();
    }

    public void upsertSkill(JsonObject skill) throws IOException {
        skillManager.upsertSkill(skill);
    }

    public boolean deleteSkill(String id) throws IOException {
        return skillManager.deleteSkill(id);
    }

    public Map<String, Object> validateSkill(JsonObject skill) {
        return skillManager.validateSkill(skill);
    }

    // ==================== Agents Management ====================

    public List<JsonObject> getAgents() throws IOException {
        return agentManager.getAgents();
    }

    public void addAgent(JsonObject agent) throws IOException {
        agentManager.addAgent(agent);
    }

    public void updateAgent(String id, JsonObject updates) throws IOException {
        agentManager.updateAgent(id, updates);
    }

    public boolean deleteAgent(String id) throws IOException {
        return agentManager.deleteAgent(id);
    }

    public JsonObject getAgent(String id) throws IOException {
        return agentManager.getAgent(id);
    }

    public String getSelectedAgentId() throws IOException {
        return agentManager.getSelectedAgentId();
    }

    public void setSelectedAgentId(String agentId) throws IOException {
        agentManager.setSelectedAgentId(agentId);
    }

    public AgentManager getAgentManager() {
        return agentManager;
    }

    // ==================== Prompts Management ====================

    /**
     * Get a PromptManager for the specified scope.
     * Creates managers on-demand using PromptManagerFactory.
     *
     * @param scope   The prompt scope (GLOBAL or PROJECT)
     * @param project The IntelliJ Project instance (required for PROJECT scope, can be null for GLOBAL scope)
     * @return An AbstractPromptManager instance for the specified scope
     */
    public AbstractPromptManager getPromptManager(PromptScope scope, Project project) {
        return PromptManagerFactory.create(scope, gson, pathManager, project);
    }

    /**
     * Get prompts from the specified scope.
     *
     * @param scope   The prompt scope (GLOBAL or PROJECT)
     * @param project The IntelliJ Project instance (required for PROJECT scope, can be null for GLOBAL scope)
     * @return List of prompts
     * @throws IOException if reading fails
     */
    public List<JsonObject> getPrompts(PromptScope scope, Project project) throws IOException {
        return getPrompts(scope, project, "qwen");
    }

    public List<JsonObject> getPrompts(PromptScope scope, Project project, String provider) throws IOException {
        String normalizedProvider = normalizePromptProvider(provider);
        List<JsonObject> result = new ArrayList<>();
        for (JsonObject prompt : getPromptManager(scope, project).getPrompts()) {
            if (promptBelongsToProvider(prompt, normalizedProvider)) {
                JsonObject copy = prompt.deepCopy();
                copy.addProperty("provider", normalizedProvider);
                result.add(copy);
            }
        }
        return result;
    }

    /**
     * Add a prompt to the specified scope.
     *
     * @param prompt  The prompt to add
     * @param scope   The prompt scope (GLOBAL or PROJECT)
     * @param project The IntelliJ Project instance (required for PROJECT scope, can be null for GLOBAL scope)
     * @throws IOException if writing fails
     */
    public void addPrompt(JsonObject prompt, PromptScope scope, Project project) throws IOException {
        addPrompt(prompt, scope, project, "qwen");
    }

    public void addPrompt(JsonObject prompt, PromptScope scope, Project project, String provider) throws IOException {
        AbstractPromptManager manager = getPromptManager(scope, project);
        JsonObject copy = prompt.deepCopy();
        String normalizedProvider = normalizePromptProvider(provider);
        copy.addProperty("provider", normalizedProvider);
        if (copy.has("id") && copy.get("id").isJsonPrimitive()) {
            String id = copy.get("id").getAsString();
            JsonObject existing = manager.getPrompt(id);
            if (existing != null && !promptBelongsToProvider(existing, normalizedProvider)) {
                JsonObject config = manager.readPromptConfig();
                copy.addProperty("id", manager.generateUniqueId(id, config.getAsJsonObject("prompts")));
            }
        }
        manager.addPrompt(copy);
    }

    /**
     * Update a prompt in the specified scope.
     *
     * @param id      The prompt ID
     * @param updates The updates to apply
     * @param scope   The prompt scope (GLOBAL or PROJECT)
     * @param project The IntelliJ Project instance (required for PROJECT scope, can be null for GLOBAL scope)
     * @throws IOException if writing fails
     */
    public void updatePrompt(String id, JsonObject updates, PromptScope scope, Project project) throws IOException {
        updatePrompt(id, updates, scope, project, "qwen");
    }

    public void updatePrompt(String id, JsonObject updates, PromptScope scope, Project project, String provider) throws IOException {
        AbstractPromptManager manager = getPromptManager(scope, project);
        String normalizedProvider = normalizePromptProvider(provider);
        JsonObject existing = manager.getPrompt(id);
        if (!promptBelongsToProvider(existing, normalizedProvider)) {
            throw new IllegalArgumentException("Prompt with id '" + id + "' not found for provider " + normalizedProvider);
        }
        JsonObject copy = updates.deepCopy();
        copy.addProperty("provider", normalizedProvider);
        manager.updatePrompt(id, copy);
    }

    /**
     * Delete a prompt from the specified scope.
     *
     * @param id      The prompt ID
     * @param scope   The prompt scope (GLOBAL or PROJECT)
     * @param project The IntelliJ Project instance (required for PROJECT scope, can be null for GLOBAL scope)
     * @return true if deleted, false if not found
     * @throws IOException if writing fails
     */
    public boolean deletePrompt(String id, PromptScope scope, Project project) throws IOException {
        return deletePrompt(id, scope, project, "qwen");
    }

    public boolean deletePrompt(String id, PromptScope scope, Project project, String provider) throws IOException {
        AbstractPromptManager manager = getPromptManager(scope, project);
        String normalizedProvider = normalizePromptProvider(provider);
        JsonObject existing = manager.getPrompt(id);
        if (!promptBelongsToProvider(existing, normalizedProvider)) {
            return false;
        }
        return manager.deletePrompt(id);
    }

    /**
     * Get a prompt by ID from the specified scope.
     *
     * @param id      The prompt ID
     * @param scope   The prompt scope (GLOBAL or PROJECT)
     * @param project The IntelliJ Project instance (required for PROJECT scope, can be null for GLOBAL scope)
     * @return The prompt JsonObject, or null if not found
     * @throws IOException if reading fails
     */
    public JsonObject getPrompt(String id, PromptScope scope, Project project) throws IOException {
        return getPrompt(id, scope, project, "qwen");
    }

    public JsonObject getPrompt(String id, PromptScope scope, Project project, String provider) throws IOException {
        String normalizedProvider = normalizePromptProvider(provider);
        JsonObject prompt = getPromptManager(scope, project).getPrompt(id);
        if (!promptBelongsToProvider(prompt, normalizedProvider)) {
            return null;
        }
        JsonObject copy = prompt.deepCopy();
        copy.addProperty("provider", normalizedProvider);
        return copy;
    }

    /**
     * Batch import prompts to the specified scope.
     *
     * @param promptsToImport The prompts to import
     * @param strategy        The conflict resolution strategy
     * @param scope           The prompt scope (GLOBAL or PROJECT)
     * @param project         The IntelliJ Project instance (required for PROJECT scope, can be null for GLOBAL scope)
     * @return A map containing the results of the import operation
     * @throws IOException if writing fails
     */
    public Map<String, Object> batchImportPrompts(List<JsonObject> promptsToImport, ConflictStrategy strategy, PromptScope scope, Project project) throws IOException {
        return batchImportPrompts(promptsToImport, strategy, scope, project, "qwen");
    }

    public Map<String, Object> batchImportPrompts(List<JsonObject> promptsToImport, ConflictStrategy strategy,
                                                  PromptScope scope, Project project, String provider) throws IOException {
        AbstractPromptManager manager = getPromptManager(scope, project);
        String normalizedProvider = normalizePromptProvider(provider);
        List<JsonObject> scopedPrompts = new ArrayList<>();
        for (JsonObject prompt : promptsToImport) {
            JsonObject copy = prompt.deepCopy();
            copy.addProperty("provider", normalizedProvider);
            scopedPrompts.add(copy);
        }
        return batchImportProviderPrompts(manager, scopedPrompts, strategy, normalizedProvider);
    }

    public Set<String> detectPromptConflicts(List<JsonObject> promptsToImport, PromptScope scope,
                                             Project project, String provider) throws IOException {
        AbstractPromptManager manager = getPromptManager(scope, project);
        String normalizedProvider = normalizePromptProvider(provider);
        Set<String> conflicts = new HashSet<>();
        JsonObject existingPrompts = manager.readPromptConfig().getAsJsonObject("prompts");
        for (JsonObject prompt : promptsToImport) {
            if (!prompt.has("id") || !prompt.get("id").isJsonPrimitive()) {
                continue;
            }
            String id = prompt.get("id").getAsString();
            if (existingPrompts.has(id)
                    && promptBelongsToProvider(existingPrompts.getAsJsonObject(id), normalizedProvider)) {
                conflicts.add(id);
            }
        }
        return conflicts;
    }

    private Map<String, Object> batchImportProviderPrompts(AbstractPromptManager manager,
                                                           List<JsonObject> promptsToImport,
                                                           ConflictStrategy strategy,
                                                           String provider) throws IOException {
        Map<String, Object> result = new HashMap<>();
        int imported = 0;
        int skipped = 0;
        int updated = 0;
        List<String> errors = new ArrayList<>();

        JsonObject config = manager.readPromptConfig();
        JsonObject prompts = config.getAsJsonObject("prompts");
        Set<String> conflicts = new HashSet<>();
        for (JsonObject prompt : promptsToImport) {
            if (!prompt.has("id") || !prompt.get("id").isJsonPrimitive()) {
                continue;
            }
            String id = prompt.get("id").getAsString();
            if (prompts.has(id) && promptBelongsToProvider(prompts.getAsJsonObject(id), provider)) {
                conflicts.add(id);
            }
        }

        for (JsonObject prompt : promptsToImport) {
            try {
                String validationError = manager.validatePrompt(prompt);
                if (validationError != null) {
                    errors.add("Validation failed: " + validationError);
                    skipped++;
                    continue;
                }

                String id = prompt.get("id").getAsString();
                boolean hasSameProviderConflict = conflicts.contains(id);

                if (hasSameProviderConflict) {
                    switch (strategy) {
                        case SKIP:
                            skipped++;
                            continue;
                        case OVERWRITE:
                            JsonObject overwritePrompt = prompt.deepCopy();
                            overwritePrompt.addProperty("provider", provider);
                            overwritePrompt.addProperty("updatedAt", System.currentTimeMillis());
                            prompts.add(id, overwritePrompt);
                            updated++;
                            break;
                        case DUPLICATE:
                            String duplicateId = manager.generateUniqueId(id, prompts);
                            JsonObject duplicatePrompt = prompt.deepCopy();
                            duplicatePrompt.addProperty("id", duplicateId);
                            duplicatePrompt.addProperty("provider", provider);
                            if (!duplicatePrompt.has("createdAt")) {
                                duplicatePrompt.addProperty("createdAt", System.currentTimeMillis());
                            }
                            duplicatePrompt.addProperty("updatedAt", System.currentTimeMillis());
                            prompts.add(duplicateId, duplicatePrompt);
                            imported++;
                            break;
                    }
                } else {
                    String targetId = prompts.has(id) ? manager.generateUniqueId(id, prompts) : id;
                    JsonObject newPrompt = prompt.deepCopy();
                    newPrompt.addProperty("id", targetId);
                    newPrompt.addProperty("provider", provider);
                    if (!newPrompt.has("createdAt")) {
                        newPrompt.addProperty("createdAt", System.currentTimeMillis());
                    }
                    if (!newPrompt.has("updatedAt")) {
                        newPrompt.addProperty("updatedAt", System.currentTimeMillis());
                    }
                    prompts.add(targetId, newPrompt);
                    imported++;
                }
            } catch (Exception e) {
                errors.add("Failed to import prompt: " + e.getMessage());
                skipped++;
            }
        }

        manager.writePromptConfig(config);
        result.put("imported", imported);
        result.put("updated", updated);
        result.put("skipped", skipped);
        result.put("errors", errors);
        result.put("success", errors.isEmpty());
        return result;
    }

    public static String normalizePromptProvider(String provider) {
        // qwen is the only supported prompt provider; any legacy value folds into it.
        return AI_FEATURE_PROVIDER_QWEN;
    }

    private static boolean promptBelongsToProvider(JsonObject prompt, String provider) {
        if (prompt == null) {
            return false;
        }
        String promptProvider = prompt.has("provider")
                && prompt.get("provider").isJsonPrimitive()
                && prompt.get("provider").getAsJsonPrimitive().isString()
                ? prompt.get("provider").getAsString()
                : "qwen";
        return normalizePromptProvider(promptProvider).equals(provider);
    }

    // ==================== Deprecated Backward-Compatible Methods ====================

    /**
     * Get a PromptManager (defaults to GLOBAL scope).
     *
     * @deprecated Use {@link #getPromptManager(PromptScope, Project)} instead
     */
    @Deprecated
    public AbstractPromptManager getPromptManager() {
        return getPromptManager(PromptScope.GLOBAL, null);
    }

    /**
     * Get prompts (defaults to GLOBAL scope).
     *
     * @deprecated Use {@link #getPrompts(PromptScope, Project)} instead
     */
    @Deprecated
    public List<JsonObject> getPrompts() throws IOException {
        return getPrompts(PromptScope.GLOBAL, null);
    }

    /**
     * Add a prompt (defaults to GLOBAL scope).
     *
     * @deprecated Use {@link #addPrompt(JsonObject, PromptScope, Project)} instead
     */
    @Deprecated
    public void addPrompt(JsonObject prompt) throws IOException {
        addPrompt(prompt, PromptScope.GLOBAL, null);
    }

    /**
     * Update a prompt (defaults to GLOBAL scope).
     *
     * @deprecated Use {@link #updatePrompt(String, JsonObject, PromptScope, Project)} instead
     */
    @Deprecated
    public void updatePrompt(String id, JsonObject updates) throws IOException {
        updatePrompt(id, updates, PromptScope.GLOBAL, null);
    }

    /**
     * Delete a prompt (defaults to GLOBAL scope).
     *
     * @deprecated Use {@link #deletePrompt(String, PromptScope, Project)} instead
     */
    @Deprecated
    public boolean deletePrompt(String id) throws IOException {
        return deletePrompt(id, PromptScope.GLOBAL, null);
    }

    /**
     * Get a prompt by ID (defaults to GLOBAL scope).
     *
     * @deprecated Use {@link #getPrompt(String, PromptScope, Project)} instead
     */
    @Deprecated
    public JsonObject getPrompt(String id) throws IOException {
        return getPrompt(id, PromptScope.GLOBAL, null);
    }

    // ==================== Sound Notification Management ====================

    /**
     * Get whether sound notification is enabled.
     *
     * @return whether sound notification is enabled, default is false
     */
    public boolean getSoundNotificationEnabled() throws IOException {
        JsonObject config = readConfig();

        if (!config.has("soundNotification")) {
            return false;
        }

        JsonObject soundConfig = config.getAsJsonObject("soundNotification");
        if (soundConfig.has("enabled")) {
            return soundConfig.get("enabled").getAsBoolean();
        }

        return false;
    }

    /**
     * Set whether sound notification is enabled.
     *
     * @param enabled whether to enable
     */
    public void setSoundNotificationEnabled(boolean enabled) throws IOException {
        JsonObject config = readConfig();

        JsonObject soundConfig;
        if (config.has("soundNotification")) {
            soundConfig = config.getAsJsonObject("soundNotification");
        } else {
            soundConfig = new JsonObject();
            config.add("soundNotification", soundConfig);
        }

        soundConfig.addProperty("enabled", enabled);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set sound notification enabled: " + enabled);
    }

    /**
     * Get custom sound file path.
     *
     * @return custom sound path, null means use default sound
     */
    public String getCustomSoundPath() throws IOException {
        JsonObject config = readConfig();

        if (!config.has("soundNotification")) {
            return null;
        }

        JsonObject soundConfig = config.getAsJsonObject("soundNotification");
        if (soundConfig.has("customSoundPath") && !soundConfig.get("customSoundPath").isJsonNull()) {
            return soundConfig.get("customSoundPath").getAsString();
        }

        return null;
    }

    /**
     * Set custom sound file path.
     *
     * @param path file path, null means use default sound
     */
    public void setCustomSoundPath(String path) throws IOException {
        JsonObject config = readConfig();

        JsonObject soundConfig;
        if (config.has("soundNotification")) {
            soundConfig = config.getAsJsonObject("soundNotification");
        } else {
            soundConfig = new JsonObject();
            config.add("soundNotification", soundConfig);
        }

        if (path == null || path.isEmpty()) {
            soundConfig.remove("customSoundPath");
        } else {
            soundConfig.addProperty("customSoundPath", path);
        }

        writeConfig(config);
        LOG.info("[QwenMateSettings] Set custom sound path: " + path);
    }

    /**
     * Get whether sound should only play when IDE window is not focused.
     *
     * @return whether only-when-unfocused is enabled, default is false
     */
    public boolean getSoundOnlyWhenUnfocused() throws IOException {
        JsonObject config = readConfig();

        if (!config.has("soundNotification")) {
            return false;
        }

        JsonObject soundConfig = config.getAsJsonObject("soundNotification");
        if (soundConfig.has("onlyWhenUnfocused")) {
            return soundConfig.get("onlyWhenUnfocused").getAsBoolean();
        }

        return false;
    }

    /**
     * Set whether sound should only play when IDE window is not focused.
     *
     * @param enabled whether to enable
     */
    public void setSoundOnlyWhenUnfocused(boolean enabled) throws IOException {
        JsonObject config = readConfig();

        JsonObject soundConfig;
        if (config.has("soundNotification")) {
            soundConfig = config.getAsJsonObject("soundNotification");
        } else {
            soundConfig = new JsonObject();
            config.add("soundNotification", soundConfig);
        }

        soundConfig.addProperty("onlyWhenUnfocused", enabled);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set sound only when unfocused: " + enabled);
    }

    /**
     * Get selected sound ID.
     *
     * @return sound ID (e.g. "default", "chime", "bell", "ding", "success", "custom"), defaults to "default"
     */
    public String getSelectedSound() throws IOException {
        JsonObject config = readConfig();

        if (!config.has("soundNotification")) {
            return "default";
        }

        JsonObject soundConfig = config.getAsJsonObject("soundNotification");
        if (soundConfig.has("selectedSound") && !soundConfig.get("selectedSound").isJsonNull()) {
            return soundConfig.get("selectedSound").getAsString();
        }

        return "default";
    }

    /**
     * Set selected sound ID.
     *
     * @param soundId sound ID, null or empty means "default"
     */
    public void setSelectedSound(String soundId) throws IOException {
        JsonObject config = readConfig();

        JsonObject soundConfig;
        if (config.has("soundNotification")) {
            soundConfig = config.getAsJsonObject("soundNotification");
        } else {
            soundConfig = new JsonObject();
            config.add("soundNotification", soundConfig);
        }

        soundConfig.addProperty("selectedSound", (soundId == null || soundId.isEmpty()) ? "default" : soundId);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set selected sound: " + soundId);
    }

    // ==================== Task Completion Notification Management ====================

    /**
     * Get whether task completion balloon notification is enabled.
     *
     * @return whether task completion notification is enabled, default is false (opt-in)
     */
    public boolean getTaskCompletionNotificationEnabled() throws IOException {
        JsonObject config = readConfig();

        if (config.has("taskCompletionNotificationEnabled") && !config.get("taskCompletionNotificationEnabled").isJsonNull()) {
            return config.get("taskCompletionNotificationEnabled").getAsBoolean();
        }

        return false;
    }

    /**
     * Set whether task completion balloon notification is enabled.
     *
     * @param enabled whether to enable
     */
    public void setTaskCompletionNotificationEnabled(boolean enabled) throws IOException {
        JsonObject config = readConfig();
        config.addProperty("taskCompletionNotificationEnabled", enabled);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set task completion notification enabled: " + enabled);
    }

    // ==================== Ask User Question Notification Management ====================

    /**
     * Get whether the AskUserQuestion reminder notification is enabled.
     *
     * @return whether the reminder notification is enabled, default is false (opt-in)
     */
    public boolean getAskUserQuestionNotificationEnabled() throws IOException {
        JsonObject config = readConfig();

        if (config.has("askUserQuestionNotificationEnabled") && !config.get("askUserQuestionNotificationEnabled").isJsonNull()) {
            return config.get("askUserQuestionNotificationEnabled").getAsBoolean();
        }

        return false;
    }

    /**
     * Set whether the AskUserQuestion reminder notification is enabled.
     *
     * @param enabled whether to enable
     */
    public void setAskUserQuestionNotificationEnabled(boolean enabled) throws IOException {
        JsonObject config = readConfig();
        config.addProperty("askUserQuestionNotificationEnabled", enabled);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set ask user question notification enabled: " + enabled);
    }

    /**
     * Get whether the AskUserQuestion reminder sound notification is enabled.
     *
     * @return whether the reminder sound is enabled, default is false (opt-in)
     */
    public boolean getAskUserQuestionSoundNotificationEnabled() throws IOException {
        JsonObject config = readConfig();

        if (config.has("askUserQuestionSoundNotificationEnabled")
                && !config.get("askUserQuestionSoundNotificationEnabled").isJsonNull()) {
            return config.get("askUserQuestionSoundNotificationEnabled").getAsBoolean();
        }

        return false;
    }

    /**
     * Set whether the AskUserQuestion reminder sound notification is enabled.
     *
     * @param enabled whether to enable
     */
    public void setAskUserQuestionSoundNotificationEnabled(boolean enabled) throws IOException {
        JsonObject config = readConfig();
        config.addProperty("askUserQuestionSoundNotificationEnabled", enabled);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set ask user question sound notification enabled: " + enabled);
    }

    /**
     * Get whether visual system notifications should only be shown when the IDE is not focused.
     *
     * @return whether only-when-unfocused is enabled, default is false
     */
    public boolean getSystemNotificationOnlyWhenUnfocused() throws IOException {
        JsonObject config = readConfig();

        if (config.has("systemNotificationOnlyWhenUnfocused")
                && !config.get("systemNotificationOnlyWhenUnfocused").isJsonNull()) {
            return config.get("systemNotificationOnlyWhenUnfocused").getAsBoolean();
        }

        return false;
    }

    /**
     * Set whether visual system notifications should only be shown when the IDE is not focused.
     *
     * @param enabled whether to enable
     */
    public void setSystemNotificationOnlyWhenUnfocused(boolean enabled) throws IOException {
        JsonObject config = readConfig();
        config.addProperty("systemNotificationOnlyWhenUnfocused", enabled);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set system notification only when unfocused: " + enabled);
    }

    // ==================== AI Feature Toggle Management ====================

    /**
     * Get whether AI commit message generation is enabled.
     *
     * @return whether commit generation is enabled, default is true
     */
    public boolean getCommitGenerationEnabled() throws IOException {
        JsonObject config = readConfig();

        if (config.has("commitGenerationEnabled") && !config.get("commitGenerationEnabled").isJsonNull()) {
            return config.get("commitGenerationEnabled").getAsBoolean();
        }

        return true;
    }

    /**
     * Set whether AI commit message generation is enabled.
     *
     * @param enabled whether to enable
     */
    public void setCommitGenerationEnabled(boolean enabled) throws IOException {
        JsonObject config = readConfig();
        config.addProperty("commitGenerationEnabled", enabled);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set commit generation enabled: " + enabled);
    }

    /**
     * Get whether status bar widget is enabled.
     *
     * @return whether status bar widget is enabled, default is true
     */
    public boolean getStatusBarWidgetEnabled() throws IOException {
        JsonObject config = readConfig();

        if (config.has("statusBarWidgetEnabled") && !config.get("statusBarWidgetEnabled").isJsonNull()) {
            return config.get("statusBarWidgetEnabled").getAsBoolean();
        }

        return true;
    }

    /**
     * Set whether status bar widget is enabled.
     *
     * @param enabled whether to enable
     */
    public void setStatusBarWidgetEnabled(boolean enabled) throws IOException {
        JsonObject config = readConfig();
        config.addProperty("statusBarWidgetEnabled", enabled);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set status bar widget enabled: " + enabled);
    }

    /**
     * Get whether AI session title generation is enabled.
     *
     * @return whether AI title generation is enabled, default is true
     */
    public boolean getAiTitleGenerationEnabled() throws IOException {
        JsonObject config = readConfig();

        if (config.has("aiTitleGenerationEnabled") && !config.get("aiTitleGenerationEnabled").isJsonNull()) {
            return config.get("aiTitleGenerationEnabled").getAsBoolean();
        }

        return true;
    }

    /**
     * Set whether AI session title generation is enabled.
     *
     * @param enabled whether to enable
     */
    public void setAiTitleGenerationEnabled(boolean enabled) throws IOException {
        JsonObject config = readConfig();
        config.addProperty("aiTitleGenerationEnabled", enabled);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set AI title generation enabled: " + enabled);
    }

    // ==================== Managed Memory Config Management ====================

    private static final String MANAGED_MEMORY_KEY = "managedMemoryEnabled";
    private static final String MANAGED_MEMORY_PROJECTION_FILE = "managed-memory.json";

    /**
     * Get the GUI-side managed auto-memory switch (方案 G).
     *
     * <p>Default {@code false}: headless turns block on managed auto-memory
     * tasks before emitting {@code result}, so memory stays off unless the
     * user opts in here. Interactive Qwen CLI is unaffected either way.
     *
     * @return whether managed auto-memory is enabled for GUI-spawned CLI processes
     */
    public boolean getManagedMemoryEnabled() throws IOException {
        JsonObject config = readConfig();
        boolean enabled = config.has(MANAGED_MEMORY_KEY)
                && !config.get(MANAGED_MEMORY_KEY).isJsonNull()
                && config.get(MANAGED_MEMORY_KEY).getAsBoolean();
        // Self-heal the projection (upgrade, manual deletion) so the UI state
        // and the Node bridge's env injection cannot drift apart.
        syncManagedMemoryProjection(enabled);
        return enabled;
    }

    /**
     * Set the GUI-side managed auto-memory switch and its Node projection.
     *
     * @param enabled whether managed auto-memory is enabled
     */
    public void setManagedMemoryEnabled(boolean enabled) throws IOException {
        JsonObject config = readConfig();
        config.addProperty(MANAGED_MEMORY_KEY, enabled);
        writeConfig(config);
        syncManagedMemoryProjection(enabled);
        LOG.info("[QwenMateSettings] Set managed memory enabled: " + enabled);
    }

    /**
     * Project the toggle to {@code ~/.qwenmate/managed-memory.json} — the Node
     * bridge reads that file to decide whether to inject
     * {@code QWEN_CODE_SYSTEM_DEFAULTS_PATH} into the CLI spawn env (it never
     * reads config.json). Best-effort: on failure the safe default (memory off,
     * Node-side) stays in effect.
     */
    private void syncManagedMemoryProjection(boolean enabled) {
        try {
            Path dir = pathManager.getConfigDir();
            Files.createDirectories(dir);
            Path projection = dir.resolve(MANAGED_MEMORY_PROJECTION_FILE);
            String content = "{\"managedMemoryEnabled\":" + enabled + "}\n";
            String current = Files.exists(projection)
                    ? Files.readString(projection, StandardCharsets.UTF_8)
                    : null;
            if (content.equals(current)) {
                return;
            }
            Path temp = Files.createTempFile(dir, "managed-memory-", ".tmp");
            try {
                Files.writeString(temp, content, StandardCharsets.UTF_8);
                try {
                    Files.move(temp, projection, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException ignored) {
                    Files.move(temp, projection, StandardCopyOption.REPLACE_EXISTING);
                }
            } finally {
                Files.deleteIfExists(temp);
            }
            LOG.info("[QwenMateSettings] Synced managed-memory projection: " + enabled);
        } catch (Exception e) {
            LOG.warn("[QwenMateSettings] Failed to sync managed-memory projection: " + e.getMessage());
        }
    }

    // ==================== Prompt Enhancer Config Management ====================

    /**
     * Get prompt enhancer configuration with resolved provider availability.
     *
     * <p>The returned object always includes:
     * <ul>
     *     <li>provider: manual override or null</li>
     *     <li>models: per-provider remembered models</li>
     *     <li>effectiveProvider: resolved runtime provider or null</li>
     *     <li>resolutionSource: manual/auto/unavailable</li>
     *     <li>availability: per-provider availability flags</li>
     * </ul>
     *
     * <p>In auto mode (provider null), resolution prefers {@code preferredProvider}
     * when that CLI is available (typically the current chat session provider),
     * then falls back to Qwen.
     */
    public JsonObject getPromptEnhancerConfig() throws IOException {
        return getPromptEnhancerConfig(null);
    }

    /**
     * Same as {@link #getPromptEnhancerConfig()} but prefers {@code preferredProvider}
     * in auto mode when it is available (e.g. current chat provider).
     */
    public JsonObject getPromptEnhancerConfig(String preferredProvider) throws IOException {
        return getAiFeatureConfig(PROMPT_ENHANCER_KEY, preferredProvider);
    }

    /**
     * Persist prompt enhancer config with a full models map (qwen).
     */
    public void setPromptEnhancerConfig(String provider, JsonObject models) throws IOException {
        setAiFeatureConfig(PROMPT_ENHANCER_KEY, provider, models, "prompt enhancer");
    }

    /**
     * Get commit AI configuration. Auto mode prefers {@code preferredProvider}
     * when available (typically the current chat session provider), then falls
     * back to Qwen — same resolution as prompt enhancer.
     */
    public JsonObject getCommitAiConfig() throws IOException {
        return getCommitAiConfig(null);
    }

    /**
     * Same as {@link #getCommitAiConfig()} but prefers {@code preferredProvider}
     * in auto mode when it is available (e.g. current chat provider).
     */
    public JsonObject getCommitAiConfig(String preferredProvider) throws IOException {
        return getAiFeatureConfig(COMMIT_AI_KEY, preferredProvider);
    }

    public void setCommitAiConfig(String provider, JsonObject models) throws IOException {
        setAiFeatureConfig(COMMIT_AI_KEY, provider, models, "commit AI");
    }

    private JsonObject getAiFeatureConfig(
            String featureKey,
            String preferredProvider
    ) throws IOException {
        JsonObject rootConfig = readConfig();
        JsonObject featureConfig = getAiFeatureRootObject(rootConfig, featureKey);
        String manualProvider = normalizeAiFeatureProvider(
                featureConfig.has(AI_FEATURE_PROVIDER_KEY) && !featureConfig.get(AI_FEATURE_PROVIDER_KEY).isJsonNull()
                        ? featureConfig.get(AI_FEATURE_PROVIDER_KEY).getAsString()
                        : null
        );
        JsonObject models = getNormalizedAiFeatureModels(featureConfig);
        JsonObject availability = buildAiFeatureAvailability();
        ResolvedAiFeatureProvider resolvedProvider = resolveAiFeatureProvider(
                manualProvider, availability, preferredProvider);

        JsonObject response = new JsonObject();
        if (manualProvider == null) {
            response.add(AI_FEATURE_PROVIDER_KEY, JsonNull.INSTANCE);
        } else {
            response.addProperty(AI_FEATURE_PROVIDER_KEY, manualProvider);
        }
        response.add(AI_FEATURE_MODELS_KEY, models);
        if (resolvedProvider.effectiveProvider == null) {
            response.add(AI_FEATURE_EFFECTIVE_PROVIDER_KEY, JsonNull.INSTANCE);
        } else {
            response.addProperty(AI_FEATURE_EFFECTIVE_PROVIDER_KEY, resolvedProvider.effectiveProvider);
        }
        response.addProperty(AI_FEATURE_RESOLUTION_SOURCE_KEY, resolvedProvider.resolutionSource);
        response.add(AI_FEATURE_AVAILABILITY_KEY, availability);
        return response;
    }

    private void setAiFeatureConfig(
            String featureKey,
            String provider,
            JsonObject incomingModels,
            String featureLabel
    ) throws IOException {
        JsonObject config = readConfig();
        JsonObject featureConfig = getAiFeatureRootObject(config, featureKey);
        String normalizedProvider = normalizeAiFeatureProvider(provider);
        if (normalizedProvider == null) {
            featureConfig.add(AI_FEATURE_PROVIDER_KEY, JsonNull.INSTANCE);
        } else {
            featureConfig.addProperty(AI_FEATURE_PROVIDER_KEY, normalizedProvider);
        }

        // Start from previously saved models (so partial updates don't wipe CLI models),
        // then overlay the incoming map, then fill defaults for any missing keys.
        JsonObject merged = getNormalizedAiFeatureModels(featureConfig);
        if (incomingModels != null) {
            for (String key : AI_FEATURE_PROVIDERS) {
                if (incomingModels.has(key) && !incomingModels.get(key).isJsonNull()) {
                    JsonElement el = incomingModels.get(key);
                    if (el.isJsonPrimitive()) {
                        merged.addProperty(key, normalizeAiFeatureModel(el.getAsString(), defaultModelForProvider(key)));
                    }
                }
            }
        }
        featureConfig.add(AI_FEATURE_MODELS_KEY, merged);

        config.add(featureKey, featureConfig);
        writeConfig(config);
        LOG.info("[QwenMateSettings] Set " + featureLabel + " config: provider=" + normalizedProvider);
    }

    private JsonObject getAiFeatureRootObject(JsonObject rootConfig, String featureKey) {
        if (rootConfig.has(featureKey) && rootConfig.get(featureKey).isJsonObject()) {
            return rootConfig.getAsJsonObject(featureKey);
        }
        return new JsonObject();
    }

    private JsonObject buildAiFeatureAvailability() {
        // Stale-while-revalidate: reuse the last probe result and refresh it in
        // the background. Per-tool detect() can spawn processes for up to 5s
        // each — re-probing synchronously after TTL expiry freezes the JCEF UI
        // thread when Settings opens or an enhance is triggered.
        Map<String, CliToolStatus> cliStatuses;
        try {
            cliStatuses = CliStatusDetector.detectAllStaleWhileRevalidate();
        } catch (Exception e) {
            LOG.warn("[QwenMateSettings] Failed to batch-detect CLI tools: " + e.getMessage());
            cliStatuses = Map.of();
        }

        JsonObject availability = new JsonObject();
        for (String provider : AI_FEATURE_PROVIDERS) {
            availability.addProperty(
                    provider,
                    isAiFeatureProviderAvailable(provider, cliStatuses)
            );
        }
        return availability;
    }

    private boolean isAiFeatureProviderAvailable(
            String provider,
            Map<String, CliToolStatus> cliStatuses
    ) {
        try {
            // TODO: availability is probed via CLI presence only, not daemon reachability.
            CliToolStatus status = cliStatuses != null ? cliStatuses.get(provider) : null;
            return status != null && status.isInstalled();
        } catch (Exception e) {
            LOG.warn("[QwenMateSettings] Failed to resolve AI feature availability for " + provider + ": " + e.getMessage());
            return false;
        }
    }

    private JsonObject getNormalizedAiFeatureModels(JsonObject featureConfig) {
        JsonObject defaults = createDefaultAiFeatureModels();
        if (featureConfig == null
                || !featureConfig.has(AI_FEATURE_MODELS_KEY)
                || !featureConfig.get(AI_FEATURE_MODELS_KEY).isJsonObject()) {
            return defaults;
        }
        JsonObject rawModels = featureConfig.getAsJsonObject(AI_FEATURE_MODELS_KEY);
        JsonObject models = new JsonObject();
        for (String provider : AI_FEATURE_PROVIDERS) {
            String fallback = defaultModelForProvider(provider);
            String raw = null;
            if (rawModels.has(provider) && !rawModels.get(provider).isJsonNull()) {
                try {
                    raw = rawModels.get(provider).getAsString();
                } catch (Exception ignored) {
                    raw = null;
                }
            }
            models.addProperty(provider, normalizeAiFeatureModel(raw, fallback));
        }
        return models;
    }

    private JsonObject createDefaultAiFeatureModels() {
        JsonObject models = new JsonObject();
        for (String provider : AI_FEATURE_PROVIDERS) {
            models.addProperty(provider, defaultModelForProvider(provider));
        }
        return models;
    }

    private String defaultModelForProvider(String provider) {
        return DEFAULT_AI_FEATURE_QWEN_MODEL;
    }

    private ResolvedAiFeatureProvider resolveAiFeatureProvider(
            String manualProvider,
            JsonObject availability,
            String preferredProvider
    ) {
        if (manualProvider != null) {
            boolean manualProviderAvailable = availability.has(manualProvider)
                    && availability.get(manualProvider).getAsBoolean();
            if (manualProviderAvailable) {
                return new ResolvedAiFeatureProvider(manualProvider, AI_FEATURE_RESOLUTION_MANUAL);
            }
            return new ResolvedAiFeatureProvider(null, AI_FEATURE_RESOLUTION_UNAVAILABLE);
        }
        // Auto mode: follow current chat provider when available, then Qwen.
        String preferred = normalizeAiFeatureProvider(preferredProvider);
        if (preferred != null
                && availability.has(preferred)
                && availability.get(preferred).getAsBoolean()) {
            return new ResolvedAiFeatureProvider(preferred, AI_FEATURE_RESOLUTION_AUTO);
        }
        for (String provider : AI_FEATURE_PROVIDERS) {
            if (availability.has(provider) && availability.get(provider).getAsBoolean()) {
                return new ResolvedAiFeatureProvider(provider, AI_FEATURE_RESOLUTION_AUTO);
            }
        }
        return new ResolvedAiFeatureProvider(null, AI_FEATURE_RESOLUTION_UNAVAILABLE);
    }

    private String normalizeAiFeatureProvider(String provider) {
        if (provider == null) {
            return null;
        }
        String normalized = provider.trim().toLowerCase();
        if (normalized.isEmpty()) {
            return null;
        }
        for (String known : AI_FEATURE_PROVIDERS) {
            if (known.equals(normalized)) {
                return normalized;
            }
        }
        return null;
    }

    private String normalizeAiFeatureModel(String model, String defaultValue) {
        if (model == null) {
            return defaultValue;
        }
        // Empty is a legal value ("follow CLI config"); only collapse to the
        // default when the caller did not provide a value at all.
        String normalized = model.trim();
        return normalized.isEmpty() && model.isEmpty() ? defaultValue : normalized;
    }

    private static class ResolvedAiFeatureProvider {
        private final String effectiveProvider;
        private final String resolutionSource;

        private ResolvedAiFeatureProvider(String effectiveProvider, String resolutionSource) {
            this.effectiveProvider = effectiveProvider;
            this.resolutionSource = resolutionSource;
        }
    }

    // ==================== User Model Metadata Management ====================

    /**
     * Persist user-configured model pricing for a provider family, replacing the whole map.
     *
     * @param provider {@code "qwen"}
     * @param pricing  map of model ID → pricing; empty or null clears the provider entry
     */
    public void setCustomModelPricing(String provider, Map<String, ModelPricing> pricing) throws IOException {
        JsonObject config = readConfig();

        JsonObject root;
        if (config.has("customModelPricing") && config.get("customModelPricing").isJsonObject()) {
            root = config.getAsJsonObject("customModelPricing");
        } else {
            root = new JsonObject();
            config.add("customModelPricing", root);
        }

        if (pricing == null || pricing.isEmpty()) {
            root.remove(provider);
        } else {
            JsonObject providerNode = new JsonObject();
            for (Map.Entry<String, ModelPricing> entry : pricing.entrySet()) {
                providerNode.add(entry.getKey(), serializeModelPricing(entry.getValue()));
            }
            root.add(provider, providerNode);
        }

        writeConfig(config);
        LOG.info("[QwenMateSettings] Set user model pricing for " + provider
                + ": " + (pricing == null ? 0 : pricing.size()) + " models");
    }

    private JsonObject serializeModelPricing(ModelPricing pricing) {
        JsonObject node = new JsonObject();
        if (isValidPrice(pricing.inputCostPer1M())) {
            node.addProperty("inputCostPer1M", pricing.inputCostPer1M());
        }
        if (isValidPrice(pricing.outputCostPer1M())) {
            node.addProperty("outputCostPer1M", pricing.outputCostPer1M());
        }
        if (isValidPrice(pricing.cacheWriteCostPer1M())) {
            node.addProperty("cacheWriteCostPer1M", pricing.cacheWriteCostPer1M());
        }
        if (isValidPrice(pricing.cacheReadCostPer1M())) {
            node.addProperty("cacheReadCostPer1M", pricing.cacheReadCostPer1M());
        }
        return node;
    }

    private static boolean isValidPrice(Double value) {
        return value != null && Double.isFinite(value) && value >= 0;
    }
}
