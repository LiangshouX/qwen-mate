package com.qwenmate.handler;

import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.application.ReadAction;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.util.concurrency.AppExecutorUtil;
import com.qwenmate.bridge.NodeDetector;

/**
 * Opens a file in the IDE editor from a background handler thread.
 * Shared by skill and command open requests.
 */
final class EditorFileOpener {

    private static final Logger LOG = Logger.getInstance(EditorFileOpener.class);

    private EditorFileOpener() {
    }

    static void open(Project project, String filePath) {
        // Resolve the VFS file in a background thread (this is a slow operation)
        ReadAction
            .nonBlocking(() -> LocalFileSystem.getInstance().findFileByPath(NodeDetector.toVfsPath(filePath)))
            .finishOnUiThread(ModalityState.defaultModalityState(), virtualFile -> {
                if (virtualFile != null) {
                    // OpenFileDescriptor#navigate is the replacement for the deprecated
                    // synchronous openFile(VirtualFile, boolean). It keeps the focus
                    // request the old call had (requestFocus = true) and exists
                    // unchanged from 2023.3 (233) through 2026.3 (263).
                    new OpenFileDescriptor(project, virtualFile).navigate(true);
                } else {
                    LOG.error("[EditorFileOpener] Cannot find file: " + filePath);
                }
            })
            .submit(AppExecutorUtil.getAppExecutorService());
    }
}
