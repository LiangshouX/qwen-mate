<div align="center">

# QwenMate

**Qwen Code 可视化 GUI —— JetBrains IDE 插件**

针对 Qwen Code 的专门、定向适配，基于 [CC GUI](https://github.com/zhukunpenglinyutong/jetbrains-cc-gui)（MIT）开发。

**文档：** [QwenMate 使用文档](https://liangshoux.github.io/qwen-mate/) · [Qwen Code 官方文档](https://qwenlm.github.io/qwen-code-docs/zh/users/overview)

</div>

---

为 **Qwen Code**（官方 TypeScript SDK 驱动）提供可视化界面的 JetBrains IDE 插件，让 AI 辅助编程更高效直观。

## 关于 Qwen Code

Qwen Code 是通义千问团队开源的终端 AI 编程智能体（agentic coding tool）：用自然语言规划、编写和调试代码，能直接编辑文件、执行命令，并通过 MCP 接入外部工具。

QwenMate 目前仅支持 Qwen Code 这一个引擎，通过其官方 TypeScript SDK 与 ACP 接口驱动，与 CLI 共享配置（`~/.qwen/settings.json`）和会话数据：你在终端里配好的模型、认证、MCP、Skills，在插件里可以直接使用。

## 核心功能

### 智能对话
- 流式输出与思考过程展示
- @ 文件引用、# 唤起智能体、! 插入提示词
- 发送图片，可视化描述需求
- 提示词增强：发送前自动改写输入
- 5 档思考强度（low / medium / high / xhigh / max），输入框菜单或 `/effort` 命令切换
- 斜杠命令对齐 Qwen Code 全量命令表，当前模式不可用的命令本地直接提示，不再等一整轮才报错
- 消息排队：AI 工作期间发送的消息自动排队，不打断当前任务，当前任务结束后依次发送；排队消息可单条放回输入框编辑，也可一键全部放回（`Ctrl+Q` 为对齐 CLI 的显式排队快捷键）
- 托管记忆开关（输入框配置弹层，默认关闭）
- 上下文用量占比：输入区头部实时显示当前上下文占用，任务进行中同步更新

### IDE 集成
- 编辑器右键发送选中代码（`Ctrl+Alt+K` / `Cmd+Alt+K`）、快速修复（`Ctrl+Shift+Q`）
- 文件树与控制台内容发送、运行/调试输出监听
- Commit AI：Git 提交面板一键生成提交信息
- 权限审批：AI 执行文件修改等敏感操作前弹窗确认

### 开发体验
- 代码 DIFF 对比与文件导航
- 用量统计：本机 token 消耗，支持今日 / 7 天 / 30 天窗口与全量 / 按项目 / 按会话三个统计维度，含模型份额、每日趋势与 12 个月热力图
- MCP 服务器：内置市场浏览、增删改配置、连接状态与工具列表
- Skills：浏览与管理 Qwen Code 技能
- 深色/浅色主题，IDE 字体同步
- 10 种语言国际化

### 会话管理
- 历史会话记录、恢复、搜索与导出
- 会话收藏与 AI 自动生成标题

### 配置与依赖
- 供应商管理：模型供应商与模型的可视化配置页——连接、编辑、删除 CLI 预置供应商及其模型（协议、Wire API、Base URL、API Key、模型与高级项），改动写回 `~/.qwen/settings.json`，格式与 CLI 完全一致，已存 API Key 永不回显
- CLI 检测：只读检测本机 qwen 命令行的安装状态
- SDK 依赖管理：在线安装、更新、回退 Qwen Code SDK，支持离线安装包

## 安装

1. 通过 JetBrains Marketplace 安装：`设置 → 插件 → Marketplace` 搜索 `QwenMate`；内网/离线环境从 GitHub Releases 下载插件 ZIP，用 `设置 → 插件 → ⚙ → 从磁盘安装插件…` 安装
2. 将 Qwen SDK 离线包解压安装到 `~/.qwenmate/dependencies/qwen-sdk/`（用随包的 `install-offline.bat` / `install-offline.sh`），或在有网环境通过 `设置 → SDK 依赖管理` 在线安装

## 性能提示

### macOS 滚动卡顿

macOS（尤其 Retina 屏）聊天面板或设置页滚动卡顿时，可禁用 GPU 加速——在 VM 选项（帮助 → 编辑自定义 VM 选项）中加入：

```
-Dide.browser.jcef.gpu.disable=true
```

然后重启 IDE。

## 本地开发与调试

### 1. 安装前端依赖

```bash
cd webview
npm install
```

### 2. 安装 ai-bridge 依赖

```bash
cd ai-bridge
npm install
```

### 3. 调试插件

```bash
./gradlew clean runIde
```

### 4. 构建插件

```sh
./gradlew clean buildPlugin

# 插件包生成在 build/distributions/ 目录
```

## 许可证

MIT
