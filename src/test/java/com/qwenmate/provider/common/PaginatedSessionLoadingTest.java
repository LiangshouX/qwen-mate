package com.qwenmate.provider.common;

import org.junit.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class PaginatedSessionLoadingTest {

    @Test
    public void liteRead_handlesLargeFile() throws IOException {
        Path tempDir = Files.createTempDirectory("paginated-test");
        try {
            Path tempFile = tempDir.resolve("abc12345-1234-1234-1234-1234567890ab.jsonl");
            // Create a file larger than 128KB
            StringBuilder content = new StringBuilder();
            content.append("{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"First prompt\"},\"timestamp\":\"2026-01-15T10:00:00Z\"}\n");
            for (int i = 0; i < 5000; i++) {
                content.append("{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":\"Response ")
                        .append(i)
                        .append("\"},\"timestamp\":\"2026-01-15T10:")
                        .append(String.format("%02d", i % 60))
                        .append(":00Z\"}\n");
            }
            content.append("{\"customTitle\":\"Custom Title for Large Session\"}\n");

            Files.writeString(tempFile, content.toString());

            SessionLiteReader liteReader = new SessionLiteReader();
            SessionLiteReader.LiteSessionFile lite = liteReader.readSessionLite(tempFile);
            assertNotNull(lite);

            // Verify that head and tail are different for large files
            // (head contains first 64KB, tail contains last 64KB)
            assertTrue(lite.head.contains("First prompt"));
            assertTrue(lite.tail.contains("Custom Title for Large Session"));
        } finally {
            Files.walk(tempDir).sorted((a, b) -> b.compareTo(a)).forEach(p -> {
                try { Files.deleteIfExists(p); } catch (IOException ignored) {}
            });
        }
    }

    @Test
    public void extractJsonStringField_performanceBenchmark() {
        // Create a large text block to test extraction speed
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 1000; i++) {
            sb.append("{\"index\":")
                    .append(i)
                    .append(",\"type\":\"user\",\"message\":\"Message ")
                    .append(i)
                    .append("\"}\n");
        }
        sb.append("{\"customTitle\":\"Final Title\"}\n");
        String text = sb.toString();

        SessionLiteReader reader = new SessionLiteReader();

        long startTime = System.nanoTime();
        for (int i = 0; i < 100; i++) {
            String result = reader.extractLastJsonStringField(text, "customTitle");
            assertEquals("Final Title", result);
        }
        long duration = (System.nanoTime() - startTime) / 1_000_000; // ms

        // String extraction should be fast (< 500ms for 100 iterations on ~70KB text)
        assertTrue("String extraction too slow: " + duration + "ms", duration < 500);
    }
}
