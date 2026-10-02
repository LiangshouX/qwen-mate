package com.qwenmate.mcp.marketplace;

import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.diagnostic.Logger;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Fetches marketplace metadata and keeps a short-lived local cache.
 */
final class McpMarketplaceHttpClient {

    private static final Logger LOG = Logger.getInstance(McpMarketplaceHttpClient.class);
    private static final long CACHE_TTL_MS = 3_600_000L;
    /** Hard cap on a single response body to avoid memory exhaustion from a hostile source. */
    private static final long MAX_RESPONSE_BYTES = 10L * 1024 * 1024;

    /** Exact GitHub hosts the token may be sent to (the configured GitHub-backed sources). */
    private static final Set<String> GITHUB_HOSTS = new HashSet<>(Arrays.asList(
        "github.com", "api.github.com", "api.mcp.github.com"));

    /** Network fetch seam so caching/stale-fallback behaviour can be unit tested without I/O. */
    interface Fetcher {
        String fetch(String url) throws IOException;
    }

    private final Path cacheDirectory;
    private final Fetcher fetcher;

    McpMarketplaceHttpClient() {
        this(Paths.get(PathManager.getSystemPath(), "codriver", "mcp-marketplace-cache"),
            McpMarketplaceHttpClient::httpGet);
    }

    McpMarketplaceHttpClient(Path cacheDirectory, Fetcher fetcher) {
        this.cacheDirectory = cacheDirectory;
        this.fetcher = fetcher;
    }

    String get(String url, String cacheKey, boolean forceRefresh) throws IOException {
        Files.createDirectories(cacheDirectory);
        Path cacheFile = cacheDirectory.resolve(safeCacheFileName(cacheKey) + ".json");
        if (!forceRefresh && Files.exists(cacheFile)) {
            long age = System.currentTimeMillis() - Files.getLastModifiedTime(cacheFile).toMillis();
            if (age < CACHE_TTL_MS) {
                return readFile(cacheFile);
            }
        }

        try {
            String json = fetcher.fetch(url);
            writeCacheAtomically(cacheFile, json);
            return json;
        } catch (IOException e) {
            if (Files.exists(cacheFile)) {
                LOG.warn("Using stale MCP marketplace cache after fetch failure: " + e.getMessage());
                return readFile(cacheFile);
            }
            throw e;
        }
    }

    /**
     * Write the cache via a temp file + atomic move so two concurrent fetches for the same
     * source/page can never leave a half-written (corrupt) JSON file that the next read fails on.
     */
    private void writeCacheAtomically(Path cacheFile, String json) throws IOException {
        Path tmp = Files.createTempFile(cacheDirectory, "mcp-cache", ".tmp");
        try {
            Files.write(tmp, json.getBytes(StandardCharsets.UTF_8));
            try {
                Files.move(tmp, cacheFile, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, cacheFile, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    private static String httpGet(String urlValue) throws IOException {
        URL url = new URL(urlValue);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        // Do not auto-follow redirects: a 3xx Location could point at an internal address (SSRF via
        // a compromised/misbehaving registry) and a cross-host redirect can leak the GitHub bearer
        // token below to the redirect target. Any 3xx is treated as an error by the status check.
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "CoDriver-MCP-Marketplace");
        // Only attach the GitHub token to known GitHub hosts so credentials are never leaked
        // to third-party registries (e.g. registry.modelcontextprotocol.io).
        if (isGitHubHost(url.getHost())) {
            String githubToken = System.getenv("GITHUB_TOKEN");
            if (githubToken != null && !githubToken.trim().isEmpty()) {
                connection.setRequestProperty("Authorization", "Bearer " + githubToken.trim());
            }
        }
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(20_000);

        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            throw new IOException("HTTP " + status + " from " + urlValue);
        }

        try (InputStream inputStream = connection.getInputStream()) {
            return readBody(inputStream, MAX_RESPONSE_BYTES);
        }
    }

    /** Reads a response body fully but aborts once it exceeds {@code maxBytes}. */
    static String readBody(InputStream inputStream, long maxBytes) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        long total = 0;
        int read = inputStream.read(chunk);
        while (read != -1) {
            total += read;
            if (total > maxBytes) {
                throw new IOException("Response exceeds the " + maxBytes + "-byte limit");
            }
            buffer.write(chunk, 0, read);
            read = inputStream.read(chunk);
        }
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }

    private static boolean isGitHubHost(String host) {
        return host != null && GITHUB_HOSTS.contains(host.toLowerCase(Locale.ROOT));
    }

    private static String readFile(Path file) throws IOException {
        try (Reader reader = new InputStreamReader(Files.newInputStream(file), StandardCharsets.UTF_8)) {
            StringBuilder builder = new StringBuilder();
            char[] buffer = new char[4096];
            int read = reader.read(buffer);
            while (read != -1) {
                builder.append(buffer, 0, read);
                read = reader.read(buffer);
            }
            return builder.toString();
        }
    }

    private static String safeCacheFileName(String cacheKey) {
        return cacheKey.replaceAll("[^a-zA-Z0-9._-]", "_");
    }
}
