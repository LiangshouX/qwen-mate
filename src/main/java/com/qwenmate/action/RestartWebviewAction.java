package com.qwenmate.action;

import com.qwenmate.i18n.QwenMateBundle;
import com.qwenmate.ui.toolwindow.QwenMateChatWindow;
import com.qwenmate.ui.toolwindow.QwenMateToolWindow;
import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.ui.content.Content;
import org.jetbrains.annotations.NotNull;

/**
 * Rebuilds the selected tab's webview from the tool window title bar.
 * The title bar is plain Swing, so this stays clickable while the JCEF
 * page renders nothing — the only recovery path a white screen leaves
 * the user when the watchdog has exhausted its startup retry budget.
 */
public class RestartWebviewAction extends AnAction {

    public RestartWebviewAction() {
        super(
                QwenMateBundle.message("action.restartWebview.text"),
                QwenMateBundle.message("action.restartWebview.description"),
                null
        );
    }

    @Override
    public @NotNull ActionUpdateThread getActionUpdateThread() {
        return ActionUpdateThread.BGT;
    }

    @Override
    public void update(@NotNull AnActionEvent e) {
        e.getPresentation().setEnabled(e.getProject() != null);
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) {
            return;
        }
        ToolWindow toolWindow = ToolWindowManager.getInstance(project)
                .getToolWindow(QwenMateToolWindow.TOOL_WINDOW_ID);
        if (toolWindow == null) {
            return;
        }
        Content selectedContent = toolWindow.getContentManager().getSelectedContent();
        QwenMateChatWindow window = QwenMateToolWindow.getChatWindowForContent(selectedContent);
        if (window == null) {
            window = QwenMateToolWindow.getChatWindow(project);
        }
        if (window == null || window.isDisposed()) {
            return;
        }
        window.restartWebview();
    }
}
