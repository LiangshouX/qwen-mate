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
 * <p>
 * The bundle is <b>delegated to</b> rather than inherited from: since 2026.3
 * (263) subclassing {@link DynamicBundle} is deprecated, and the single-argument
 * {@code DynamicBundle(String)} constructor is deprecated as well. The
 * {@link DynamicBundle#DynamicBundle(Class, String)} constructor used here exists
 * unchanged from 2023.3 (233) through 2026.3 (263).
 * </p>
 */
public final class QwenMateBundle {

    @NonNls
    private static final String BUNDLE = "messages.QwenMateBundle";
    private static final DynamicBundle INSTANCE = new DynamicBundle(QwenMateBundle.class, BUNDLE);

    private QwenMateBundle() {
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
