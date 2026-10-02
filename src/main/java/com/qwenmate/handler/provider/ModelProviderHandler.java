package com.qwenmate.handler.provider;

import com.qwenmate.handler.UsagePushService;
import com.qwenmate.handler.core.HandlerContext;

import com.qwenmate.session.SessionState;
import com.qwenmate.settings.QwenCliConfigReader;
import com.qwenmate.skill.SlashCommandRegistry;
import com.qwenmate.provider.CustomModelContextWindowProvider;
import com.qwenmate.notifications.QwenMateNotifier;
import com.qwenmate.util.EditorFileUtils;
import com.qwenmate.util.TokenUsageUtils;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.util.concurrency.AppExecutorUtil;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.OptionalInt;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Handles model and provider selection, reasoning effort, and slash command refresh.
 */
public class ModelProviderHandler {

    private static final Logger LOG = Logger.getInstance(ModelProviderHandler.class);

    static final Map<String, Integer> MODEL_CONTEXT_LIMITS = new HashMap<>();
    static {
        // Qwen models
        MODEL_CONTEXT_LIMITS.put("qwen", 1_000_000);
    }

    private final HandlerContext context;
    private final UsagePushService usagePushService;
    private final Gson gson = new Gson();

    public ModelProviderHandler(HandlerContext context, UsagePushService usagePushService) {
        this.context = context;
        this.usagePushService = usagePushService;
    }

    public void handleSetModel(String content) {
        try {
            String model = content;
            if (content != null && !content.isEmpty()) {
                try {
                    JsonObject json = gson.fromJson(content, JsonObject.class);
                    if (json.has("model")) {
                        model = json.get("model").getAsString();
                    }
                } catch (Exception e) {
                    // content itself is the model
                }
            }

            String previousModel = resolveCurrentSessionModel(context);
            boolean modelChanged = isActualModelSwitch(previousModel, model);
            LOG.info("[ModelProviderHandler] Setting model to: " + model
                    + " (was: " + previousModel + ")");
            context.setCurrentModel(model);

            if (context.getSession() != null) {
                context.getSession().setModel(model);
                if (modelChanged) {
                    clearSessionUsage();
                }
                LOG.info("[ModelProviderHandler] Updated session model to canonical ID: " + model);
            }

            if (modelChanged) {
                usagePushService.clearUsageDisplay();
            }

            if (context.getProject() != null) {
                QwenMateNotifier.setModel(context.getProject(), model);
            }

            String provider = context.getCurrentProvider();
            int newMaxTokens = getModelContextLimit(provider, model);
            LOG.info("[ModelProviderHandler] Model context limit: " + newMaxTokens
                    + " tokens for selected model: " + model);

            final String confirmedModel = model;
            final String confirmedProvider = context.getCurrentProvider();
            Runnable confirmModel = () -> {
                context.callJavaScript("window.onModelConfirmed", context.escapeJs(confirmedModel), context.escapeJs(confirmedProvider));
                if (modelChanged) {
                    usagePushService.pushUsageUpdateAfterModelChange(newMaxTokens);
                }
            };
            if (ApplicationManager.getApplication() != null) {
                ApplicationManager.getApplication().invokeLater(confirmModel);
            } else {
                // Plain unit tests have no IntelliJ Application; keep the state
                // transition testable without changing the IDE's EDT behavior.
                confirmModel.run();
            }
        } catch (Exception e) {
            LOG.error("[ModelProviderHandler] Failed to set model: " + e.getMessage(), e);
        }
    }

    public void handleSetProvider(String content) {
        try {
            String provider = content;
            if (content != null && !content.isEmpty()) {
                try {
                    JsonObject json = gson.fromJson(content, JsonObject.class);
                    if (json.has("provider")) {
                        provider = json.get("provider").getAsString();
                    }
                } catch (Exception e) {
                    // content itself is the provider
                }
            }

            // Capture previous provider BEFORE mutating context so we can detect
            // a real provider change.
            String previousProvider = context.getCurrentProvider();
            boolean providerChanged = isActualProviderSwitch(previousProvider, provider);
            LOG.info("[ModelProviderHandler] Setting provider to: " + provider
                    + " (was: " + previousProvider + ")");
            context.setCurrentProvider(provider);

            if (context.getSession() != null) {
                context.getSession().setProvider(provider);
                if (providerChanged) {
                    clearSessionUsage();
                }
            }

            if (providerChanged) {
                usagePushService.clearUsageDisplay();
            }

            refreshSlashCommandsForProvider(provider);
            usagePushService.refreshContextBar();
        } catch (Exception e) {
            LOG.error("[ModelProviderHandler] Failed to set provider: " + e.getMessage(), e);
        }
    }

    /**
     * Return whether a provider command represents a real cross-provider switch.
     * Null/empty initialization values and same-provider reaffirmations are no-ops.
     */
    static boolean isActualProviderSwitch(String previousProvider, String newProvider) {
        return previousProvider != null
                && newProvider != null
                && !previousProvider.isEmpty()
                && !newProvider.isEmpty()
                && !previousProvider.equals(newProvider);
    }

    /**
     * Return whether a model command represents a real model transition.
     * Null/empty initialization values and same-model reaffirmations are no-ops.
     */
    static boolean isActualModelSwitch(String previousModel, String newModel) {
        return previousModel != null
                && newModel != null
                && !previousModel.isEmpty()
                && !newModel.isEmpty()
                && !previousModel.equals(newModel);
    }

    /**
     * Resolve the authoritative model before processing a frontend model command.
     * A restored session may already own the saved model while the handler context
     * still contains its startup default, so session state takes precedence.
     */
    static String resolveCurrentSessionModel(HandlerContext context) {
        if (context != null && context.getSession() != null) {
            String sessionModel = context.getSession().getModel();
            if (sessionModel != null && !sessionModel.isEmpty()) {
                return sessionModel;
            }
        }
        return context == null ? null : context.getCurrentModel();
    }

    // TODO: daemon shutdown on provider switch removed in the qwen/dsh convergence (only one SDK bridge remains)

    public void handleSetReasoningEffort(String content) {
        try {
            String effort = content;
            if (content != null && !content.isEmpty()) {
                try {
                    JsonObject json = gson.fromJson(content, JsonObject.class);
                    if (json.has("reasoningEffort")) {
                        effort = json.get("reasoningEffort").getAsString();
                    }
                } catch (Exception e) {
                    // content itself is the effort
                }
            }

            LOG.info("[ModelProviderHandler] Setting reasoning effort to: " + effort);

            if (context.getSession() != null) {
                context.getSession().setReasoningEffort(effort);
            }
        } catch (Exception e) {
            LOG.error("[ModelProviderHandler] Failed to set reasoning effort: " + e.getMessage(), e);
        }
    }

    private void refreshSlashCommandsForProvider(String provider) {
        String cwd = null;
        if (context.getSession() != null) {
            cwd = context.getSession().getCwd();
        }
        if (cwd == null) {
            cwd = context.getProject().getBasePath();
        }

        final String finalCwd = cwd;
        CompletableFuture.runAsync(() -> {
            String currentFilePath = EditorFileUtils.getCurrentEditorFilePath(context.getProject());
            var commands = SlashCommandRegistry.getCommands(provider, finalCwd, currentFilePath);
            String json = SlashCommandRegistry.toJson(commands);

            ApplicationManager.getApplication().invokeLater(() -> {
                try {
                    context.callJavaScript("updateSlashCommands", context.escapeJs(json));
                } catch (Exception e) {
                    LOG.warn("[ModelProviderHandler] Failed to refresh slash commands: " + e.getMessage());
                }
            });
        }, AppExecutorUtil.getAppExecutorService()).exceptionally(ex -> {
            LOG.error("[ModelProviderHandler] Failed to refresh slash commands asynchronously: " + ex.getMessage(), ex);
            return null;
        });
    }

    public static int getModelContextLimit(String model) {
        String effectiveModel = model;
        if (effectiveModel == null || effectiveModel.isEmpty()) {
            // "Follow CLI config" — resolve the model the CLI actually runs so its
            // configured/built-in context window is used instead of the default.
            effectiveModel = QwenCliConfigReader.getConfiguredModelName();
        }
        if (effectiveModel == null || effectiveModel.isEmpty()) {
            return 200_000;
        }

        Pattern pattern = Pattern.compile("\\s*\\[([0-9.]+)([kKmM])\\]\\s*$");
        Matcher matcher = pattern.matcher(effectiveModel);

        if (matcher.find()) {
            try {
                double value = Double.parseDouble(matcher.group(1));
                String unit = matcher.group(2).toLowerCase();

                if ("m".equals(unit)) {
                    return (int)(value * 1_000_000);
                } else if ("k".equals(unit)) {
                    return (int)(value * 1_000);
                }
            } catch (NumberFormatException e) {
                LOG.error("Failed to parse capacity from model name: " + effectiveModel);
            }
        }

        // Explicit per-model window from ~/.qwen/settings.json
        // (modelProviders[].generationConfig.contextWindowSize).
        OptionalInt configured = QwenCliConfigReader.findContextWindowSize(effectiveModel);
        if (configured.isPresent()) {
            return configured.getAsInt();
        }

        return MODEL_CONTEXT_LIMITS.getOrDefault(effectiveModel, builtinQwenContextLimit(effectiveModel));
    }

    /**
     * Context windows for models the Qwen Code CLI knows natively (mirrors its
     * tokenLimits table), used when neither the model name suffix nor the CLI
     * settings declare a window.
     */
    static int builtinQwenContextLimit(String model) {
        String normalized = model.trim().toLowerCase(Locale.ROOT);
        // Commercial API models with 1M context
        if (normalized.startsWith("qwen3-coder-plus")
                || normalized.startsWith("qwen3-coder-flash")
                || normalized.matches("^qwen3\\.\\d.*")
                || normalized.equals("qwen-plus-latest")
                || normalized.equals("qwen-flash-latest")
                || normalized.equals("coder-model")) {
            return 1_000_000;
        }
        // 256K families (qwen3-max, other qwen3-coder variants, generic qwen fallback)
        if (normalized.startsWith("qwen3-max")
                || normalized.startsWith("qwen3-coder-")
                || normalized.startsWith("qwen")) {
            return 256_000;
        }
        return 200_000;
    }

    public static int getModelContextLimit(String provider, String model) {
        return CustomModelContextWindowProvider.getInstance()
                .getContextWindow(provider, model)
                .orElseGet(() -> getModelContextLimit(model));
    }

    private void clearSessionUsage() {
        // Both call sites already verified the session is non-null.
        SessionState state = context.getSession().getState();
        synchronized (state.getMessageStateLock()) {
            TokenUsageUtils.clearContextUsageFromSessionMessages(state.getMessagesReference());
        }
    }

}
