package com.qwenmate.cache;

import com.intellij.openapi.diagnostic.Logger;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory cache for session indexes.
 * Caches historical session lists to avoid reading from the filesystem on every access.
 */
public class SessionIndexCache {

    private static final Logger LOG = Logger.getInstance(SessionIndexCache.class);

    // Singleton
    private static final SessionIndexCache INSTANCE = new SessionIndexCache();

    // Cache TTL: 5 minutes
    private static final long CACHE_TTL_MS = 5 * 60 * 1000;

    // Session cache: projectPath -> CacheEntry
    private final Map<String, CacheEntry<?>> sessionCache = new ConcurrentHashMap<>();

    private SessionIndexCache() {
        // Private constructor
    }

    public static SessionIndexCache getInstance() {
        return INSTANCE;
    }

    /**
     * Cache entry.
     */
    public static class CacheEntry<T> {
        private final List<T> sessions;
        private final long lastDirModified;
        private final long cacheCreatedAt;

        public CacheEntry(List<T> sessions, long lastDirModified) {
            this.sessions = sessions;
            this.lastDirModified = lastDirModified;
            this.cacheCreatedAt = System.currentTimeMillis();
        }

        public List<T> getSessions() {
            return sessions;
        }

        public long getLastDirModified() {
            return lastDirModified;
        }

        public long getCacheCreatedAt() {
            return cacheCreatedAt;
        }

        /**
         * Checks whether the cache has expired.
         */
        public boolean isExpired() {
            return System.currentTimeMillis() - cacheCreatedAt > CACHE_TTL_MS;
        }

        /**
         * Checks whether the cache is still valid.
         * @param currentDirModified current directory modification time
         */
        public boolean isValid(long currentDirModified) {
            if (isExpired()) {
                return false;
            }
            // If the directory modification time hasn't changed, the cache is still valid
            return currentDirModified == lastDirModified;
        }
    }

    /**
     * Returns the cached session list.
     * @param projectPath the project path
     * @param projectDir the project directory Path (used to check modification time)
     * @return the cached session list, or null if the cache is invalid
     */
    @SuppressWarnings("unchecked")
    public <T> List<T> getQwenMateSessions(String projectPath, Path projectDir) {
        CacheEntry<T> entry = (CacheEntry<T>) sessionCache.get(projectPath);
        if (entry == null) {
            LOG.info("[SessionIndexCache] session cache miss: no entry for " + projectPath);
            return null;
        }

        long currentDirModified = getDirModifiedTime(projectDir);
        if (!entry.isValid(currentDirModified)) {
            LOG.info("[SessionIndexCache] session cache invalid: expired or dir changed for " + projectPath);
            sessionCache.remove(projectPath);
            return null;
        }

        LOG.info("[SessionIndexCache] session cache hit for " + projectPath + ", sessions: " + entry.getSessions().size());
        return entry.getSessions();
    }

    /**
     * Updates the session cache.
     */
    public <T> void updateSessionCache(String projectPath, Path projectDir, List<T> sessions) {
        long dirModified = getDirModifiedTime(projectDir);
        CacheEntry<T> entry = new CacheEntry<>(sessions, dirModified);
        sessionCache.put(projectPath, entry);
        LOG.info("[SessionIndexCache] session cache updated for " + projectPath + ", sessions: " + sessions.size());
    }

    /**
     * Clears the cache for a specific project.
     */
    public void clearProject(String projectPath) {
        sessionCache.remove(projectPath);
        LOG.info("[SessionIndexCache] Cache cleared for project: " + projectPath);
    }

    /**
     * Returns the modification time of a directory.
     */
    private long getDirModifiedTime(Path dir) {
        if (dir == null || !Files.exists(dir)) {
            return 0;
        }
        try {
            return Files.getLastModifiedTime(dir).toMillis();
        } catch (Exception e) {
            LOG.warn("[SessionIndexCache] Failed to get dir modified time: " + e.getMessage());
            return 0;
        }
    }
}
