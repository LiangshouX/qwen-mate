package com.qwenmate.action;

import com.intellij.ide.BrowserUtil;
import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.qwenmate.i18n.QwenMateBundle;
import org.jetbrains.annotations.NotNull;

/**
 * Opens the QwenMate documentation site from the tool window title bar.
 * Like {@link RestartWebviewAction} this is plain Swing, so the docs entry
 * stays available while the webview itself renders nothing.
 */
public class OpenDocumentationAction extends AnAction {

    private static final String DOCS_SITE_URL = "https://liangshoux.github.io/qwen-mate/";

    public OpenDocumentationAction() {
        super(
                QwenMateBundle.message("action.openDocs.text"),
                QwenMateBundle.message("action.openDocs.description"),
                null
        );
    }

    @Override
    public @NotNull ActionUpdateThread getActionUpdateThread() {
        return ActionUpdateThread.BGT;
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        BrowserUtil.browse(DOCS_SITE_URL);
    }
}
