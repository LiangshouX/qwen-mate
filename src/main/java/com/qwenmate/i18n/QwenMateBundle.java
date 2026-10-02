package com.qwenmate.i18n;

import com.intellij.DynamicBundle;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.NonNls;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.PropertyKey;

/**
 * Resource bundle for QwenMate plugin localization.
 * <p>
 * This class provides access to localized strings defined in
 * messages/QwenMateBundle*.properties files.
 * </p>
 */
public class QwenMateBundle extends DynamicBundle {
    @NonNls
    private static final String BUNDLE = "messages.QwenMateBundle";
    private static final QwenMateBundle INSTANCE = new QwenMateBundle();

    private QwenMateBundle() {
        super(BUNDLE);
    }

    /**
     * Get a localized message from the bundle.
     *
     * @param key    the resource key
     * @param params optional parameters for message formatting
     * @return the localized message
     */
    @NotNull
    public static @Nls String message(@NotNull @PropertyKey(resourceBundle = BUNDLE) String key,
                                      Object @NotNull ... params) {
        return INSTANCE.getMessage(key, params);
    }
}
