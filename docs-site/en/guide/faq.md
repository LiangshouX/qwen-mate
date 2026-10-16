# FAQ & Troubleshooting

## Installation and startup

### The QwenMate tool window is missing from the sidebar?

Open it via `View → Tool Windows → QwenMate`. If it still does not appear, make sure the plugin is enabled in `Settings → Plugins`, then restart the IDE.

### It says the qwen CLI was not found / CLI detection failed?

The plugin only detects the local `qwen` command; it does not install the CLI for you.

1. Run `qwen --version` in a terminal to confirm the command works
2. If the terminal does not have it either, install the Qwen Code CLI first; the [Qwen Code official documentation](https://qwenlm.github.io/qwen-code-docs/en/users/overview) covers installation
3. The IDE must be launched from a login shell to inherit PATH; restart the IDE after installing and detect again

### Authentication failed or says not logged in?

Login state is managed by the Qwen Code CLI. Run `qwen` in a terminal, complete the login flow, then retry in the plugin. API keys can be configured at `Settings → Providers → Model Providers`; signing in and out still goes through the CLI.

### Where do I change the model?

Do it at `Settings → Providers → Model Providers`: connect a provider, add or remove models, and configure API keys right there, with changes written back to the user-level `~/.qwen/settings.json` (CLI-identical formatting). You can also edit that file or switch in the Qwen Code CLI; the plugin reads the same configuration.

### The chat panel opens completely blank (white screen)?

A blank panel means the web view failed to render; the plugin process itself is still running. Work through these steps in order:

1. Click the refresh icon in the tool window title bar (or "Restart Interface" in the `⋮` menu) to rebuild the interface, no IDE restart needed. The title bar is native IDE chrome and stays clickable while the panel is blank
2. Startup automatically retries twice; if both attempts fail, an "Interface failed to start" panel appears after about 30 seconds, and its button rebuilds the interface the same way
3. If none of that works, restart the IDE. If the blank screen comes back after a restart, it is likely an environment issue; collect the logs below and report it

When reporting, include the `idea.log` lines (menu `Help → Reveal in Explorer` for the log directory) containing `WebviewWatchdog` or `fallback bridge injection`. In the injection log, `url=<empty>` means the page never loaded at all, while a populated `url=` means it loaded but did not render; these have different causes. Attaching `jcef_chromium_*.log` from the same directory also helps.

## SDK dependency issues

### SDK installation incomplete, missing native binary?

This is a known issue with the Taobao npm mirror: the mirror has not fully synced the platform-specific files. It is not a plugin bug. Two options:

- Option 1: temporarily switch to the official npm registry, reinstall from the `SDK Dependencies` page, then switch back
- Option 2: roll the SDK back to v0.2.112 or earlier on the `SDK Dependencies` page, then restart the IDE

The issue disappears on its own once the Taobao mirror finishes syncing.

### Startup fails with spawn EBUSY?

Usually caused by an incompatible Node.js version or an incomplete SDK install:

1. Check your Node.js version; Node 20 or 22 is recommended, many reports involve Node 24
2. Switch to the official npm registry (the Taobao mirror may lack the latest version) and reinstall the latest SDK from `SDK Dependencies`

### "Session resume failed" when restoring a history session?

The session thread resume request was rejected by the server, typically because the session has expired or the server does not support the operation. Start a new session or restore a different one.

## Usage questions

### Scrolling in the chat panel is laggy on macOS?

On macOS (especially Retina displays), disable GPU acceleration: open `Help → Edit Custom VM Options`, add:

```
-Dide.browser.jcef.gpu.disable=true
```

and restart the IDE.

### The AI asks for approval on every file edit. Can I turn it off?

Approval is a safety mechanism for sensitive operations; file edits always require confirmation. If you do not want to confirm each time, choose to remember the decision for the session in the approval dialog, and similar actions stop prompting.

### A shortcut conflicts with another plugin?

Search for `QwenMate` in `Settings → Keymap` and rebind the action.

### How do I install in a fully offline intranet?

1. Download the plugin ZIP on a machine with internet access and install it via `Install Plugin from Disk…`
2. Use the Qwen SDK offline package: run `install-offline.bat` / `install-offline.sh` in a terminal to install into `~/.qwenmate/dependencies/qwen-sdk/`
3. Configure authentication according to your intranet's Qwen service setup

### Where is plugin data stored?

- `~/.qwenmate/`: plugin data and the SDK dependency
- `~/.qwen/`: Qwen Code CLI configuration and sessions

When cleaning up for troubleshooting, exit the IDE first and delete the relevant directory; back up session records before deleting.

## Report a problem

For anything not covered here, open an issue on [GitHub Issues](https://github.com/LiangshouX/qwen-mate/issues) and include the error message, IDE version, and reproduction steps.
