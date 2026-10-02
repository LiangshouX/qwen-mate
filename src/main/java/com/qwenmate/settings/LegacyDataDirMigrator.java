package com.qwenmate.settings;

import com.qwenmate.bridge.NodeDetector;
import com.intellij.openapi.diagnostic.Logger;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * One-time migration of the pre-rebrand data directory ({@code .codemoss}) to the
 * QwenMate directory ({@code .qwenmate}).
 *
 * <p>Policy: when the target is absent the legacy directory is renamed wholesale
 * (config.json, prompt.json, dependencies/, cache/, skills/, … all move at once).
 * When both exist, only top-level entries missing in the target are moved, so a
 * fresh install (for example an SDK installed by the offline script before the
 * first IDE start) is never overwritten. Idempotent and safe to call repeatedly.
 */
public final class LegacyDataDirMigrator {

    private static final Logger LOG = Logger.getInstance(LegacyDataDirMigrator.class);

    public static final String LEGACY_DIR_NAME = ".codemoss";
    public static final String CURRENT_DIR_NAME = ".qwenmate";

    private static final AtomicBoolean HOME_MIGRATED = new AtomicBoolean(false);

    private LegacyDataDirMigrator() {
    }

    /** Migrates {@code ~/.codemoss} to {@code ~/.qwenmate} exactly once per JVM. */
    public static void migrateHomeOnce() {
        if (HOME_MIGRATED.get()) {
            return;
        }
        synchronized (LegacyDataDirMigrator.class) {
            if (HOME_MIGRATED.get()) {
                return;
            }
            String home = NodeDetector.resolveHomeForFileOps();
            if (home != null && !home.isEmpty()) {
                migrateDir(Paths.get(home, LEGACY_DIR_NAME), Paths.get(home, CURRENT_DIR_NAME));
            }
            HOME_MIGRATED.set(true);
        }
    }

    /** Migrates {@code <project>/.codemoss} to {@code <project>/.qwenmate} for prompt sharing. */
    public static void migrateProjectOnce(String projectBasePath) {
        if (projectBasePath == null || projectBasePath.isEmpty()) {
            return;
        }
        migrateDir(Paths.get(projectBasePath, LEGACY_DIR_NAME), Paths.get(projectBasePath, CURRENT_DIR_NAME));
    }

    static void migrateDir(Path legacyDir, Path currentDir) {
        try {
            if (!Files.isDirectory(legacyDir)) {
                return;
            }
            if (!Files.exists(currentDir)) {
                Files.move(legacyDir, currentDir);
                LOG.info("[LegacyDataDirMigrator] Moved " + legacyDir + " -> " + currentDir);
                return;
            }
            List<Path> entries;
            try (Stream<Path> stream = Files.list(legacyDir)) {
                entries = stream.collect(Collectors.toList());
            }
            int moved = 0;
            for (Path entry : entries) {
                Path target = currentDir.resolve(entry.getFileName().toString());
                if (!Files.exists(target)) {
                    Files.move(entry, target);
                    moved++;
                }
            }
            LOG.info("[LegacyDataDirMigrator] Merged " + moved + " entries from " + legacyDir
                    + " into " + currentDir);
            deleteIfEmpty(legacyDir);
        } catch (IOException | RuntimeException e) {
            LOG.warn("[LegacyDataDirMigrator] Migration of " + legacyDir + " failed: " + e);
        }
    }

    private static void deleteIfEmpty(Path dir) throws IOException {
        try (Stream<Path> stream = Files.list(dir)) {
            if (!stream.findAny().isPresent()) {
                Files.delete(dir);
                LOG.info("[LegacyDataDirMigrator] Removed empty legacy dir " + dir);
            }
        }
    }
}
