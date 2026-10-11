# Settings Reference

Open settings from the gear icon in the QwenMate panel header. The sidebar contains nine pages, described below in order.

## Basic Configuration

Appearance and behavior.

- **Theme**: dark / light, following the IDE or set independently
- **Colors**: user message background and chat bar color, with preset swatches, a custom hex value, and a one-click reset
- **UI font / code font**: follow the IDE editor font by default, or point to a custom font file
- **DIFF theme**: four options, follow panel theme, follow editor, light, soft dark
- **Language**: manual selection or follow the IDE; defaults to Chinese until you set it once
- **Behavior toggles**: switches for conversation behavior such as streaming output
- **Notifications**: sound notification (custom sound supported), AskUserQuestion prompts, and more

## Providers

A read-only view of the model catalog and current model from `~/.qwen/settings.json`. Authentication is likewise managed by the Qwen Code CLI; the plugin has no editing entry point.

To change the model or authentication, edit `~/.qwen/settings.json` or use the Qwen Code CLI. The plugin reads the same configuration.

## SDK Dependencies

Install, upgrade, roll back, and reinstall the Qwen Code SDK on this page, offline packages included. The page also shows the read-only detection status of the local `qwen` CLI.

Guidance for incomplete installs and version rollbacks surfaces here as well.

## Usage Stats

Model usage statistics with token consumption broken down by session and model.

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
