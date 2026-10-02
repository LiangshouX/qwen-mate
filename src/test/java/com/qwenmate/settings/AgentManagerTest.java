package com.qwenmate.settings;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

/**
 * Regression tests for AgentManager configuration compatibility.
 */
public class AgentManagerTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    @Test
    public void shouldIgnoreMigrationMarkerWithoutRewritingConfig() throws Exception {
        String configJson = """
                {
                  "_deprecated": "Agents migrated to Skills",
                  "agents": {
                    "_disabled": true
                  }
                }
                """;
        Path agentPath = writeConfig(configJson);
        AgentManager manager = newManager(agentPath);

        assertTrue(manager.getAgents().isEmpty());
        assertNull(manager.getAgent("_disabled"));
        assertThrows(IllegalArgumentException.class,
                () -> manager.updateAgent("_disabled", new JsonObject()));
        assertEquals(configJson, Files.readString(agentPath, StandardCharsets.UTF_8));
    }

    @Test
    public void shouldLoadValidAgentsWhenOtherEntriesAreMalformed() throws Exception {
        Path agentPath = writeConfig("""
                {
                  "agents": {
                    "migration-marker": true,
                    "string-timestamp": {
                      "name": "String Timestamp",
                      "createdAt": "300"
                    },
                    "new-agent": {
                      "name": "New Agent",
                      "createdAt": 200
                    },
                    "bad-timestamp": {
                      "name": "Bad Timestamp",
                      "createdAt": {"unexpected": true}
                    }
                  }
                }
                """);
        AgentManager manager = newManager(agentPath);

        List<JsonObject> agents = manager.getAgents();

        assertEquals(3, agents.size());
        assertEquals("string-timestamp", agents.get(0).get("id").getAsString());
        assertEquals("new-agent", agents.get(1).get("id").getAsString());
        assertEquals("bad-timestamp", agents.get(2).get("id").getAsString());
    }

    @Test
    public void shouldRecoverInvalidAgentsNodeWhenAddingAgent() throws Exception {
        Path agentPath = writeConfig("""
                {
                  "_deprecated": "keep this metadata",
                  "agents": true
                }
                """);
        AgentManager manager = newManager(agentPath);
        JsonObject agent = new JsonObject();
        agent.addProperty("id", "new-agent");
        agent.addProperty("name", "New Agent");

        assertTrue(manager.getAgents().isEmpty());
        manager.addAgent(agent);

        JsonObject savedConfig = JsonParser.parseString(
                Files.readString(agentPath, StandardCharsets.UTF_8)).getAsJsonObject();
        assertEquals("keep this metadata", savedConfig.get("_deprecated").getAsString());
        assertTrue(savedConfig.get("agents").isJsonObject());
        assertEquals("New Agent", savedConfig.getAsJsonObject("agents")
                .getAsJsonObject("new-agent").get("name").getAsString());
    }

    private Path writeConfig(String content) throws IOException {
        Path agentPath = temp.newFile("agent.json").toPath();
        Files.writeString(agentPath, content, StandardCharsets.UTF_8);
        return agentPath;
    }

    private AgentManager newManager(Path agentPath) {
        return new AgentManager(new Gson(), new TestConfigPathManager(agentPath));
    }

    private static final class TestConfigPathManager extends ConfigPathManager {
        private final Path agentPath;

        private TestConfigPathManager(Path agentPath) {
            this.agentPath = agentPath;
        }

        @Override
        public Path getAgentFilePath() {
            return agentPath;
        }

        @Override
        public void ensureConfigDirectory() throws IOException {
            Files.createDirectories(agentPath.getParent());
        }
    }
}
