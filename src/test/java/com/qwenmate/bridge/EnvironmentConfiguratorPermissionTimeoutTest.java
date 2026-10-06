package com.qwenmate.bridge;

import com.qwenmate.settings.QwenMateSettingsService;
import com.qwenmate.util.PlatformUtils;
import org.junit.Assume;
import org.junit.Test;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class EnvironmentConfiguratorPermissionTimeoutTest {

    @Test
    public void configurePermissionEnvPassesEffectiveSafetyNetTimeoutToNode() {
        EnvironmentConfigurator configurator = new EnvironmentConfigurator(new FakeSettingsService(120));
        Map<String, String> env = new HashMap<>();

        configurator.configurePermissionEnv(env);

        assertEquals("180000", env.get("QWEN_MATE_PERMISSION_SAFETY_NET_MS"));
        assertTrue(env.containsKey("QWEN_MATE_PERMISSION_DIR"));
        assertTrue(env.containsKey("QWEN_MATE_SESSION_ID"));
    }

    // =========================================================================
    // Regression: WSL Node binaries must receive a Linux-readable IPC dir
    // =========================================================================

    @Test
    public void translatePermissionDirForNode_nullDir_returnsNull() {
        assertNull(EnvironmentConfigurator.translatePermissionDirForNode(null, "/usr/bin/node"));
    }

    @Test
    public void translatePermissionDirForNode_emptyDir_returnsEmpty() {
        assertEquals("", EnvironmentConfigurator.translatePermissionDirForNode("", "/usr/bin/node"));
    }

    @Test
    public void translatePermissionDirForNode_nullNode_returnsDirVerbatim() {
        String dir = "C:\\Users\\foo\\AppData\\Local\\Temp\\qwenmate-permission";
        assertEquals(dir, EnvironmentConfigurator.translatePermissionDirForNode(dir, null));
    }

    @Test
    public void translatePermissionDirForNode_windowsNode_returnsDirVerbatim() {
        String dir = "C:\\Users\\foo\\AppData\\Local\\Temp\\qwenmate-permission";
        assertEquals(dir,
                EnvironmentConfigurator.translatePermissionDirForNode(dir, "C:\\Program Files\\nodejs\\node.exe"));
    }

    @Test
    public void translatePermissionDirForNode_wslNodeOnWindows_convertsToMntPath() {
        Assume.assumeTrue("WSL path translation is only meaningful on Windows", PlatformUtils.isWindows());

        String dir = "C:\\Users\\foo\\AppData\\Local\\Temp\\qwenmate-permission";
        String translated = EnvironmentConfigurator.translatePermissionDirForNode(dir, "/usr/bin/node");

        assertNotNull(translated);
        assertEquals("/mnt/c/Users/foo/AppData/Local/Temp/qwenmate-permission", translated);
    }

    @Test
    public void configurePermissionEnvUsesWslDirWhenNodeIsWsl() {
        Assume.assumeTrue("WSL path translation is only meaningful on Windows", PlatformUtils.isWindows());

        EnvironmentConfigurator configurator = new EnvironmentConfigurator(new FakeSettingsService(60));
        Map<String, String> env = new HashMap<>();

        configurator.configurePermissionEnv(env, "/usr/bin/node");

        String dir = env.get("QWEN_MATE_PERMISSION_DIR");
        assertNotNull(dir);
        assertTrue("WSL node should receive a /mnt/-style permission dir, got: " + dir,
                dir.startsWith("/mnt/") || dir.startsWith("/"));
    }

    @Test
    public void configurePermissionEnvSetsWslenvWhenNodeIsWsl() {
        Assume.assumeTrue("WSLENV propagation is only meaningful on Windows", PlatformUtils.isWindows());

        EnvironmentConfigurator configurator = new EnvironmentConfigurator(new FakeSettingsService(60));
        Map<String, String> env = new HashMap<>();

        configurator.configurePermissionEnv(env, "/usr/bin/node");

        String wslenv = env.get("WSLENV");
        assertNotNull("WSLENV must be set when node is a WSL binary", wslenv);
        assertTrue("WSLENV must include QWEN_MATE_PERMISSION_DIR", wslenv.contains("QWEN_MATE_PERMISSION_DIR"));
        assertTrue("WSLENV must include QWEN_MATE_SESSION_ID", wslenv.contains("QWEN_MATE_SESSION_ID"));
        assertTrue("WSLENV must include QWEN_MATE_PERMISSION_SAFETY_NET_MS", wslenv.contains("QWEN_MATE_PERMISSION_SAFETY_NET_MS"));
    }

    @Test
    public void configurePermissionEnvDoesNotSetWslenvForWindowsNode() {
        EnvironmentConfigurator configurator = new EnvironmentConfigurator(new FakeSettingsService(60));
        Map<String, String> env = new HashMap<>();

        configurator.configurePermissionEnv(env, "C:\\Program Files\\nodejs\\node.exe");

        assertNull("WSLENV must not be set for a native Windows node", env.get("WSLENV"));
    }

    @Test
    public void convertWslMountPathToWindowsPath_convertsDriveMountOnWindows() {
        Assume.assumeTrue("WSL mount repair is only meaningful on Windows", PlatformUtils.isWindows());

        assertEquals("C:\\Users\\foo",
                EnvironmentConfigurator.convertWslMountPathToWindowsPath("/mnt/c/Users/foo"));
        assertEquals("D:\\",
                EnvironmentConfigurator.convertWslMountPathToWindowsPath("/mnt/d"));
    }

    @Test
    public void resolveHomeForNodeEnvironment_nativeWindowsNodeRepairsWslMountHome() {
        Assume.assumeTrue("WSL mount repair is only meaningful on Windows", PlatformUtils.isWindows());

        String home = EnvironmentConfigurator.resolveHomeForNodeEnvironment(
                "C:\\Program Files\\nodejs\\node.exe",
                "/mnt/c/Users/foo");

        assertEquals("C:\\Users\\foo", home);
    }

    @Test
    public void updateProcessEnvironment_nativeWindowsNodeRepairsPollutedHome() {
        Assume.assumeTrue("WSL mount repair is only meaningful on Windows", PlatformUtils.isWindows());

        EnvironmentConfigurator configurator = new EnvironmentConfigurator(new FakeSettingsService(60));
        ProcessBuilder pb = new ProcessBuilder("node");
        Map<String, String> env = pb.environment();
        env.put("HOME", "/mnt/c/Users/foo");

        configurator.updateProcessEnvironment(pb, "C:\\Program Files\\nodejs\\node.exe");

        assertEquals("C:\\Users\\foo", env.get("HOME"));
    }

    @Test
    public void updateProcessEnvironment_nativeWindowsNodeSetsMissingHomeWithoutWslMount() {
        Assume.assumeTrue("Native Windows HOME repair is only meaningful on Windows", PlatformUtils.isWindows());

        EnvironmentConfigurator configurator = new EnvironmentConfigurator(new FakeSettingsService(60));
        ProcessBuilder pb = new ProcessBuilder("node");
        Map<String, String> env = pb.environment();
        env.remove("HOME");

        configurator.updateProcessEnvironment(pb, "C:\\Program Files\\nodejs\\node.exe");

        assertEquals(PlatformUtils.getHomeDirectory(), env.get("HOME"));
        assertTrue("HOME must be a native Windows path", !env.get("HOME").startsWith("/mnt/"));
    }

    private static class FakeSettingsService extends QwenMateSettingsService {
        private final int timeoutSeconds;

        private FakeSettingsService(int timeoutSeconds) {
            this.timeoutSeconds = timeoutSeconds;
        }

        @Override
        public int getPermissionDialogTimeoutSeconds() throws IOException {
            return timeoutSeconds;
        }
    }
}
