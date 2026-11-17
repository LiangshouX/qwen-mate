# ACP vs QwenMate 能力矩阵

> 目的：用**可核验的证据**说明 JetBrains 用户通过官方 ACP 通路实际能拿到什么、拿不到什么，以及 QwenMate 补的是哪一段。
>
> 面向对象：Qwen Code 官方维护者 / JetBrains 用户 / 社区。
>
> 取证基线：
> - 上游 `QwenLM/qwen-code`（`main` 分支，packages 目录快照 + `packages/acp-bridge/src/status.ts`、`packages/sdk-typescript/src/daemon/acpRouteTable.ts`、`packages/cli/src/serve/acp-http/transport.test.ts`、`packages/sdk-java/`）
> - 上游文档 `docs/users/integration-jetbrains.md`
> - QwenMate 本仓库（`src/main` 282 个 Java 文件 / 3.12 MB，`src/test` 130 个测试文件 / 0.89 MB）
> - JetBrains Marketplace 插件 34842
>
> 文中所有"✅/❌/⚠️"均标注了取证来源；无法从公开代码核实的项标为 ⚠️ 并说明原因。

---

## 0. 一句话结论

**Qwen Code 已经有一套官方、版本化、可被任意 IDE 客户端消费的 Qwen 专有能力面（`_qwen/*` 扩展方法，约 70 个），但它没有出现在标准 ACP 里；而 JetBrains AI Assistant 只实现标准 ACP —— 于是这整个能力面对 JetBrains 用户完全不可见。QwenMate 补的就是这一段。**

但要点在于：**QwenMate 目前也没有走 `_qwen/*`，而是自带 TypeScript 运行时 + 直接解析 `~/.qwen` 本地文件**。也就是说，现有的"官方路径"与"QwenMate 路径"都是私有路径，中间缺的是**官方 Java SDK 侧的 workspace 状态面**。这正是最有价值的收编形态（见 §6）。

---

## 1. 三层能力模型

要判断 JetBrains 侧的真实天花板，必须区分三种性质完全不同的能力来源。

### Layer 1 — 标准 ACP（第三方协议，跨厂商通用）

任何实现了 ACP 的客户端都支持的方法。Qwen Code 侧对应 `packages/sdk-typescript/src/daemon/acpRouteTable.ts` 中**不带 `_qwen/` 前缀**的条目，以及 `packages/sdk-java/client/src/main/java/com/alibaba/acp/sdk/protocol/` 下的协议 schema（域：`agent` / `client` / `content` / `mcp` / `permission` / `plan` / `session` / `terminal` / `tool`）。

| 方法 | 语义 |
|---|---|
| `session/new` | 创建会话（ACP 标准始终创建隔离会话） |
| `session/prompt` | 发送一轮提示 |
| `session/cancel` | 取消当前轮（notification） |
| `session/close` | 关闭会话 |
| `session/load` / `session/resume` | 加载 / 恢复会话 |
| `session/set_model` | 切换模型 |
| `session/permission` | 权限审批往返 |
| `session/fork` | 分叉会话 |
| `session/list` | 列出会话 |
| `fs/read_text_file` / `fs/write_text_file` | 文件读写代理 |
| `terminal/*` | 终端输出与等待退出 |
| `session/update`（通知） | `agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` / `plan` / `available_commands_update` / `current_mode_update` / `usage` 等 |

**这一层是 JetBrains AI Assistant 能消费的全部。** 它是跨厂商协议，JetBrains 不可能为 Qwen 单独扩展。

### Layer 2 — Qwen 专有扩展 `_qwen/*`（同一 JSON-RPC 线，需客户端主动实现）

Qwen Code 在标准 ACP 之上定义的**厂商私有扩展方法**，走**同一条 JSON-RPC 线**，方法名带 `_qwen/` 前缀。取证：`packages/acp-bridge/src/status.ts` 的 `SERVE_STATUS_EXT_METHODS` / `SERVE_CONTROL_EXT_METHODS` 常量表，以及 `packages/cli/src/serve/acp-http/transport.test.ts` 中直接以 `method: '_qwen/workspace/mcp'` 发起 JSON-RPC 并断言响应的用例。

上游还为状态面提供了**版本化 schema**：`STATUS_SCHEMA_VERSION = 1`，并刻意把**只读诊断面**（`SERVE_STATUS_EXT_METHODS`）与**变更控制面**（`SERVE_CONTROL_EXT_METHODS`）拆成两张表，注释里明确写了"so reviewers can grep mutation surface independently from read-only diagnostics"。

**状态面（只读，~30 个）**

| 域 | 方法 |
|---|---|
| MCP | `workspace/mcp`、`workspace/mcp/tools`、`workspace/mcp/resources` |
| Skills / 工具 | `workspace/skills`、`workspace/tools` |
| 供应商 | `workspace/providers` |
| 记忆 | `workspace/memory` |
| 子代理 | `workspace/agents`、`session/agents`、`session/agent_trace` |
| 预检 / 信任 | `workspace/preflight`、`workspace/trust` |
| Hooks / 扩展 | `workspace/hooks`、`session/hooks`、`workspace/extensions` |
| 进程 | `workspace/resource` |
| 会话内省 | `session/context`、`session/context_usage`、`session/supported_commands`、`session/tasks`、`session/stats`、`session/lsp`、`session/resources`、`session/saved_workflow`、`session/transcript`、`session/turn_index`、`session/rewind_snapshots` |

**控制面（变更，~40 个）**

| 域 | 方法 |
|---|---|
| 会话生命周期 | `session/close`、`session/approval_mode`、`session/branch`、`session/side_task`、`session/fork_agent`、`session/continue`、`session/parent`、`session/source` |
| 生成控制 | `session/generation/start`、`session/generation/cancel`、`workspace/generation/start`、`workspace/generation/cancel` |
| 标题 / 回顾 | `session/title`、`session/recap`、`session/btw` |
| 实时流 | `session/live-conversation`、`session/live-transcript`、`session/background_notification`、`session/external_record`、`session/shell_history`、`session/language` |
| 回退 | `session/rewind` |
| MCP 管控 | `workspace/mcp/manage`、`workspace/mcp/restart`、`workspace/mcp/initialize`、`workspace/mcp/reload`、`workspace/mcp/servers/add`、`workspace/mcp/servers/remove` |
| Skills/记忆 | `workspace/memory/write`、`workspace/memory/remember`、`workspace/memory/forget`、`workspace/memory/dream` |
| 子代理 | `workspace/agents/list`、`workspace/agents/create`、`workspace/agents/get`、`workspace/agents/delete`、`workspace/agents/generate` |
| 权限 / 信任 | `workspace/permissions`、`workspace/permissions/set`、`workspace/trust/request`、`workspace/trust/grant` |
| 认证 | `workspace/auth/status`、`workspace/auth/device-flow/*` |
| 其他 | `workspace/init`、`workspace/set_tool_enabled`、`workspace/setup-github`、`workspace/voice/set`、`workspace/session_groups/*`、`sessions/delete`、`sessions/archive`、`sessions/unarchive` |

### Layer 3 — CLI 本地资产层（进程之外的文件）

ACP 不覆盖、也不打算覆盖的一层。Qwen Code 的实际配置与状态大量落在这里：

| 资产 | 位置 |
|---|---|
| 供应商与模型目录 | `~/.qwen/settings.json` → `modelProviders` / `models` |
| MCP 服务器定义 | `~/.qwen/settings.json` → `mcpServers` |
| 会话记录 | `~/.qwen/projects/<project>/<session>.jsonl` |
| 自定义命令 | `~/.qwen/commands/`、`.qwen/commands/` |
| Skills | Qwen Code 的 skills 目录 |
| 用量数据 | 本机用量记录（Qwen Code < 0.18.0 不记录） |
| 认证态 | Qwen OAuth 登录态 / API Key（由 CLI 管理） |
| 其余设置 | hooks、trusted folders、context file name、auto memory、theme 等 |

**关键点：Layer 2 和 Layer 3 都超出标准 ACP。** 官方文档 `docs/users/integration-jetbrains.md` 描述的 JetBrains 能力，落在 Layer 1 范围内（会话历史、推理力度、上下文占用、`#` 符号引用）。

---

## 2. 能力矩阵

图例：✅ 有　❌ 无　⚠️ 部分 / 依赖私有实现，未公开

| 能力域 | Qwen Code 有？ | 标准 ACP 暴露？ | JetBrains AI Assistant 可见？ | QwenMate 提供？ | QwenMate 取数路径 |
|---|---|---|---|---|---|
| 流式对话与思考过程 | ✅ | ✅ `agent_message_chunk` / `agent_thought_chunk` | ✅ | ✅ | TS 桥接事件流 |
| 思考强度（5 档） | ✅ | ⚠️ 经会话模式协商，非独立方法 | ⚠️ 官方文档声明支持 | ✅ | 输入框菜单 + `/effort` |
| 上下文占用显示 | ✅ | ⚠️ 依赖 `usage` 通知口径 | ⚠️ 官方文档声明支持 | ✅ | `get_context_usage` 桥接事件 |
| `@` 文件引用 | ✅ | ✅ `resource_link` | ✅ | ✅ | 前端构造 → CLI |
| `#` 唤起子代理 / `!` 提示词 | ✅ | ⚠️ 非标准语义 | ❌ | ✅ | CLI 侧语义直通 |
| 斜杠命令（Qwen 命令表） | ✅ | ❌ 标准 ACP 无命令表 | ❌ | ✅ | 内置全量表 + 运行时名单校准 |
| CLI 侧会话历史 | ✅ | ⚠️ `session/list` 语义有限 | ⚠️ 官方文档声明支持 | ✅ | 读 `~/.qwen/projects/` |
| 会话收藏 / 搜索 / 导出 | ✅（本地） | ❌ | ❌ | ✅ | 读本地会话文件 |
| AI 会话标题 | ✅ | ✅ `session/title`（Layer 2） | ❌ | ✅ | 本地生成 |
| MCP 服务器浏览 / 增删改 | ✅ | ❌（仅工具调用） | ❌ | ✅ | 读改 `~/.qwen/settings.json` |
| MCP 市场浏览 / 工具列表 | ✅ | ❌ | ❌ | ✅ | 官方 MCP registry + 状态探测 |
| Skills 浏览与管理 | ✅ | ❌ | ❌ | ✅ | 本地 skills 目录 |
| 自定义命令管理 | ✅ | ❌ | ❌ | ✅ | `~/.qwen/commands/`、`.qwen/commands/` |
| 供应商与模型可视化配置 | ✅ | ❌ | ❌ | ✅ | 读改 `~/.qwen/settings.json`（保注释/格式，原子写回） |
| API Key 状态徽标（只写不读） | ✅ | ❌ | ❌ | ✅ | 本地 Node 服务写入 |
| 用量统计（token / 趋势 / 热力图） | ✅（本地记录） | ❌ | ❌ | ✅ | 解析本机用量数据 |
| 会话内省（context / stats / tasks / agents / lsp） | ✅ | ❌ 在 Layer 2 | ❌ | ⚠️ 部分（上下文占用、任务） | 自建桥接 |
| 记忆读写 / 子代理 CRUD | ✅ | ❌ 在 Layer 2 | ❌ | ⚠️ 部分（浏览） | 本地目录 |
| Hooks / 工作流 | ✅ | ❌ 在 Layer 2 | ❌ | ❌ | — |
| 权限审批 | ✅ | ✅ `session/permission` | ✅ | ✅ | 桥接 + 弹窗 |
| 代码 Diff 可视化 + 跳转 | ✅（CLI 侧） | ⚠️ 依赖 IDE 侧 diff 通道 | ❌（AI Assistant 侧） | ✅ | 自建 diff + IDE 打开 |
| 编辑器右键发送 / 快速修复 | —（IDE 侧能力） | ❌ | ⚠️ AI Assistant 侧有限 | ✅ | IntelliJ Action |
| 文件树 / 控制台发送、运行调试监听 | —（IDE 侧能力） | ❌ | ❌ | ✅ | IntelliJ API |
| Commit AI 提交信息 | —（IDE 侧能力） | ❌ | ❌ | ✅ | git4idea + CLI |
| 提示词增强 | —（IDE 侧能力） | ❌ | ❌ | ✅ | 前端改写 |
| 认证态（Qwen 登录） | ✅ | ⚠️ Layer 2 `workspace/auth/status` | ❌ | ⚠️ 只读检测 CLI 安装 | — |
| SDK 依赖管理（装/回退/离线包） | — | ❌ | ❌ | ✅ | 插件侧自管 |

---

## 3. 为什么 JetBrains 用户拿不到 Layer 2 / Layer 3

这是整份文档最需要被上游确认的一节。三段证据：

**证据 1 —— 标准 ACP 的边界就是第三方客户端的边界。**
`_qwen/*` 是**厂商私有扩展**。JetBrains AI Assistant 是第三方客户端，它不会、也不应该为某个厂商的私有扩展做实现。跨厂商 ACP 的设计初衷就是让"IDE 只依赖协议，不依赖某个 agent 的私有特性"。

**证据 2 —— 这些方法在 Qwen 侧是真实存在且被测试覆盖的。**
`packages/cli/src/serve/acp-http/transport.test.ts` 中有直接以 JSON-RPC `method: '_qwen/workspace/mcp'` 发起请求并断言返回的用例；`packages/acp-bridge/src/status.ts` 以常量表的形式固化了这套契约，并为状态面提供 `STATUS_SCHEMA_VERSION = 1`。**能力已经在服务端就绪，缺的是能消费它的 IDE 客户端。**

**证据 3 —— 官方 Java SDK 目前只覆盖了"会话面"，没有覆盖"workspace 状态面"。**
`packages/sdk-java/qwencode/README.md` 声明的产物是 `com.alibaba:qwencode-sdk:0.1.0-alpha`（Java 11+、Maven），提供：

- **Daemon API（推荐）**：`DaemonClient` / `DaemonSessionClient`，REST 变更 + 可恢复 SSE 观测，`promptText()` / `startPrompt()` / `respondToPermission()` / `cancelActivePrompt()` / `detachSession()`
- **Legacy stdio API**：`com.alibaba.qwen.code.cli.QwenCodeCli`
- 协议 schema：`com.alibaba.acp.sdk.protocol.*`（标准 ACP）

但在 `packages/sdk-java` 全量搜索 `workspace/mcp` / `workspace/skills` / `workspace/providers` / `supported_commands` / `context_usage`，**零命中**。

> **也就是说：官方 Java SDK 有会话能力，没有 workspace 状态面。而一个完整的 JetBrains 插件，恰恰最需要后者（MCP 管理、Skills、供应商、用量、信任、认证）。**

---

## 4. QwenMate 当前路径的诚实披露

QwenMate 与官方两条路径**都不是**对方的路径：

| | QwenMate 实际做法 |
|---|---|
| 引擎 | 自带 TypeScript 运行时 + Qwen Code TS SDK（插件发行包约 21 MB） |
| 供应商 / MCP / 模型配置 | 直接读改 `~/.qwen/settings.json`，用**复刻 CLI 算法**的 JSONC 保真写回（保注释、缩进、换行、BOM，原子写 + 失败回滚） |
| 会话历史 | 读 `~/.qwen/projects/` |
| 用量统计 | 解析本机用量数据 |
| 上下文占用 | 自建桥接事件 `get_context_usage` |
| `_qwen/*` 扩展 | **未使用**（全仓库无 `_qwen/` 调用） |

**这有两面性：**

- ✅ **优势**：不依赖 daemon、不依赖特定 CLI 版本，CLI 装好即用；对 `~/.qwen` 的语义理解比通用客户端深（这是通用多引擎 GUI 不愿意做的脏活）。
- ⚠️ **风险**：解析本地文件 = 与 CLI 内部格式耦合，CLI 改结构就得跟着改；自带 TS 运行时 = 体积大、供应链面大；官方 reviewer 天然会问"为什么不直接用官方 Java SDK"。

---

## 5. 矩阵读出来的三件事

### 5.1 差异化窗口正在收窄，但不是被 ACP 收窄的

官方文档 `docs/users/integration-jetbrains.md` 已声明 JetBrains 侧支持：会话历史、推理力度（Default / Low / Medium / High / Extra high / Max）、上下文占用、`#` 文件引用。这些都是 Layer 1 范围内、第三方客户端可实现的部分。**QwenMate 不能把"有会话历史 / 有 effort 选择器 / 有上下文占用"当作差异点** —— 那正是官方路径已经承诺的部分。

真正的差异点在 Layer 2 / Layer 3：**MCP 与 Skills 管理、供应商与模型可视化配置、用量统计、自定义命令管理、斜杠命令全量表、会话收藏/搜索/导出、认证态可见性**，以及整套 IDE 侧集成（右键发送、快速修复、Diff 跳转、Commit AI、运行调试监听）。

### 5.2 官方 ACP 路径本身并非无摩擦

上游 issue **#6581**（2026-07，"JetBrains Qwen Code ACP agent does not receive user prompt, only bootstrap context"）记录了一次真实的 JetBrains + ACP 集成缺陷：AI Assistant 静默自动附加当前编辑器文件，导致用户指令被埋没；Qwen 侧在 **#6607** 修复了请求拼装顺序，JetBrains 侧对应 YouTrack **LLM-28933**。这说明**"接上 ACP 就等于原生体验"并不成立**，第三方客户端有独立价值。

### 5.3 生态位是干净的，但需要主动声明

JetBrains Marketplace 上另一个多引擎 GUI（CC GUI，1,359,743 下载）支持 Claude Code / Codex / Grok / Kimi / OpenCode / PI / OMP / DeepSeek Harness —— **唯独没有 Qwen Code**。Qwen 方向的 JetBrains 插件目前没有强势同侪。

---

## 6. 建议的收编形态（本文档的落点）

不要以"请收编我的插件"的形式提。**官方没有动机把一个第三方插件并入自己的仓库**，而以下三种形态官方有明确动机：

### 形态 A（推荐）：官方 Java SDK 补齐 workspace 状态面，QwenMate 作为参考客户端

- **官方侧的收益**：Java SDK 目前只有会话面。要做一体面的 JetBrains 插件，MCP / Skills / 供应商 / 记忆 / 信任 / 认证这套状态面必须在 Java 侧可用。现在补，是一次性的、可复用的 SDK 增强，而不是插件私有实现。
- **QwenMate 的收益**：把 Layer 2/3 的取数从"解析本地文件 + 私有 TS 桥接"迁到"官方 Java SDK + 官方 `_qwen/*` 契约"。
  - 发行包从约 21 MB 显著缩小（Node 运行时可退场）
  - 摆脱对 CLI 内部文件格式的耦合
  - 与官方同源，"接死私有 SDK"的疑虑消失
  - **可以直接向上游提 PR**：Java 侧补 workspace 状态面。角色从"求收编"变成"共建"。
- **落地形态**：给上游提 `packages/sdk-java` 的 PR（补 workspace 状态面 + 对应 `_qwen/*` 契约），同时提供 QwenMate 作为**已验证的第三方 Java 客户端**。

### 形态 B：官方文档收录 / 社区列表

上游 `docs/` 全量搜索 "ecosystem" 只有零散命中，**目前没有社区项目列表页**。要落地，需要先在仓库里开 Issue 讨论"第三方 IDE 集成"的收录位置（README 的 Integrations 段或 docs 的第三方集成页）。

### 形态 C：官方委托维护一方 JetBrains 插件

对作者最划算的形态：官方分发渠道 + JetBrains Marketplace 曝光（从当前量级到百万级）+ 署名。触发条件是官方判定 ACP 不足且愿意投人力。

---

## 7. 迁移到官方 Java SDK 的技术路线（Layer 2/3 取数替换）

| 现有实现 | 目标实现 | 收益 | 风险 |
|---|---|---|---|
| 读 `~/.qwen/settings.json` 取 `modelProviders` | `_qwen/workspace/providers` | 不再解析私有格式 | 需 `qwen serve` 常驻 |
| 读改 `settings.json` 的 `mcpServers` | `_qwen/workspace/mcp` + `workspace/mcp/manage` | 官方写回语义一致 | 变更面需谨慎迁移 |
| 读 `~/.qwen/projects/` 取会话 | `session/list` + `session/transcript` | 版本化 | 历史会话兼容需验证 |
| 自建 `get_context_usage` | `_qwen/session/context_usage` | 与 CLI 口径一致 | 无 |
| 本地解析用量数据 | `_qwen/session/stats` | 口径统一 | 需确认统计维度覆盖 |
| 私有 TS 桥接（会话/流式） | 官方 Java SDK Daemon API（REST + SSE） | 去 Node、去私有协议 | 需处理 daemon 生命周期与鉴权 |

**建议路径**：先迁**只读**能力（providers / skills / mcp 状态 / context / stats），保留本地文件读取作为**降级路径**（老版本 CLI 或 daemon 不可用时）；再迁**写入**能力。始终以 `STATUS_SCHEMA_VERSION` 做能力协商，避免私有扩展变更导致硬失败。

---

## 8. 使用这份文档的注意事项

1. **发布前刷新数字**：Marketplace 下载量、评分、插件版本号、仓库 star 数都是动态的，文中数据取自 2026-11-10 的快照，发布前请重取。
2. **区分"已核实"与"官方文档声明"**：表中 ⚠️ 项来自官方 JetBrains 文档，但 JetBrains 客户端的实现细节不公开，无法从代码核实具体机制。向上游陈述时应如实标注来源。
3. **不要把 §2 的 ❌ 描述成"官方缺陷"**：Layer 2/3 不在标准 ACP 里是**设计使然**（第三方客户端不应依赖私有扩展）。正确的表述是"**这需要一个懂 Qwen 的客户端**"。
4. **引用的 issue 需复核**：#6581 / #6607 已核对；作者原始帖中引用的 #2247 / #8544 本文未独立复核（上游 issue 为 feature/need-help 且零回复），对外引用前请再确认。

---

## 附：证据索引

| 结论 | 证据位置 |
|---|---|
| 官方无 JetBrains 插件包 | `QwenLM/qwen-code` `packages/`（main）：`acp-bridge` / `sdk-typescript` / `sdk-java` / `vscode-ide-companion` / `zed-extension` / `desktop` / `web-shell` … 无 jetbrains 条目 |
| 标准 ACP 方法集 | `packages/sdk-typescript/src/daemon/acpRouteTable.ts`（`ROUTE_TABLE` 中非 `_qwen/` 前缀条目） |
| Qwen 私有扩展方法表 | `packages/acp-bridge/src/status.ts`（`SERVE_STATUS_EXT_METHODS` L129、`SERVE_CONTROL_EXT_METHODS` L174、`STATUS_SCHEMA_VERSION` L11） |
| 私有扩展走同一条 JSON-RPC 线 | `packages/cli/src/serve/acp-http/transport.test.ts`（以 `method: '_qwen/workspace/mcp'` 发起 JSON-RPC 并断言响应） |
| 官方 Java SDK 存在及其能力边界 | `packages/sdk-java/qwencode/README.md`（`com.alibaba:qwencode-sdk:0.1.0-alpha`、Daemon API / legacy stdio API）；`packages/sdk-java/client/src/main/java/com/alibaba/acp/sdk/protocol/` |
| Java SDK 无 workspace 状态面 | `packages/sdk-java` 全量检索 `workspace/mcp`、`workspace/skills`、`workspace/providers`、`supported_commands`、`context_usage` → 零命中 |
| 官方 JetBrains 能力声明 | `docs/users/integration-jetbrains.md` |
| QwenMate 侧能力 | 本仓库 `src/main/resources/META-INF/plugin.xml`、`README.md`、模块清单（`provider` / `mcp` / `skill` / `usage` / `session` / `settings`） |
| QwenMate 未使用 `_qwen/*` | 全仓库检索 `_qwen/` → 仅命中自有桥接事件名（如 `get_context_usage`） |
| ACP 路径的真实集成缺陷 | 上游 issue #6581（2026-07）、PR #6607、JetBrains YouTrack LLM-28933 |
| 生态位 | JetBrains Marketplace：插件 34842（QwenMate）、插件 29342（CC GUI，支持的 CLI 列表不含 Qwen Code） |
