package com.qwenmate.settings;

import org.junit.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/** Migration of the pre-rebrand {@code .codemoss} data dir to {@code .qwenmate}. */
public class LegacyDataDirMigratorTest {

    @Test
    public void renamesLegacyDirWholesaleWhenTargetMissing() throws IOException {
        Path home = Files.createTempDirectory("qwenmate-migrate-rename");
        Path legacy = Files.createDirectories(home.resolve(".codemoss"));
        Files.writeString(legacy.resolve("config.json"), "{\"a\":1}");
        Files.createDirectories(legacy.resolve("dependencies"));
        Path current = home.resolve(".qwenmate");

        LegacyDataDirMigrator.migrateDir(legacy, current);

        assertTrue(Files.isDirectory(current.resolve("dependencies")));
        assertEquals("{\"a\":1}", Files.readString(current.resolve("config.json")));
        assertFalse(Files.exists(legacy));
    }

    @Test
    public void mergesMissingEntriesWhenBothDirsExist() throws IOException {
        Path home = Files.createTempDirectory("qwenmate-migrate-merge");
        Path legacy = Files.createDirectories(home.resolve(".codemoss"));
        Path current = Files.createDirectories(home.resolve(".qwenmate"));
        Files.writeString(legacy.resolve("prompt.json"), "legacy");
        Files.writeString(legacy.resolve("config.json"), "keep-me");
        Files.writeString(current.resolve("config.json"), "fresh");

        LegacyDataDirMigrator.migrateDir(legacy, current);

        // moved because missing in target
        assertEquals("legacy", Files.readString(current.resolve("prompt.json")));
        // never overwrite an existing install entry
        assertEquals("fresh", Files.readString(current.resolve("config.json")));
        // conflicting legacy entry is preserved, so the dir is not drained
        assertEquals("keep-me", Files.readString(legacy.resolve("config.json")));
    }

    @Test
    public void keepsLegacyDirWhenTargetEntryCannotBeDrained() throws IOException {
        Path home = Files.createTempDirectory("qwenmate-migrate-partial");
        Path legacy = Files.createDirectories(home.resolve(".codemoss"));
        Path current = Files.createDirectories(home.resolve(".qwenmate"));
        Files.writeString(legacy.resolve("a.txt"), "1");
        Files.writeString(legacy.resolve("b.txt"), "2");
        Files.writeString(current.resolve("a.txt"), "existing");

        LegacyDataDirMigrator.migrateDir(legacy, current);

        assertEquals("1", Files.readString(legacy.resolve("a.txt"))); // untouched conflict
        assertEquals("2", Files.readString(current.resolve("b.txt"))); // moved
        assertTrue(Files.isDirectory(legacy)); // not drained
    }

    @Test
    public void noOpsWhenLegacyDirAbsent() throws IOException {
        Path home = Files.createTempDirectory("qwenmate-migrate-noop");
        Path legacy = home.resolve(".codemoss");
        Path current = home.resolve(".qwenmate");

        LegacyDataDirMigrator.migrateDir(legacy, current);

        assertFalse(Files.exists(current));
    }
}
