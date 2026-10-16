# Settings Reference

Open settings from the gear icon in the QwenMate panel header. The sidebar contains nine pages, described below in order.

## Basic Configuration

Appearance, behavior, and runtime environment.

- **Theme**: dark / light, following the IDE or set independently
- **Colors**: user message background and chat bar color, with preset swatches, a custom hex value, and a one-click reset
- **UI font / code font**: follow the IDE editor font by default, or point to a custom font file
- **DIFF theme**: four options, follow panel theme, follow editor, light, soft dark
- **Language**: manual selection or follow the IDE; defaults to Chinese until you set it once
- **Behavior toggles**: switches for conversation behavior such as streaming output, including managed memory (off by default; when on, a turn also waits for the background memory task, which can add tens of seconds to minutes)
- **Notifications**: sound notification (custom sound supported), AskUserQuestion prompts, and more
- **Environment**: Node.js executable path and working directory; the plugin auto-detects Node.js when the path is empty

## Providers

Two tabs:

- **Qwen config**: a read-only list of the models in `~/.qwen/settings.json`, marking the current model and its context window
- **CLI tools**: read-only detection of the local `qwen` command (installed or not, plus version), with an entry point to the install guide

Authentication is likewise managed by the Qwen Code CLI; the plugin has no editing entry point. To change the model or authentication, edit `~/.qwen/settings.json` or use the Qwen Code CLI. The plugin reads the same configuration.

## SDK Dependencies

Install, upgrade, roll back, and reinstall the Qwen Code SDK on this page, offline packages included.

Guidance for incomplete installs and version rollbacks surfaces here as well.

## Usage Stats

Local usage data written by the Qwen Code CLI: token consumption, sessions, requests, tool calls, and lines of code changed. The dimension switches between All / By project / By session (session view shows the selected session for the whole page, and the trend line only for sessions spanning multiple days), across three time windows (today / 7 days / 30 days), with a token split, model share, skill ranking, a daily trend, and a 12-month heatmap; refresh on demand. If your Qwen Code version is too old to record usage data, the page shows a version notice.

## MCP Servers

Manage Model Context Protocol servers:

- Browse the built-in marketplace to add common servers quickly
- Add, edit, and remove server configurations manually
- Inspect connection status and the tool list each server provides

MCP servers configured in the terminal show up here as well; the configuration is shared with the CLI.

## Prompt Enhancer

Configure the prompt enhancer rule that rewrites your input before sending. The rule is customizable and can be reset to the default in one click.

## Commit AI

Configuration for Git commit message generation. The entry point is the IDE's commit panel; see [Getting Started](./getting-started#commit-ai).

## Skills

Browse and manage Qwen Code skills, sharing the same skill directory as the CLI.

## Other Settings

- **Input history completion**: toggle history auto-completion, view and delete history entries, clear low-importance items
- Miscellaneous settings

## Configuration files

| Location | Contents | Who edits it |
| --- | --- | --- |
| `~/.qwen/settings.json` | Model, authentication, MCP, Skills, and other CLI configuration | Qwen Code CLI or direct file edit; the plugin is read-only |
| `~/.qwen/` | CLI session data | Shared between CLI and plugin |
| `~/.qwenmate/` | Plugin data and SDK dependency | Managed by the plugin |

Conversation parameters such as reasoning effort are adjusted in the conversation UI, not on the settings pages.

## Notes

- Plugin and CLI configuration and sessions are fully shared, so anything you set up in the terminal works in the plugin
- Authentication can only be managed through the Qwen Code CLI. The read-only behavior is intentional, to keep two configuration sources from fighting each other
