package com.qwenmate.dependency;

import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class DependencyManagerVersioningTest {
    @Test
    public void shouldUseRequestedVersionForMainPackage() {
        List<String> packages = DependencyManager.buildPackageSpecs(
                SdkDefinition.QWEN_SDK,
                "1.0.0"
        );

        assertEquals("@qwen-code/sdk@1.0.0", packages.get(0));
        assertEquals(1, packages.size());
    }

    @Test
    public void shouldFallbackToSdkDefaultVersionWhenRequestedVersionIsBlank() {
        List<String> packages = DependencyManager.buildPackageSpecs(
                SdkDefinition.QWEN_SDK,
                " "
        );

        assertEquals("@qwen-code/sdk@latest", packages.get(0));
    }

    @Test
    public void shouldNormalizeLeadingVInRequestedVersion() {
        assertEquals("0.3.182", DependencyManager.normalizeRequestedVersion(" v0.3.182 "));
    }

    @Test
    public void shouldAcceptValidSemverVersions() {
        assertEquals("1.0.0", DependencyManager.normalizeRequestedVersion("1.0.0"));
        assertEquals("0.3.182", DependencyManager.normalizeRequestedVersion("V0.3.182"));
        assertEquals("1.2.3-beta.1", DependencyManager.normalizeRequestedVersion("1.2.3-beta.1"));
        assertEquals("2.0.0-rc.1", DependencyManager.normalizeRequestedVersion("v2.0.0-rc.1"));
    }

    @Test
    public void shouldRejectInvalidVersionFormats() {
        assertNull(DependencyManager.normalizeRequestedVersion("not-a-version"));
        assertNull(DependencyManager.normalizeRequestedVersion("1.0"));
        assertNull(DependencyManager.normalizeRequestedVersion("latest"));
        assertNull(DependencyManager.normalizeRequestedVersion(">=1.0.0"));
        assertNull(DependencyManager.normalizeRequestedVersion("1.0.0 && rm -rf /"));
    }

    @Test
    public void shouldRejectNullAndEmpty() {
        assertNull(DependencyManager.normalizeRequestedVersion(null));
        assertNull(DependencyManager.normalizeRequestedVersion(""));
        assertNull(DependencyManager.normalizeRequestedVersion("   "));
    }
}
