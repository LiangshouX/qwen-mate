package com.qwenmate.action;

import com.qwenmate.ui.toolwindow.QwenMateChatWindow;
import com.intellij.openapi.actionSystem.AnActionEvent;
import org.jetbrains.annotations.NotNull;
import com.intellij.openapi.project.Project;

/**
 * IDEA Action for send message in the QwenMate chat tool window.
 * Shortcut is dynamically managed: Ctrl+Enter when sendShortcut=cmdEnter, removed when enter mode.
 */
public class ChatSendAction extends ChatToolWindowAction {

    public static final String ACTION_ID = "QwenMate.ChatSendAction";

    @Override
    protected void performAction(@NotNull AnActionEvent e, @NotNull Project project, @NotNull QwenMateChatWindow chatWindow) {
        chatWindow.executeJavaScriptCode("if(window.execContextAction) window.execContextAction('send')");
    }
}
