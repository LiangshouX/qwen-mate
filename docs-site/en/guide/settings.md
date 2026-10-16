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

- **Model Providers**: visual configuration of the model providers and models in `~/.qwen/settings.json`
- **CLI Tools**: read-only detection of the local `qwen` command (installed or not, plus version), with an entry point to the install guide

### Model Providers

The page groups the CLI-preset providers (Alibaba ModelStudio, third-party services, Custom), custom provider buckets, and standalone models, and lets you:

- **Connect / configure / remove**: connect a preset provider and configure its protocol (OpenAI / Anthropic / Gemini compatible), Wire API, endpoint, API key, models (a searchable preset list or custom IDs), and advanced options (thinking, context window, max_tokens, modalities); deletions ask for confirmation
- **Add, edit, and remove models**: model entries cover the full ModelConfig field set (identity, route and credentials, generation config, extra_body, custom headers), and both preset buckets and standalone models are editable one by one
- **API key safety**: the input is a password field and saved keys are never echoed back; status badges show "configured / env variable reference / from shell environment / not set", with a two-step "clear key" action

Changes are written back to the **user-level** `~/.qwen/settings.json` by a local Node service, using the same JSONC-preserving engine as the CLI, so comments, indentation, line endings, and BOM survive untouched, with a pre-write validation and a recovery copy kept on failure. If a project-level `settings.json` defines `modelProviders`, a warning at the top of the page notes the override; this page only edits the user-level file.

Login state stays with the Qwen Code CLI, while API keys can be configured right here on the Model Providers tab.

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
| `~/.qwen/settings.json` | Model, authentication, MCP, Skills, and other CLI configuration | Qwen Code CLI, the plugin (Providers / MCP pages), or a direct file edit |
| `~/.qwen/` | CLI session data | Shared between CLI and plugin |
| `~/.qwenmate/` | Plugin data and SDK dependency | Managed by the plugin |

Conversation parameters such as reasoning effort are adjusted in the conversation UI, not on the settings pages.

## Notes

- Plugin and CLI configuration and sessions are fully shared, so anything you set up in the terminal works in the plugin
- Provider and model changes are written back to the user-level `settings.json` with CLI-identical formatting; login state stays with the Qwen Code CLI
