package com.qwenmate.action;

import com.intellij.openapi.project.Project;
import org.junit.Assert;
import org.junit.Test;

public class SaveAsTemplateActionTest {

    @Test
    public void handleNoActiveSessionShowsErrorDialog() {
        TrackingSaveAsTemplateAction action = new TrackingSaveAsTemplateAction();
        action.handleNoActiveSession(null);
        Assert.assertTrue(action.errorShown);
    }

    private static final class TrackingSaveAsTemplateAction extends SaveAsTemplateAction {
        private boolean errorShown = false;

        @Override
        protected void showErrorDialog(Project project, String message, String title) {
            errorShown = true;
        }
    }
}

