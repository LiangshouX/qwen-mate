package com.qwenmate.provider;

import org.junit.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

public class CustomModelContextWindowProviderTest {

    @Test
    public void shouldResolveOnlyWholeKContextWindowsByExactModelId() throws Exception {
        Path config = Files.createTempFile("custom-model-context", ".json");
        Files.writeString(config, """
                {
                  "customModelContextWindows": {
                    "qwen": {
                      "shared-model": 500000,
                      "invalid-model": -1
                    },
                    "dsh": {
                      "shared-model": 1000000,
                      "partial-k-model": 500500,
                      "sub-k-model": 500,
                      "fractional-model": 12.5
                    }
                  }
                }
                """);

        CustomModelContextWindowProvider provider = CustomModelContextWindowProvider.createForTests(config);

        assertFalse(provider.getContextWindow("qwen", "shared-model").isPresent());
        assertEquals(1_000_000, provider.getContextWindow("dsh", "shared-model").orElseThrow());
        assertFalse(provider.getContextWindow("dsh", "shared-model[1m]").isPresent());
        assertFalse(provider.getContextWindow("qwen", "invalid-model").isPresent());
        assertFalse(provider.getContextWindow("dsh", "partial-k-model").isPresent());
        assertFalse(provider.getContextWindow("dsh", "sub-k-model").isPresent());
        assertFalse(provider.getContextWindow("dsh", "fractional-model").isPresent());
        assertFalse(provider.getContextWindow("dsh", "missing-model").isPresent());
    }
}
