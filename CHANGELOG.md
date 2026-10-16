# Changelog

##### 1.1.0 (2026-10-17)

Second stable release. The headline addition is a fully visual provider and model configuration for the Qwen Code CLI; the message-queue and usage-dimension work from 1.1.0-beta1 ships in the same release.

Added:

- Providers page upgraded from a read-only view to full visual configuration: connect, reconnect, and remove the 13 CLI-preset providers (Alibaba ModelStudio, third-party services, and Custom), and configure protocol (OpenAI / Anthropic / Gemini compatible), Wire API, endpoint, API key, model IDs (searchable preset list or custom), and advanced options (thinking, context window, max_tokens, modalities)
- Model entries can be added, edited, and removed across the full ModelConfig field set (identity, route and credentials, generation config, extra_body, custom headers); custom provider buckets and standalone models are listed and editable at model level
- API key status badges (configured / env variable reference / from shell environment / not set) with an explicit two-step "clear key" action; saved keys are never echoed back and the input is a password field
- Provider groups can be collapsed, model configuration syncs automatically, and a MiMo Token Plan preset is included
- Configuration is written to the user-level `~/.qwen/settings.json` through a port of the CLI's own algorithm, preserving comments, indentation, line endings, and BOM; writes are validated and published atomically with a recovery copy kept on failure, and deletions cascade like the CLI (active selection cleared, auxiliary models and fallbacks cleaned up, keys still referenced elsewhere kept)
- Message queue UX: queued messages can be put back into the input box one by one or all at once (existing drafts and image attachments are kept); the queue header shows the queued count and "sends when the current task finishes"; new Ctrl+Q queue shortcut (parity with the Qwen Code CLI)
- Usage statistics dimensions: switch between All / By project / By session, with time windows and charts following the dimension (the session dimension shows the selected session for the whole page, and the trend line only for sessions spanning multiple days)
- New "Documentation" entry in the tool window title bar that opens the help site; the open-source banner button is "View on GitHub" again

Fixed:

- Pasting an image file with Ctrl+V in the chat window did nothing (image files now render as thumbnail attachments, see Improvements below)
- Pasting a screenshot turned the message into a long JSON blob that filled the context window: images are now saved to a temp file and referenced via @path, and the CLI reads the image into the message on send (same mechanism as the Qwen Code CLI); bubbles show the @image path instead of rendering the image, and the first message no longer duplicates after sending an image
- Pasting an image did not show the thumbnail immediately and could freeze or hang the UI: image reading and preview generation moved off the UI thread, and only a small preview is transferred
- Sending an image file made the model recognize the same image twice and duplicate its content
- The first image message in a new session rendered two bubbles
- The first bubble after sending an image lacked the @image path reference and only appeared after clicking "Load earlier messages" (which then looked duplicated): the @image path now shows at send time
- The context usage percentage stopped updating while a task was running: usage is now pushed per turn with a CLI snapshot fallback, so it refreshes live
- The context percentage read too high under a warm cache: the metric now uses a single input value and no longer double-counts cache reads

Improvements:

- Unified the two image channels (screenshot paste vs. Explorer file copy): copied image files now render as thumbnails in the input box (same as screenshots, carrying the original file name and path) instead of inserting an @file reference; bubbles consistently show @path + text and no longer render inline images or the CLI-expanded "Content from referenced files" wrapper
- @path references to images outside the workspace (e.g. an external image path pasted into chat) are copied to temp files and inlined before sending, so the model sees the image directly without an extra file-read round trip
- Provider writes refuse to touch a broken or read-only settings.json, reject reserved keys, and keep the rest of the file byte-for-byte intact; API keys are passed to the local Node service over stdin and never logged

##### 1.1.0-beta1 (2026-10-16)

Added:

- Message queue UX: queued messages can be put back into the input box one by one or all at once (existing drafts and image attachments are kept); the queue header shows the queued count and "sends when the current task finishes"; new Ctrl+Q queue shortcut (parity with the Qwen Code CLI)
- Usage statistics dimensions: switch between All / By project / By session, with time windows and charts following the dimension (the session dimension shows the selected session for the whole page, and the trend line only for sessions spanning multiple days)
- New "Documentation" entry in the tool window title bar that opens the help site; the open-source banner button is "View on GitHub" again

Fixed:

- Pasting an image file with Ctrl+V in the chat window did nothing (image files now render as thumbnail attachments, see Improvements below)
- Pasting a screenshot turned the message into a long JSON blob that filled the context window: images are now saved to a temp file and referenced via @path, and the CLI reads the image into the message on send (same mechanism as the Qwen Code CLI); bubbles show the @image path instead of rendering the image, and the first message no longer duplicates after sending an image
- Pasting an image did not show the thumbnail immediately and could freeze or hang the UI: image reading and preview generation moved off the UI thread, and only a small preview is transferred
- Sending an image file made the model recognize the same image twice and duplicate its content
- The first image message in a new session rendered two bubbles
- The first bubble after sending an image lacked the @image path reference and only appeared after clicking "Load earlier messages" (which then looked duplicated): the @image path now shows at send time
- The context usage percentage stopped updating while a task was running: usage is now pushed per turn with a CLI snapshot fallback, so it refreshes live
- The context percentage read too high under a warm cache: the metric now uses a single input value and no longer double-counts cache reads

Improvements:
- Unified the two image channels (screenshot paste vs. Explorer file copy): copied image files now render as thumbnails in the input box (same as screenshots, carrying the original file name and path) instead of inserting an @file reference; bubbles consistently show @path + text and no longer render inline images or the CLI-expanded "Content from referenced files" wrapper
- @path references to images outside the workspace (e.g. an external image path pasted into chat) are copied to temp files and inlined before sending, so the model sees the image directly without an extra file-read round trip

##### 1.0.0 (2026-10-13)

First stable release. Visual GUI for Qwen Code, a JetBrains IDE plugin, MIT licensed.

Features:

- Intelligent conversation: streaming output with thinking display; @ file references, # agent invocation, ! prompt insertion; image attachments; prompt enhancer
- Reasoning effort: five tiers (low / medium / high / xhigh / max) from the input box menu or the `/effort` command, with an interactive selector on Enter
- Usage statistics: local token consumption, sessions/requests/tool calls, lines of code changed, model share, skill ranking, daily trend and heatmap, switchable across today / 7 days / 30 days
- Code Diff: visual comparison of changes with navigation into the editor
- Session management: history, restore, favorites, search, export, AI-generated session titles
- IDE integration: editor popup actions to send selected code (Ctrl+Alt+K / Cmd+Alt+K), quick fix (Ctrl+Shift+Q), file tree and console sending, run/debug output monitoring
- Commit AI: one-click Git commit messages in the commit panel
- MCP servers: built-in marketplace browsing, add/edit/remove, connection status and tool lists
- Skills: browse and manage Qwen Code skills
- Slash commands: aligned with the full Qwen Code command set, calibrated by the runtime list; unsupported commands are reported locally
- Managed memory: toggle in the input box settings popover (off by default), fixing the long wait after a turn ends
- Approval dialogs before the AI edits files or performs sensitive actions
- Appearance and i18n: light/dark themes, IDE font sync, 10 UI languages, Chinese by default
- SDK dependency management: online install, update, and rollback of the Qwen Code SDK, offline packages supported
- CLI detection: read-only detection of the locally installed qwen CLI
- Qwen config (read-only): reads ~/.qwen/settings.json to show the model catalog and current model; authentication stays with the Qwen Code CLI and cannot be edited in the plugin

Fixed:

- Fixed a completely blank chat panel after rebooting the machine (restarting the IDE did not help): the tool window title bar now has a refresh button (same entry in the gear menu and the startup-failure panel) that rebuilds the interface in one click, and failed startup retries are no longer silent
- Fixed the reasoning effort selected in the input box not taking effect; it now applies to that turn and the rest of the conversation
- Fixed a long spinner after a turn ends; the first response also arrives faster
- Fixed the same error message being shown multiple times after a failure
- Fixed slash commands unsupported in the current mode only failing after a full turn
- Fixed the UI becoming unresponsive when pasting an image as a message
- Fixed errors when typing `/mcp` and `/skills` (they now jump to the matching settings page) and a crash when resuming a session that starts with a slash command
- Fixed offline packaging picking a stale package instead of the newest by modification time

Improvements:

- Various UX improvements

##### 1.0.0-beta3 (2026-10-11)

Added:

- Click-to-select slash commands: typing `/effort` and pressing Enter opens the reasoning-effort selector (mirroring the CLI's interactive picker), linked to the input box "reasoning effort" menu across five tiers (low / medium / high / xhigh / max)

Fixed:

- Fixed the reasoning effort selected in the input box not taking effect; it now applies to that turn and the rest of the conversation
- Fixed the same error message being shown multiple times after a failure; only one is shown now
- Fixed sending unsupported commands like `/rename` only failing after a full turn; they are now rejected locally with a list of available commands
- Fixed the UI becoming unresponsive when pasting an image as a message
- Fixed errors when typing `/mcp` and `/skills` (they now jump to the matching settings page) and a crash when resuming a session that starts with a slash command

Improvements:

- Various UX improvements

##### 1.0.0-beta2 (2026-10-10)

Added:

- Usage statistics: a new [Usage Stats] settings page parsing local Qwen Code usage data, showing token consumption, sessions/requests/tool calls, lines of code changed, model share, skill ranking, daily trend line and heatmap, switchable across today / 7 days / 30 days with manual refresh; shows a version notice when Qwen Code is older than 0.18.0 (which records no usage data)
- Managed memory toggle: a quick toggle in the chat input settings popover, injected via the system-defaults layer (off by default), fixing the long wait after a turn ends
- Slash commands: aligned with the full Qwen Code command set and calibrated against the runtime list, so the actually available commands win

Fixed:

- Fixed the status bar staying in "waiting" after a turn ends; the daemon and SDK are prewarmed as soon as the frontend is ready, so the first response arrives faster
- Fixed offline packaging picking a stale package instead of the newest by modification time

Improvements:

- Various UX improvements

##### 1.0.0-beta1 (2026-10-07)

First release. Visual GUI for Qwen Code, a JetBrains IDE plugin, MIT licensed.

Features:

- Intelligent conversation: streaming output with thinking display; @ file references, # agent invocation, ! prompt insertion; image attachments; prompt enhancer
- Code Diff: visual comparison of changes with navigation into the editor
- Session management: history, restore, favorites, search, export, AI-generated session titles
- IDE integration: editor popup actions to send selected code (Ctrl+Alt+K / Cmd+Alt+K), quick fix (Ctrl+Shift+Q), file tree and console sending, run/debug output monitoring
- Commit AI: one-click Git commit messages in the commit panel
- MCP servers: built-in marketplace browsing, add/edit/remove, connection status and tool lists
- Skills: browse and manage Qwen Code skills
- Approval dialogs before the AI edits files or performs sensitive actions
- Appearance and i18n: light/dark themes, IDE font sync, 10 UI languages, Chinese by default
- SDK dependency management: online install, update, and rollback of the Qwen Code SDK, offline packages supported
- CLI detection: read-only detection of the locally installed qwen CLI
- Qwen config (read-only): reads ~/.qwen/settings.json to show the model catalog and current model; authentication stays with the Qwen Code CLI and cannot be edited in the plugin
