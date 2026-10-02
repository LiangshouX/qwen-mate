package com.qwenmate.action;

import com.qwenmate.i18n.QwenMateBundle;
import com.qwenmate.model.SessionTemplate;
import com.qwenmate.ui.TemplateSelectionDialog;
import com.qwenmate.ui.toolwindow.QwenMateChatWindow;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

/**
 * Action to create a new session from a saved template.
 */
public class CreateFromTemplateAction extends ChatToolWindowAction {

    private static final Logger LOG = Logger.getInstance(CreateFromTemplateAction.class);

    public CreateFromTemplateAction() {
        super();
        getTemplatePresentation().setText(QwenMateBundle.message("action.createFromTemplate.text"));
        getTemplatePresentation().setDescription(QwenMateBundle.message("action.createFromTemplate.description"));
    }

    @Override
    protected void performAction(@NotNull AnActionEvent e, @NotNull Project project, @NotNull QwenMateChatWindow chatWindow) {
        // Show template selection dialog
        TemplateSelectionDialog dialog = new TemplateSelectionDialog();
        if (!dialog.showAndGet()) {
            return; // User cancelled
        }

        SessionTemplate selectedTemplate = dialog.getSelectedTemplate();
        if (selectedTemplate == null) {
            return; // No template selected
        }

        // Create new session from template in current window
        chatWindow.getSessionLifecycleManager().createNewSessionFromTemplate(selectedTemplate);

        LOG.info("[CreateFromTemplateAction] Created new session from template: " + selectedTemplate.getName());
    }
}
