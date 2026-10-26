# Roadmap & Technical Notes

## Current state

The latest stable release of QwenMate is 1.1.1 (released 2026-10-27). It ships through GitHub Releases and the JetBrains Marketplace; both channels distribute the same build artifact.

Core capabilities today:

- Conversation: streaming output, thinking display, context references (@ / # / !), image attachments, prompt enhancer, five reasoning effort levels, slash commands aligned with Qwen Code, and a message queue (`Ctrl+Q`, same as the CLI)
- IDE integration: editor context actions and shortcuts, file tree and console content sending, run output monitoring, Commit AI, approvals and diffs
- Ecosystem: MCP server management, Skills management, session history and templates
- Usage: a settings page with local token consumption, model share, daily trend, and a 12-month heatmap, switchable across today / 7 days / 30 days and All / By project / By session
- Configuration: shares `~/.qwen/settings.json` with the Qwen Code CLI, and providers and models are visually editable in the plugin (written back to the user-level file with CLI-identical formatting)

See [CHANGELOG](https://github.com/LiangshouX/qwen-mate/blob/main/CHANGELOG.md) in the repository for version history.

## Architecture overview

QwenMate is a three-stage architecture:

```
React frontend (JCEF Webview)
        ↕  JCEF bridge
Java plugin layer (tool window, actions, approvals, notifications)
        ↕  NDJSON + marker protocol + permission file IPC
Node process (TypeScript SDK)
        ↕  ACP (qwen agent stdio)
qwen CLI (engine, separate child process)
```

Key design points:

- The engine is always a separate child process. The TS SDK is a client rather than the engine itself; the main channel speaks ACP, a standard JSON-RPC based protocol
- Plugin and CLI share configuration and session data, so anything set up in the terminal works in the plugin
- Frontend and Java communicate over the JCEF bridge, which is inherent to the Webview architecture

## Evolution: Java SDK migration (under evaluation)

This is an architecture direction currently under evaluation; nothing is scheduled yet. The following summarizes findings from research.

### Background

The current link includes a custom Java-to-Node bridge (NDJSON + marker protocol + permission file IPC), and the file-based IPC for permission approvals has historically been a hotspot for bugs. Replacing the TS SDK with an official Java SDK could remove that bridge layer.

### Official Java SDK status

The qwen-code repository ships a Java SDK with four modules; two are relevant to the plugin:

- `acp-sdk` (Java 8, generic ACP client): substantial gaps. No thinking output, no usage statistics, no environment variable injection, no MCP status probing, no model selection. Not suitable as the main channel
- `qwencode-sdk` (Java 11, two APIs):
  - legacy stdio API: isomorphic with `@qwen-code/sdk`, message families, permission modes, and session resume map one-to-one. This is the current front-runner. Gaps: `sendPrompt` is text-only (image attachments need an API extension), and MCP status probing is not covered
  - daemon API (`qwen serve` REST + SSE): complete callbacks, but in alpha it cannot pick a model at session creation, has no dynamic permission switching, and is tightly coupled to the CLI version. Not suitable for the plugin yet

Both SDKs are currently alpha.

### Planned path

1. Move the protocol boundary from npm SDK private messages to the ACP standard
2. Verify ACP coverage first: thinking, usage statistics, slash commands, attachments, permission mode switching. This is the biggest risk
3. Migrate in slices, using the existing `ai-bridge` test suite as acceptance criteria

The payoff is removal of the DaemonBridge heartbeat and restart state machine, removal of bidirectional marker translation, and permission approvals becoming an in-process call instead of file IPC.

### What stays

- The qwen CLI is a Node program, so CLI detection and launch dependencies stay
- The engine remains a separate child process, and staying in sync with upstream qwen-code is unchanged
- The frontend JCEF bridge is untouched

## Release process

- Pushing a `v*` tag triggers CI: one build produces the ZIP attached to the GitHub Release, and on manual dispatch the same ZIP is uploaded to the JetBrains Marketplace
- This help site rebuilds and redeploys automatically when `docs-site/` changes are pushed to main

## Disclaimer

QwenMate is a community project, not affiliated with, endorsed by, or sponsored by Alibaba Cloud or JetBrains. It is derived from CC GUI (MIT) and open-sourced under the MIT license.
