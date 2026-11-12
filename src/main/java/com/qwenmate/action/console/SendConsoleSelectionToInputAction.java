package com.qwenmate.action.console;

import com.qwenmate.i18n.QwenMateBundle;
import com.qwenmate.util.SelectionTextUtils;
import com.intellij.execution.impl.ConsoleViewImpl;
import com.intellij.execution.ui.ConsoleView;
import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.DataKey;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

public class SendConsoleSelectionToInputAction extends AnAction implements DumbAware {

    private static final Logger LOG = Logger.getInstance(SendConsoleSelectionToInputAction.class);

    // Cache reflective Method lookup to avoid repeated getMethod() on EDT hot path.
    // Uses Optional to safely cache "not found" results (ConcurrentHashMap doesn't allow null values).
    private static final Map<Class<?>, Optional<Method>> EDITOR_METHOD_CACHE = new ConcurrentHashMap<>();

    /**
     * Holder classes of the console view {@code DataKey}, probed in order.
     *
     * <p>2026.3 (263) deprecated {@code LangDataKeys.CONSOLE_VIEW} and moved the key to
     * {@code ExecutionDataKeys.CONSOLE_VIEW}; but {@code ExecutionDataKeys} only carries the
     * field from 263 on - in 2023.3 (233) it only has {@code EXECUTION_ENVIRONMENT}. A direct
     * field reference therefore cannot satisfy both ends of the supported range: it would be
     * a deprecation warning on 263 and a {@code NoSuchFieldError} on 233.
     *
     * <p>Resolving the field reflectively keeps the bytecode free of any field reference
     * (the verifier then has nothing to complain about) while still working on every
     * supported IDE version.</p>
     */
    private static final String[] CONSOLE_VIEW_KEY_OWNERS = {
        "com.intellij.openapi.actionSystem.ExecutionDataKeys",
        "com.intellij.openapi.actionSystem.LangDataKeys",
    };

    /** {@code null} when the key cannot be found on the running IDE. */
    private static final DataKey<Object> CONSOLE_VIEW_KEY = resolveConsoleViewKey(CONSOLE_VIEW_KEY_OWNERS);

    public SendConsoleSelectionToInputAction() {
        super(
                QwenMateBundle.message("action.sendConsoleSelection.text"),
                QwenMateBundle.message("action.sendConsoleSelection.description"),
                null
        );
    }

    @Override
    public @NotNull ActionUpdateThread getActionUpdateThread() {
        return ActionUpdateThread.EDT;
    }

    @Override
    public void update(@NotNull AnActionEvent e) {
        e.getPresentation().setEnabledAndVisible(resolveSelectedText(e) != null);
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        String selectedText = resolveSelectedText(e);
        if (project == null || selectedText == null) {
            return;
        }
        SelectionTextUtils.sendToChatWindow(project, selectedText);
    }

    private static @Nullable String resolveSelectedText(@NotNull AnActionEvent e) {
        DataKey<Object> consoleViewKey = CONSOLE_VIEW_KEY;
        if (consoleViewKey == null) {
            // No console view key on this IDE version - nothing to read.
            return null;
        }
        return resolveSelectedText(e.getData(consoleViewKey));
    }

    /**
     * Look up the console view {@code DataKey} in the given holder classes, in order.
     *
     * @param ownerClassNames fully qualified names of the classes that may declare the key
     * @return the key, or {@code null} when none of the classes declares it
     */
    static @Nullable DataKey<Object> resolveConsoleViewKey(String[] ownerClassNames) {
        for (String ownerClassName : ownerClassNames) {
            DataKey<Object> key = readConsoleViewKey(ownerClassName);
            if (key != null) {
                return key;
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static @Nullable DataKey<Object> readConsoleViewKey(String ownerClassName) {
        try {
            Class<?> owner = Class.forName(ownerClassName);
            Field field = owner.getField("CONSOLE_VIEW");
            if (!Modifier.isStatic(field.getModifiers())) {
                return null;
            }
            Object value = field.get(null);
            return value instanceof DataKey<?> ? (DataKey<Object>) value : null;
        } catch (ClassNotFoundException | NoSuchFieldException | IllegalAccessException e) {
            // Holder class or field missing on this IDE version - try the next one.
            return null;
        } catch (LinkageError e) {
            // The holder class exists but cannot be linked on this IDE version.
            return null;
        }
    }

    static @Nullable String resolveSelectedText(@Nullable Object consoleView) {
        Editor editor = findEditor(consoleView);
        if (editor == null) {
            return null;
        }
        return SelectionTextUtils.normalizeSendableText(editor.getSelectionModel().getSelectedText());
    }

    private static @Nullable Editor findEditor(@Nullable Object consoleView) {
        if (consoleView == null) {
            return null;
        }
        if (consoleView instanceof ConsoleViewImpl) {
            return ((ConsoleViewImpl) consoleView).getEditor();
        }
        if (consoleView instanceof ConsoleView) {
            return invokeGetEditor(consoleView);
        }
        return null;
    }

    private static @Nullable Editor invokeGetEditor(@NotNull Object consoleView) {
        Class<?> clazz = consoleView.getClass();
        try {
            Optional<Method> cached = EDITOR_METHOD_CACHE.computeIfAbsent(clazz, cls -> {
                try {
                    Method m = cls.getMethod("getEditor");
                    if (!Editor.class.isAssignableFrom(m.getReturnType())) {
                        return Optional.empty();
                    }
                    return Optional.of(m);
                } catch (NoSuchMethodException e) {
                    return Optional.empty();
                }
            });
            if (!cached.isPresent()) {
                return null;
            }
            Object result = cached.get().invoke(consoleView);
            if (result instanceof Editor) {
                return (Editor) result;
            }
        } catch (ReflectiveOperationException e) {
            LOG.debug("Failed to invoke getEditor() via reflection on " + clazz.getName(), e);
        }
        return null;
    }
}
