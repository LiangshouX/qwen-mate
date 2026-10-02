package com.qwenmate.handler.core;

import com.qwenmate.session.QwenMateSession;
import com.qwenmate.provider.qwen.QwenSDKBridge;
import com.qwenmate.settings.QwenMateSettingsService;
import com.intellij.openapi.project.Project;
import com.intellij.ui.jcef.JBCefBrowser;

import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/**
 * Handler context.
 * Provides all shared resources and callbacks needed by handlers.
 */
public class HandlerContext {

    public static final String DEFAULT_MODEL = "";
    public static final String DEFAULT_PROVIDER = "qwen";

    private final Project project;
    private final QwenSDKBridge qwenSDKBridge;
    private final QwenMateSettingsService settingsService;
    private final JsCallback jsCallback;
    private final BooleanSupplier activeContentSupplier;
    private final Supplier<String> contentTitleSupplier;
    private volatile Runnable contentActivator = () -> { };

    // Mutable state accessed via getters/setters — volatile for thread safety
    private volatile QwenMateSession session;
    private volatile JBCefBrowser browser;
    private volatile String currentModel = DEFAULT_MODEL;
    private volatile String currentProvider = DEFAULT_PROVIDER;
    private volatile boolean disposed = false;

    /**
     * JavaScript callback interface.
     */
    public interface JsCallback {
        void callJavaScript(String functionName, String... args);
        String escapeJs(String str);

        default void executeJavaScript(String jsCode) {
        }
    }

    public HandlerContext(
            Project project,
            QwenSDKBridge qwenSDKBridge,
            QwenMateSettingsService settingsService,
            JsCallback jsCallback
    ) {
        this(project, qwenSDKBridge, settingsService, jsCallback, () -> true, () -> null);
    }

    public HandlerContext(
            Project project,
            QwenSDKBridge qwenSDKBridge,
            QwenMateSettingsService settingsService,
            JsCallback jsCallback,
            BooleanSupplier activeContentSupplier,
            Supplier<String> contentTitleSupplier
    ) {
        this.project = project;
        this.qwenSDKBridge = qwenSDKBridge;
        this.settingsService = settingsService;
        this.jsCallback = jsCallback;
        this.activeContentSupplier = activeContentSupplier == null ? () -> true : activeContentSupplier;
        this.contentTitleSupplier = contentTitleSupplier == null ? () -> null : contentTitleSupplier;
    }

    // Getters
    public Project getProject() {
        return project;
    }

    public QwenSDKBridge getQwenSDKBridge() {
        return qwenSDKBridge;
    }

    public QwenMateSettingsService getSettingsService() {
        return settingsService;
    }

    /**
     * Resolve the normalized effective working directory for the current project —
     * the custom working directory when configured and valid, otherwise the project
     * base path. This is the directory Claude runs in and the key history is stored
     * under, so history readers must use this instead of the raw base path.
     *
     * <p>Null-safe: returns the raw base path when no settings service is wired.
     */
    public String resolveEffectiveWorkingDirectory() {
        String basePath = project != null ? project.getBasePath() : null;
        if (settingsService == null) {
            return basePath;
        }
        return settingsService.getEffectiveWorkingDirectory(basePath);
    }

    public QwenMateSession getSession() {
        return session;
    }

    public JBCefBrowser getBrowser() {
        return browser;
    }

    public String getCurrentModel() {
        return currentModel;
    }

    public String getCurrentProvider() {
        return currentProvider;
    }

    public boolean isDisposed() {
        return disposed;
    }

    public boolean isActiveContent() {
        try {
            return activeContentSupplier.getAsBoolean();
        } catch (RuntimeException e) {
            return true;
        }
    }

    public String getContentTitle() {
        try {
            return contentTitleSupplier.get();
        } catch (RuntimeException e) {
            return null;
        }
    }

    public void activateContent() {
        if (!disposed) {
            contentActivator.run();
        }
    }

    // Setters
    public void setSession(QwenMateSession session) {
        this.session = session;
    }

    public void setBrowser(JBCefBrowser browser) {
        this.browser = browser;
    }

    public void setCurrentModel(String currentModel) {
        this.currentModel = currentModel;
    }

    public void setCurrentProvider(String currentProvider) {
        this.currentProvider = currentProvider;
    }

    public void setDisposed(boolean disposed) {
        this.disposed = disposed;
    }

    public void setContentActivator(Runnable contentActivator) {
        this.contentActivator = contentActivator == null ? () -> { } : contentActivator;
    }

    // JavaScript callback proxy methods
    public void callJavaScript(String functionName, String... args) {
        jsCallback.callJavaScript(functionName, args);
    }

    public String escapeJs(String str) {
        return jsCallback.escapeJs(str);
    }

    /**
     * Execute JavaScript through the window's ordered webview event queue
     * (which marshals to the EDT and batches with callback events).
     */
    public void executeJavaScriptQueued(String jsCode) {
        if (this.disposed || this.jsCallback == null) {
            return;
        }
        this.jsCallback.executeJavaScript(jsCode);
    }
}
