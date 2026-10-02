package com.qwenmate.settings;

import com.qwenmate.model.PromptScope;
import com.qwenmate.util.PlatformUtils;
import com.google.gson.JsonObject;
import org.junit.After;
import org.junit.Test;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

public class QwenMateSettingsServicePromptProviderTest {
    private String originalHome;

    @After
    public void restoreHome() throws Exception {
        if (originalHome != null) {
            setHome(originalHome);
        }
    }

    @Test
    public void isolatesProviderReadsAndProtectsCrossProviderDeletes() throws Exception {
        Path home = Files.createTempDirectory("prompt-provider-home");
        originalHome = getHome();
        setHome(home.toString());
        Files.createDirectories(home.resolve(".qwenmate"));

        JsonObject config = new JsonObject();
        JsonObject prompts = new JsonObject();
        prompts.add("same-id", prompt("Qwen", "qwen"));
        prompts.add("dsh-id", prompt("Dsh", "dsh"));
        config.add("prompts", prompts);
        Files.writeString(home.resolve(".qwenmate/prompt.json"), config.toString());

        QwenMateSettingsService service = new QwenMateSettingsService();
        List<JsonObject> codexPrompts = service.getPrompts(PromptScope.GLOBAL, null, "dsh");
        assertEquals(1, codexPrompts.size());
        assertEquals("dsh-id", codexPrompts.get(0).get("id").getAsString());

        assertFalse(service.deletePrompt("same-id", PromptScope.GLOBAL, null, "dsh"));
        assertEquals(2, service.getPromptManager(PromptScope.GLOBAL, null).getPrompts().size());
    }

    private static JsonObject prompt(String name, String provider) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("id", provider + "-id");
        if ("qwen".equals(provider)) {
            prompt.addProperty("id", "same-id");
        }
        prompt.addProperty("name", name);
        prompt.addProperty("content", provider);
        prompt.addProperty("provider", provider);
        return prompt;
    }

    private static String getHome() throws Exception {
        Field field = PlatformUtils.class.getDeclaredField("cachedRealHomeDir");
        field.setAccessible(true);
        return (String) field.get(null);
    }

    private static void setHome(String home) throws Exception {
        Field field = PlatformUtils.class.getDeclaredField("cachedRealHomeDir");
        field.setAccessible(true);
        field.set(null, home);
    }
}
