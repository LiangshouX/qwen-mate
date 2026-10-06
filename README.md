<div align="center">

# QwenMate

**Qwen Code 可视化 GUI —— JetBrains IDE 插件（内部轻量版）**

Based on [CC GUI](https://github.com/zhukunpenglinyutong/jetbrains-cc-gui) (MIT), trimmed to Qwen-only.

</div>

---

A JetBrains IDE plugin that provides a visual interface for **Qwen Code** (official TypeScript SDK), making AI-assisted programming more efficient and intuitive.

## About Qwen Code

Qwen Code is the Qwen team's open-source agentic coding tool for the terminal: describe what you want in plain language and it plans, writes, and debugs code, edits files, runs commands, and connects to external tools via MCP.

QwenMate currently supports Qwen Code as its only engine, driving it through the official TypeScript SDK and ACP, and sharing the CLI's configuration (`~/.qwen/settings.json`) and session data: everything you set up in the terminal works here as-is.

## Key Features

### Intelligent Conversation
- Streaming output with thinking display
- @file references, # agent invocation, ! prompt insertion
- Image attachments for visual requirement description
- Prompt enhancer that rewrites your input before sending

### IDE Integration
- Editor context actions to send selected code (`Ctrl+Alt+K` / `Cmd+Alt+K`), quick fix (`Ctrl+Shift+Q`)
- Send file tree / console content, monitor run & debug output
- Commit AI: generate Git commit messages in the commit panel
- Approval dialogs before the AI performs sensitive actions like file edits

### Developer Experience
- Code DIFF comparison and file navigation
- MCP servers: built-in marketplace, add/edit/remove, connection status and tool lists
- Skills: browse and manage Qwen Code skills
- Dark/Light theme with IDE font synchronization
- 10-language internationalization

### Session Management
- History session records, restore, search and export
- Session favorites and AI-generated titles

### Configuration & Dependencies (read-only)
- Qwen config: reads `~/.qwen/settings.json` to show the model catalog and current model; authentication is managed by the Qwen Code CLI and cannot be edited in the plugin
- CLI detection: read-only detection of the locally installed qwen CLI
- SDK dependency management: install, update, or roll back the Qwen Code SDK, offline packages supported

## Installation (offline / internal)

1. Install the plugin ZIP via `Settings → Plugins → ⚙ → Install Plugin from Disk…`
2. Install the Qwen SDK package to `~/.qwenmate/dependencies/qwen-sdk/` with the bundled offline installer (`install-offline.bat` / `install-offline.sh`), or through `Settings → SDK 依赖管理` when network is available.

## Performance Tips

### macOS Scrolling Performance

If scrolling in the chat panel or settings feels laggy on macOS (especially Retina), disable GPU acceleration — add to VM options (Help → Edit Custom VM Options):

```
-Dide.browser.jcef.gpu.disable=true
```

Then restart the IDE.

## Local Development and Debugging

### 1. Install Frontend Dependencies

```bash
cd webview
npm install
```

### 2. Install ai-bridge Dependencies

```bash
cd ai-bridge
npm install
```

### 3. Debug Plugin

```bash
./gradlew clean runIde
```

### 4. Build Plugin

```sh
./gradlew clean buildPlugin

# The generated plugin package will be in build/distributions/
```

## License

MIT
