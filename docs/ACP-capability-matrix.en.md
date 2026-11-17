# ACP vs QwenMate — Capability Matrix

> Purpose: to state, with **verifiable evidence**, what JetBrains users actually get from the official ACP path, what they do not get, and which segment QwenMate covers.
>
> Audience: Qwen Code maintainers / JetBrains users / the community.
>
> Evidence base (upstream `QwenLM/qwen-code`, `main`):
> - `packages/acp-bridge/src/status.ts` — `SERVE_STATUS_EXT_METHODS`, `SERVE_CONTROL_EXT_METHODS`, `STATUS_SCHEMA_VERSION`
> - `packages/sdk-typescript/src/daemon/acpRouteTable.ts` — the shared route table
> - `packages/cli/src/serve/acp-http/transport.test.ts` — tests that call `_qwen/workspace/mcp` over plain JSON-RPC
> - `packages/sdk-java/` — the official Java SDK and the `com.alibaba.acp.sdk.protocol` schema
> - `docs/users/integration-jetbrains.md` — the documented JetBrains path
> - `packages/` top level — `acp-bridge`, `sdk-typescript`, `sdk-java`, `vscode-ide-companion`, `zed-extension`, `desktop`, `web-shell`, … (**no `jetbrains` package**)
>
> Every ✅/❌/⚠️ below is annotated with its source. Items that cannot be verified from public code are marked ⚠️ with the reason.

---

## 0. Summary

**Qwen Code already ships an official, versioned, IDE-consumable surface of Qwen-specific capabilities (`_qwen/*` extension methods, ~70 of them) — but it does not live in standard ACP. JetBrains AI Assistant implements only standard ACP, so that entire surface is invisible to JetBrains users. QwenMate covers exactly that segment.**

The nuance that matters: **QwenMate does not consume `_qwen/*` either.** It ships its own TypeScript runtime and parses `~/.qwen` local files directly. So both the "official path" and the "QwenMate path" are private paths today. What is missing in between is a **workspace-status surface on the official Java SDK side** — and that is the shape of adoption worth pursuing (see §6).

---

## 1. Three capability layers

The real ceiling for JetBrains is only visible once you separate three fundamentally different sources of capability.

### Layer 1 — Standard ACP (cross-vendor protocol)

Implemented by every ACP client. On the Qwen side: the non-`_qwen/` entries of `ROUTE_TABLE` in `packages/sdk-typescript/src/daemon/acpRouteTable.ts`, and the schema in `packages/sdk-java/client/src/main/java/com/alibaba/acp/sdk/protocol/` (domains: `agent` / `client` / `content` / `mcp` / `permission` / `plan` / `session` / `terminal` / `tool`).

`session/new` · `session/prompt` · `session/cancel` · `session/close` · `session/load` · `session/resume` · `session/set_model` · `session/permission` · `session/fork` · `session/list` · `fs/read_text_file` · `fs/write_text_file` · `terminal/*` · `session/update` notifications (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`, `usage`)

**This is everything JetBrains AI Assistant can consume.** ACP is cross-vendor by design; JetBrains will not implement a vendor-private extension for one agent.

### Layer 2 — Qwen-private extensions `_qwen/*` (same JSON-RPC wire, client must opt in)

Qwen's own extension methods, carried on the **same JSON-RPC wire** with a `_qwen/` method-name prefix. The contract is pinned as constant tables in `packages/acp-bridge/src/status.ts`, and the status side is versioned by `STATUS_SCHEMA_VERSION = 1`. Upstream deliberately separates read-only diagnostics (`SERVE_STATUS_EXT_METHODS`) from mutations (`SERVE_CONTROL_EXT_METHODS`) — the comment states this is done "so reviewers can grep mutation surface independently from read-only diagnostics".

**Status surface (read-only, ~30)** — `workspace/mcp`, `workspace/mcp/tools`, `workspace/mcp/resources`, `workspace/skills`, `workspace/tools`, `workspace/providers`, `workspace/memory`, `workspace/agents`, `workspace/preflight`, `workspace/trust`, `workspace/hooks`, `workspace/extensions`, `workspace/resource`, `session/context`, `session/context_usage`, `session/supported_commands`, `session/tasks`, `session/agents`, `session/agent_trace`, `session/stats`, `session/lsp`, `session/resources`, `session/saved_workflow`, `session/transcript`, `session/turn_index`, `session/rewind_snapshots`

**Control surface (mutating, ~40)** — `session/close`, `session/approval_mode`, `session/branch`, `session/side_task`, `session/fork_agent`, `session/continue`, `session/parent`, `session/source`, `session/generation/start|cancel`, `workspace/generation/start|cancel`, `session/title`, `session/recap`, `session/btw`, `session/live-conversation`, `session/live-transcript`, `session/background_notification`, `session/external_record`, `session/shell_history`, `session/language`, `session/rewind`, `workspace/mcp/manage|restart|initialize|reload`, `workspace/mcp/servers/add|remove`, `workspace/memory/write|remember|forget|dream`, `workspace/agents/list|create|get|delete|generate`, `workspace/permissions`, `workspace/permissions/set`, `workspace/trust/request|grant`, `workspace/auth/status`, `workspace/auth/device-flow/*`, `workspace/init`, `workspace/set_tool_enabled`, `workspace/setup-github`, `workspace/voice/set`, `workspace/session_groups/*`, `sessions/delete|archive|unarchive`

### Layer 3 — CLI local asset layer (files outside the agent process)

`~/.qwen/settings.json` (`modelProviders`, `models`, `mcpServers`, hooks, permissions, trusted folders, context file name, auto memory, theme) · `~/.qwen/projects/<project>/<session>.jsonl` · `~/.qwen/commands/` and `.qwen/commands/` · skills directories · local usage records · Qwen OAuth / API-key auth state (CLI-owned)

**Layer 2 and Layer 3 both sit outside standard ACP.** The JetBrains capabilities described in `docs/users/integration-jetbrains.md` (conversation history, reasoning effort, context usage, `#` mentions) all fall inside Layer 1 — i.e. exactly what a third-party client can implement generically.

---

## 2. Capability matrix

✅ present · ❌ absent · ⚠️ partial or mechanism not public

| Capability | In Qwen Code? | In standard ACP? | Visible in JetBrains AI Assistant? | In QwenMate? | How QwenMate gets it |
|---|---|---|---|---|---|
| Streaming chat + thought process | ✅ | ✅ `agent_message_chunk` / `agent_thought_chunk` | ✅ | ✅ | TS bridge event stream |
| Reasoning effort (5 tiers) | ✅ | ⚠️ via session-mode negotiation | ⚠️ official docs claim support | ✅ | Input menu + `/effort` |
| Context-usage indicator | ✅ | ⚠️ depends on `usage` notification shape | ⚠️ official docs claim support | ✅ | `get_context_usage` bridge event |
| `@` file references | ✅ | ✅ `resource_link` | ✅ | ✅ | Frontend → CLI |
| `#` agent / `!` prompt | ✅ | ⚠️ non-standard semantics | ❌ | ✅ | CLI-side semantics |
| Slash commands (Qwen command table) | ✅ | ❌ | ❌ | ✅ | Full built-in table, calibrated against the CLI's runtime list |
| CLI-side session history | ✅ | ⚠️ `session/list` is limited | ⚠️ official docs claim support | ✅ | Reads `~/.qwen/projects/` |
| Session favorites / search / export | ✅ (local) | ❌ | ❌ | ✅ | Local session files |
| AI session titles | ✅ | ✅ `session/title` (Layer 2) | ❌ | ✅ | Generated locally |
| MCP server browse / add / edit / remove | ✅ | ❌ (tool calls only) | ❌ | ✅ | Reads/writes `~/.qwen/settings.json` |
| MCP marketplace + tool lists | ✅ | ❌ | ❌ | ✅ | Official MCP registry + status probing |
| Skills browsing and management | ✅ | ❌ | ❌ | ✅ | Local skills directories |
| Custom command management | ✅ | ❌ | ❌ | ✅ | `~/.qwen/commands/`, `.qwen/commands/` |
| Visual provider & model configuration | ✅ | ❌ | ❌ | ✅ | Reads/writes `~/.qwen/settings.json` (comments/format preserved, atomic write-back) |
| API-key status badges (write-only) | ✅ | ❌ | ❌ | ✅ | Local Node service writes them |
| Usage stats (tokens / trends / heatmap) | ✅ (local records) | ❌ | ❌ | ✅ | Parses local usage data |
| Session introspection (context / stats / tasks / agents / lsp) | ✅ | ❌ (Layer 2) | ❌ | ⚠️ partial | Custom bridge |
| Memory read/write, agent CRUD | ✅ | ❌ (Layer 2) | ❌ | ⚠️ partial (browse) | Local directories |
| Hooks / workflows | ✅ | ❌ (Layer 2) | ❌ | ❌ | — |
| Permission approval | ✅ | ✅ `session/permission` | ✅ | ✅ | Bridge + dialog |
| Visual diff + editor navigation | ✅ (CLI side) | ⚠️ depends on IDE diff channel | ❌ | ✅ | Custom diff + IDE navigation |
| Editor send-selection / quick fix | — (IDE side) | ❌ | ⚠️ limited | ✅ | IntelliJ actions |
| File tree / console send, run-debug monitoring | — (IDE side) | ❌ | ❌ | ✅ | IntelliJ platform APIs |
| Commit AI | — (IDE side) | ❌ | ❌ | ✅ | git4idea + CLI |
| Prompt enhancer | — (IDE side) | ❌ | ❌ | ✅ | Frontend rewrite |
| Auth state (Qwen sign-in) | ✅ | ⚠️ Layer 2 `workspace/auth/status` | ❌ | ⚠️ CLI install detection only | — |
| SDK dependency management (install/rollback/offline) | — | ❌ | ❌ | ✅ | Plugin-managed |

---

## 3. Why JetBrains users cannot reach Layer 2 / Layer 3

This is the section most in need of upstream confirmation. Three pieces of evidence:

**Evidence 1 — standard ACP's boundary is the third-party client's boundary.**
`_qwen/*` are vendor-private extensions. JetBrains AI Assistant is a third-party client and will not implement one vendor's private extensions. That is by design: cross-vendor ACP exists so an IDE depends on the protocol, not on any particular agent's private features.

**Evidence 2 — these methods are real and test-covered on the Qwen side.**
`packages/cli/src/serve/acp-http/transport.test.ts` posts plain JSON-RPC with `method: '_qwen/workspace/mcp'` and asserts the response; `packages/acp-bridge/src/status.ts` pins the contract as constant tables and versions the status payload with `STATUS_SCHEMA_VERSION = 1`. **The capability is server-side ready. What is missing is an IDE client that consumes it.**

**Evidence 3 — the official Java SDK currently covers the session surface, not the workspace status surface.**
`packages/sdk-java/qwencode/README.md` documents the artifact `com.alibaba:qwencode-sdk:0.1.0-alpha` (Java 11+, Maven):

- **Daemon API (recommended)** — `DaemonClient` / `DaemonSessionClient`, REST mutations + resumable SSE observation, `promptText()` / `startPrompt()` / `respondToPermission()` / `cancelActivePrompt()` / `detachSession()`
- **Legacy stdio API** — `com.alibaba.qwen.code.cli.QwenCodeCli`
- **Protocol schema** — `com.alibaba.acp.sdk.protocol.*` (standard ACP)

Searching `packages/sdk-java` for `workspace/mcp`, `workspace/skills`, `workspace/providers`, `supported_commands`, `context_usage` returns **zero matches**.

> **So: the official Java SDK has session capability but no workspace status surface — and the workspace status surface (MCP management, skills, providers, memory, trust, auth) is exactly what a complete JetBrains plugin needs most.**

---

## 4. Honest disclosure of QwenMate's current path

QwenMate does **not** use the official path either:

| Area | What QwenMate actually does |
|---|---|
| Engine | Bundled TypeScript runtime + Qwen Code TS SDK (release artifact ≈ 21 MB) |
| Providers / MCP / model config | Reads and writes `~/.qwen/settings.json` through a **port of the CLI's own algorithm** — comments, indentation, line endings and BOM preserved; atomic write with rollback on failure |
| Session history | Reads `~/.qwen/projects/` |
| Usage stats | Parses local usage records |
| Context usage | Custom bridge event `get_context_usage` |
| `_qwen/*` extensions | **Not used** — no `_qwen/` call anywhere in the repository |

Both sides of that:
- ✅ **Strength** — no daemon dependency, works with any CLI version; deeper semantics for `~/.qwen` than a generic client would bother to implement (JSONC-preserving write-back, provider catalog, model field set, API-key handling).
- ⚠️ **Risk** — parsing local files couples the plugin to CLI internals; a bundled TS runtime means a large artifact and a wider supply-chain surface; the obvious maintainer question is "why not the official Java SDK?"

---

## 5. What the matrix says

### 5.1 The differentiation window is closing — but not to ACP

`docs/users/integration-jetbrains.md` already claims JetBrains support for conversation history, reasoning effort (Default / Low / Medium / High / Extra high / Max), context usage, and `#` symbol mentions. All of these are Layer 1 and generically implementable. **Session history, an effort picker and a context indicator are therefore not differentiators** — they are what the official path already promises.

The genuine differentiators live in Layer 2/3: MCP and skills management, visual provider/model configuration, usage statistics, custom command management, the full slash-command table, session favorites/search/export, auth-state visibility — plus the whole IDE-side integration layer (send-selection, quick fix, diff navigation, Commit AI, run/debug monitoring).

### 5.2 The official ACP path is not frictionless either

Upstream issue **#6581** (Jul 2026, "JetBrains Qwen Code ACP agent does not receive user prompt, only bootstrap context") documents a real JetBrains+ACP integration defect: AI Assistant silently auto-attaches the active editor file, burying the user's instruction. The Qwen side fixed request assembly order in **#6607**; the JetBrains side tracks **LLM-28933**. "Wire up ACP and you get the native experience" is not accurate — a Qwen-aware client still has independent value.

### 5.3 The niche is uncontested — but say so explicitly

The other multi-engine JetBrains GUI on the Marketplace (CC GUI, 1,359,743 downloads) supports Claude Code / Codex / Grok / Kimi / OpenCode / PI / OMP / DeepSeek Harness — **but not Qwen Code**. No strong peer currently occupies the Qwen direction on JetBrains.

---

## 6. The adoption shape worth proposing

Do not ask for the plugin to be adopted. **The team has no incentive to merge a third-party plugin into its own repository.** Three shapes do have clear incentives:

### Shape A (recommended) — extend the official Java SDK with the workspace status surface; QwenMate serves as the reference client

- **Upstream gains:** the Java SDK has sessions but not workspace state. A complete JetBrains plugin needs MCP / skills / providers / memory / trust / auth on the Java side. Adding it is a one-off, reusable SDK enhancement rather than a plugin-private implementation.
- **QwenMate gains:** moving Layer 2/3 retrieval from "parse local files + private TS bridge" to "official Java SDK + official `_qwen/*` contract" means a much smaller artifact (the Node runtime can retire), no coupling to CLI file formats, no "brittle private SDK" objection — and a **direct upstream contribution path** (a PR against `packages/sdk-java`). The role flips from "please adopt me" to "building this with you".
- **Concretely:** open a PR against `packages/sdk-java` adding the workspace status surface and its `_qwen/*` contract, with QwenMate as a working third-party Java client that validates it.

### Shape B — official documentation / community listing

Searching upstream `docs/` for "ecosystem" yields only incidental hits — **there is currently no third-party listing page**. Landing a link requires first opening an issue about where third-party IDE integrations belong (the README's Integrations section, or a third-party-integrations doc page).

### Shape C — upstream commissions a first-party JetBrains plugin

The most favourable shape for the author: official distribution plus Marketplace reach, and署名. The trigger is upstream deciding ACP is insufficient and worth staffing.

---

## 7. Migration path off local-file parsing

| Current implementation | Target | Benefit | Risk |
|---|---|---|---|
| Parse `modelProviders` from `~/.qwen/settings.json` | `_qwen/workspace/providers` | No private-format parsing | Requires `qwen serve` |
| Read/write `mcpServers` in `settings.json` | `_qwen/workspace/mcp` + `workspace/mcp/manage` | Official write semantics | Mutations need care |
| Read `~/.qwen/projects/` for sessions | `session/list` + `session/transcript` | Versioned | Backwards compatibility needs verification |
| Custom `get_context_usage` | `_qwen/session/context_usage` | Same accounting as the CLI | — |
| Parse local usage records | `_qwen/session/stats` | Unified accounting | Must confirm dimension coverage |
| Private TS bridge (sessions / streaming) | Official Java SDK daemon API (REST + SSE) | Drops Node and the private protocol | Daemon lifecycle and auth handling |

Suggested order: migrate **read-only** capabilities first (providers / skills / mcp status / context / stats) and keep local file reads as a **fallback** for older CLIs or when the daemon is unavailable; then migrate writes. Always negotiate on `STATUS_SCHEMA_VERSION` so a private-extension change degrades instead of hard-failing.

---

## 8. Caveats before publishing

1. **Refresh the numbers.** Marketplace downloads, rating, plugin version and repository stars are live figures (snapshot: 2026-11-10). Re-pull them before publishing.
2. **Separate "verified" from "official docs claim".** ⚠️ rows come from the official JetBrains documentation, but JetBrains' client implementation is not public, so the mechanism cannot be verified from code. Say so when quoting them upstream.
3. **Do not describe the ❌ cells as an official defect.** Layer 2/3 being outside standard ACP is **by design** — a third-party client should not depend on vendor-private extensions. The accurate framing is: *this requires a Qwen-aware client.*
4. **Re-check cited issues.** #6581 / #6607 were verified here. The original QwenMate announcement also cites #2247 / #8544; those were not independently re-verified for this document (both are open `feature/need-help` with no replies) — confirm before quoting.

---

## Appendix — evidence index

| Claim | Source |
|---|---|
| No official JetBrains package | `QwenLM/qwen-code` `packages/` (main): `acp-bridge`, `sdk-typescript`, `sdk-java`, `vscode-ide-companion`, `zed-extension`, `desktop`, `web-shell`, … — no `jetbrains` entry |
| Standard ACP method set | `packages/sdk-typescript/src/daemon/acpRouteTable.ts` (non-`_qwen/` entries of `ROUTE_TABLE`) |
| Qwen private extension tables | `packages/acp-bridge/src/status.ts` (`SERVE_STATUS_EXT_METHODS` L129, `SERVE_CONTROL_EXT_METHODS` L174, `STATUS_SCHEMA_VERSION` L11) |
| Extensions travel on the same JSON-RPC wire | `packages/cli/src/serve/acp-http/transport.test.ts` (JSON-RPC `method: '_qwen/workspace/mcp'` with asserted response) |
| Official Java SDK and its boundary | `packages/sdk-java/qwencode/README.md` (`com.alibaba:qwencode-sdk:0.1.0-alpha`; Daemon API / legacy stdio API); `packages/sdk-java/client/src/main/java/com/alibaba/acp/sdk/protocol/` |
| Java SDK has no workspace status surface | Full-tree search in `packages/sdk-java` for `workspace/mcp`, `workspace/skills`, `workspace/providers`, `supported_commands`, `context_usage` → zero matches |
| Official JetBrains capability claims | `docs/users/integration-jetbrains.md` |
| QwenMate capabilities | This repository: `src/main/resources/META-INF/plugin.xml`, `README.md`, module inventory (`provider`, `mcp`, `skill`, `usage`, `session`, `settings`) |
| QwenMate does not use `_qwen/*` | Repository-wide search for `_qwen/` → only QwenMate's own bridge event names (e.g. `get_context_usage`) |
| A real defect on the ACP path | Upstream issue #6581 (Jul 2026), PR #6607, JetBrains YouTrack LLM-28933 |
| Niche position | JetBrains Marketplace: plugin 34842 (QwenMate), plugin 29342 (CC GUI — supported CLI list contains no Qwen Code) |
