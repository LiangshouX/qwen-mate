<div align="center">

# QwenMate

**Qwen Code 可视化 GUI —— JetBrains IDE 插件（内部轻量版）**

基于 [CC GUI](https://github.com/zhukunpenglinyutong/jetbrains-cc-gui)（MIT）裁剪定制。

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

### IDE 集成
- 编辑器右键发送选中代码（`Ctrl+Alt+K` / `Cmd+Alt+K`）、快速修复（`Ctrl+Shift+Q`）
- 文件树与控制台内容发送、运行/调试输出监听
- Commit AI：Git 提交面板一键生成提交信息
- 权限审批：AI 执行文件修改等敏感操作前弹窗确认

### 开发体验
- 代码 DIFF 对比与文件导航
- MCP 服务器：内置市场浏览、增删改配置、连接状态与工具列表
- Skills：浏览与管理 Qwen Code 技能
- 深色/浅色主题，IDE 字体同步
- 10 种语言国际化

### 会话管理
- 历史会话记录、恢复、搜索与导出
- 会话收藏与 AI 自动生成标题

### 配置与依赖（只读）
- Qwen 配置：读取 `~/.qwen/settings.json` 展示模型目录与当前模型，认证由 Qwen Code CLI 管理，插件不提供修改入口
- CLI 检测：只读检测本机 qwen 命令行的安装状态
- SDK 依赖管理：在线安装、更新、回退 Qwen Code SDK，支持离线安装包

## 离线安装（内网环境）

1. `设置 → 插件 → ⚙ → 从磁盘安装插件…` 选择插件 ZIP 安装
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
