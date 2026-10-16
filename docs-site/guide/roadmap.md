# 迭代计划与技术说明

## 当前状态

QwenMate 最新正式版为 1.0.0（2026-10-13 发布），当前开发版本为 1.1.0-beta1，发布渠道为 GitHub Releases 与 JetBrains Marketplace，两个渠道分发同一份构建产物。

已具备的核心能力：

- 对话：流式输出、思考展示、上下文引用（@ / # / !）、图片附件、提示词增强、5 档推理强度、斜杠命令对齐、消息排队（`Ctrl+Q` 与 CLI 一致）
- IDE 集成：编辑器右键动作与快捷键、文件树和控制台内容发送、运行输出监听、Commit AI、审批与 Diff
- 生态：MCP 服务器管理、Skills 管理、会话历史与模板
- 用量：设置页用量统计，本机 token 消耗、模型份额、每日趋势与 12 个月热力图，支持今日 / 7 天 / 30 天切换
- 配置：与 Qwen Code CLI 共享 `~/.qwen/settings.json`，插件侧配置为只读视图

版本细节与历史见仓库中的 [CHANGELOG](https://github.com/LiangshouX/qwen-mate/blob/main/CHANGELOG.md)。

## 架构概览

QwenMate 是一个三段式架构：

```
React 前端 (JCEF Webview)
        ↕  JCEF 桥
Java 插件层（工具窗口、动作、审批、通知）
        ↕  NDJSON + marker 协议 + 权限文件 IPC
Node 进程（TypeScript SDK）
        ↕  ACP（qwen agent stdio）
qwen CLI（引擎，独立子进程）
```

几个关键设计：

- 引擎永远是独立子进程。TS SDK 不是引擎本身，而是客户端，主通道走 ACP（基于 JSON-RPC 的标准协议）
- 插件与 CLI 共享配置和会话数据，终端里配好的模型、认证、MCP、Skills 在插件里直接可用
- 前端与 Java 之间通过 JCEF 桥通信，这一层是 Webview 架构固有的

## 演进方向：Java SDK 迁移（评估中）

这是当前在评估的架构方向，尚未排期，以下为调研结论。

### 背景

现有链路中，Java 与 Node 之间有一层自建桥接（NDJSON + marker 协议 + 权限文件 IPC），权限审批的文件 IPC 是历史 bug 高发区。如果用官方 Java 版 SDK 替换 TS SDK，这层桥接有望去掉。

### 官方 Java SDK 现状

qwen-code 仓库已提供 Java SDK，共四个模块，与插件相关的是两个：

- `acp-sdk`（Java 8，通用 ACP 客户端）：能力缺口较大，全程无 thinking、无 usage 统计、不支持注入环境变量、MCP 状态不可探测、不能选择模型，不适合作为主链路
- `qwencode-sdk`（Java 11，两套 API）：
  - legacy stdio API：与 `@qwen-code/sdk` 同构，消息族、权限模式、会话恢复一一对应，是当前评估的首选。缺口是 `sendPrompt` 只支持纯文本，图片附件需要扩展 API，MCP 状态探测无覆盖
  - daemon API（`qwen serve` REST + SSE）：回调齐全，但 alpha 阶段创建会话不能选模型、无动态权限切换、与 CLI 版本强耦合，暂不适合插件

两个 SDK 目前均为 alpha 版本。

### 计划路径

1. 协议边界从 npm SDK 的私有消息换成 ACP 标准
2. 前置核对 ACP 覆盖度：thinking、usage 统计、斜杠命令、附件、权限模式切换，这是最大的风险点
3. 按切片迁移，`ai-bridge` 现有测试用例平移作为验收标准

迁移完成后，收益是 DaemonBridge 心跳与重启状态机、marker 双向翻译整体消失，权限审批从文件 IPC 变成进程内调用。

### 不变的部分

- qwen CLI 本身是 Node 程序，CLI 检测与启动依赖会保留
- 引擎独立子进程、与上游 qwen-code 保持同步的原则不变
- 前端 JCEF 桥不动

## 发布流程

- 打 `v*` 标签触发 CI，一次构建产出的 ZIP 同时发布到 GitHub Release，手动派发时可同包上传 JetBrains Marketplace
- 帮助文档站（本站）在推送 main 且 `docs-site/` 有变更时自动构建部署

## 免责声明

QwenMate 为社区项目，与阿里云、JetBrains 无隶属或背书关系。针对 Qwen Code 做了专门适配，基于 CC GUI（MIT）开发，以 MIT 许可开源。
