package com.qwenmate.action;

import com.qwenmate.i18n.QwenMateBundle;
import com.qwenmate.model.SessionTemplate;
import com.qwenmate.session.QwenMateSession;
import com.qwenmate.settings.SessionTemplateService;
import com.qwenmate.ui.toolwindow.QwenMateChatWindow;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

/**
 * Action to save the current session configuration as a reusable template.
 */
public class SaveAsTemplateAction extends ChatToolWindowAction {

    private static final Logger LOG = Logger.getInstance(SaveAsTemplateAction.class);

    public SaveAsTemplateAction() {
        super();
        getTemplatePresentation().setText(QwenMateBundle.message("action.saveAsTemplate.text"));
        getTemplatePresentation().setDescription(QwenMateBundle.message("action.saveAsTemplate.description"));
    }

    @Override
    protected void performAction(@NotNull AnActionEvent e, @NotNull Project project, @NotNull QwenMateChatWindow chatWindow) {
        QwenMateSession session = chatWindow.getSession();
        if (session == null) {
            handleNoActiveSession(project);
            return;
        }

        // Get template name from user
        String templateName = showInputDialog(
                project,
                QwenMateBundle.message("template.save.name.prompt"),
                QwenMateBundle.message("template.save.name.title")
        );

        if (templateName == null || templateName.trim().isEmpty()) {
            return; // User cancelled
        }

        templateName = templateName.trim();

        // Check if template already exists
        SessionTemplateService templateService = SessionTemplateService.getInstance();
        if (templateService.templateExists(templateName)) {
            int result = showOverwriteDialog(
                    project,
                    QwenMateBundle.message("template.save.overwrite.prompt", templateName),
                    QwenMateBundle.message("template.save.overwrite.title")
            );
            if (result != Messages.YES) {
                return; // User chose not to overwrite
            }
        }

        // Create template from current session state
        SessionTemplate template = new SessionTemplate(
            templateName,
            session.getProvider(),
            session.getModel(),
            session.getPermissionMode(),
            session.getReasoningEffort(),
            session.getCwd(),
            session.getState().isPsiContextEnabled()
        );

        // Save template
        templateService.saveTemplate(template);

        showInfoMessage(
                project,
                QwenMateBundle.message("template.save.success", templateName),
                QwenMateBundle.message("template.save.success.title")
        );

        LOG.info("Saved session template: " + templateName);
    }

    void handleNoActiveSession(Project project) {
        showErrorDialog(
                project,
                QwenMateBundle.message("template.save.error.noSession"),
                QwenMateBundle.message("template.save.error.title")
        );
    }

    protected void showErrorDialog(Project project, String message, String title) {
        Messages.showErrorDialog(project, message, title);
    }

    protected String showInputDialog(Project project, String prompt, String title) {
        return Messages.showInputDialog(project, prompt, title, Messages.getQuestionIcon(), "", null);
    }

    protected int showOverwriteDialog(Project project, String prompt, String title) {
        return Messages.showYesNoDialog(project, prompt, title, Messages.getQuestionIcon());
    }

    protected void showInfoMessage(Project project, String message, String title) {
        Messages.showInfoMessage(project, message, title);
    }
}
