package com.qwenmate.bridge;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class BridgeArchiveExtractorTest {

    @Test
    public void extractedArchiveWithoutNodeModulesIsValidBridgeDir() throws Exception {
        Path workDir = Files.createTempDirectory("bridge-extract");
        Path archive = workDir.resolve("ai-bridge.zip");
        try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(archive))) {
            out.putNextEntry(new ZipEntry("channel-manager.js"));
            out.write("// stub".getBytes(StandardCharsets.UTF_8));
            out.closeEntry();
            out.putNextEntry(new ZipEntry("channels/qwen-channel.js"));
            out.write("// stub".getBytes(StandardCharsets.UTF_8));
            out.closeEntry();
        }

        Path extracted = workDir.resolve("ai-bridge");
        BridgeArchiveExtractor.unzipArchive(archive.toFile(), extracted.toFile());

        // Regression: validation used to require node_modules (a leftover from
        // the sql.js era) and rejected every freshly extracted archive —
        // "Bridge validation failed after extraction and retries".
        assertTrue(BridgePathLocator.isValidBridgeDir(extracted.toFile()));
    }

    @Test
    public void directoryMissingCoreScriptIsInvalid() throws Exception {
        Path emptyDir = Files.createTempDirectory("bridge-empty");
        assertFalse(BridgePathLocator.isValidBridgeDir(emptyDir.toFile()));
    }
}
