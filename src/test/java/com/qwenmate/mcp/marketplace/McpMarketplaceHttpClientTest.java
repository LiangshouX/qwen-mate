package com.qwenmate.mcp.marketplace;

import org.junit.Assert;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.concurrent.atomic.AtomicInteger;

public class McpMarketplaceHttpClientTest {

    private Path tempDir() throws IOException {
        return Files.createTempDirectory("mcp-cache-test");
    }

    @Test
    public void cachesWithinTtlAndReturnsCachedBody() throws IOException {
        AtomicInteger calls = new AtomicInteger();
        McpMarketplaceHttpClient client = new McpMarketplaceHttpClient(tempDir(), url -> {
            calls.incrementAndGet();
            return "{\"v\":1}";
        });
        Assert.assertEquals("{\"v\":1}", client.get("https://x/y", "k", false));
        Assert.assertEquals("{\"v\":1}", client.get("https://x/y", "k", false));
        Assert.assertEquals("fetcher should be hit only once within the TTL", 1, calls.get());
    }

    @Test
    public void forceRefreshBypassesCache() throws IOException {
        AtomicInteger calls = new AtomicInteger();
        McpMarketplaceHttpClient client = new McpMarketplaceHttpClient(tempDir(), url -> "v" + calls.incrementAndGet());
        Assert.assertEquals("v1", client.get("u", "k", false));
        Assert.assertEquals("v2", client.get("u", "k", true));
        Assert.assertEquals(2, calls.get());
    }

    @Test
    public void fallsBackToStaleCacheOnFetchFailure() throws IOException {
        boolean[] fail = {false};
        McpMarketplaceHttpClient client = new McpMarketplaceHttpClient(tempDir(), url -> {
            if (fail[0]) {
                throw new IOException("boom");
            }
            return "cached";
        });
        client.get("u", "k", false);
        fail[0] = true;
        Assert.assertEquals("cached", client.get("u", "k", true));
    }

    @Test
    public void expiredCacheTriggersRefetch() throws IOException {
        Path dir = tempDir();
        AtomicInteger calls = new AtomicInteger();
        McpMarketplaceHttpClient client = new McpMarketplaceHttpClient(dir, url -> "v" + calls.incrementAndGet());
        client.get("u", "k", false);
        Files.setLastModifiedTime(dir.resolve("k.json"), FileTime.fromMillis(System.currentTimeMillis() - 7_200_000L));
        Assert.assertEquals("v2", client.get("u", "k", false));
        Assert.assertEquals(2, calls.get());
    }

    @Test(expected = IOException.class)
    public void readBodyAbortsBeyondCap() throws IOException {
        McpMarketplaceHttpClient.readBody(new ByteArrayInputStream("0123456789".getBytes(StandardCharsets.UTF_8)), 4);
    }

    @Test
    public void readBodyReturnsFullContentWithinCap() throws IOException {
        String body = McpMarketplaceHttpClient.readBody(
            new ByteArrayInputStream("hello".getBytes(StandardCharsets.UTF_8)), 1024);
        Assert.assertEquals("hello", body);
    }
}
