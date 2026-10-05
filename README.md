<div align="center">

# QwenMate

**Qwen Code 可视化 GUI —— JetBrains IDE 插件（内部轻量版）**

Based on [CC GUI](https://github.com/zhukunpenglinyutong/jetbrains-cc-gui) (MIT), trimmed to Qwen-only.

</div>

---

A JetBrains IDE plugin that provides a visual interface for **Qwen Code** (official TypeScript SDK), making AI-assisted programming more efficient and intuitive.

## Supported Engines

- **Qwen Code** — 通义千问 AI 编程助手（官方 TypeScript SDK 驱动，支持 qwen3-coder 等多模型）

## Key Features

### Intelligent Conversation
- Context-aware AI coding assistant with streaming output & thinking display
- @file reference support for precise code context
- Image sending support for visual requirement description
- Prompt enhancer for better AI understanding

### Agent System
- Built-in Agent system for automated complex tasks
- Skills slash command system (/init, /review, etc.)
- MCP server support to extend AI capabilities

### Developer Experience
- Comprehensive permission management and security controls
- Code DIFF comparison and file navigation
- Dark/Light theme with IDE font synchronization
- 10-language internationalization

### Session Management
- History session records, restore, search and export
- Session favorites and AI auto-naming
- Usage statistics with per-turn cost tracking

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
