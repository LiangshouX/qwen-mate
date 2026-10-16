# Installation

QwenMate has two parts: the IDE plugin itself, and the Qwen Code SDK dependency the plugin uses to drive the engine.

## Requirements

- JetBrains IDE 2023.3 through 2026.3 (build 233 to 263.*), IntelliJ IDEA and other compatible JetBrains IDEs
- The Qwen Code SDK dependency must be installed once before first use, either online from within the plugin or from an offline package
- Network access to Qwen services; fully offline installation is possible in intranet environments

## Install the plugin

### Option 1: JetBrains Marketplace (recommended)

1. Open `Settings → Plugins → Marketplace`
2. Search for `QwenMate` and click Install
3. Restart the IDE

### Option 2: Offline ZIP install (intranet)

1. Download the QwenMate plugin ZIP from GitHub Releases
2. Open `Settings → Plugins → ⚙ → Install Plugin from Disk…`
3. Select the ZIP file and restart the IDE after installation

## Install the Qwen Code SDK dependency

QwenMate drives the engine through the official Qwen Code SDK. Pick one of the two ways below before first use:

### Online install

1. Open settings from the gear icon in the QwenMate panel header
2. Go to the `SDK Dependencies` page
3. Choose a version and install; upgrades, rollbacks, and reinstalls all happen on this page too

### Offline install (no internet)

1. Get the Qwen SDK offline package
2. Run `install-offline.bat` (Windows) or `install-offline.sh` (macOS / Linux) from the package to install the SDK into `~/.qwenmate/dependencies/qwen-sdk/`

::: tip Known issue with the Taobao npm mirror
Installing via the Taobao mirror can produce an "incomplete installation, missing native binary" message. This is caused by mirror sync delay, not by the plugin. See [FAQ](./faq) for workarounds.
:::

## Authentication

Authentication is managed by the Qwen Code CLI; the plugin provides no editing entry point for it. If you have not authenticated yet, run `qwen` in a terminal and follow the login flow. The plugin reads the same configuration, so one login covers both.

## Verify the installation

1. Open the QwenMate tool window from the right sidebar icon; if the icon is missing, use `View → Tool Windows → QwenMate`
2. Open settings and check both `Providers → CLI Tools` (CLI detection) and `SDK Dependencies` (SDK status)
3. Send a message in the input box; a streaming reply means everything works

## Upgrade and uninstall

- Upgrade the plugin: automatic update via the Marketplace, or install a newer ZIP over it
- Upgrade / roll back the SDK: `Settings → SDK Dependencies`
- Uninstall: `Settings → Plugins → QwenMate → Uninstall`
- Plugin data lives in `~/.qwenmate/`, CLI configuration and sessions in `~/.qwen/`. Both directories survive uninstall; delete them manually for a full cleanup

## Next steps

Head to [Getting Started](./getting-started) for a tour of the basics.
