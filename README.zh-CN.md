<div align="center">

# QwenMate

**Qwen Code 可视化 GUI —— JetBrains IDE 插件（内部轻量版）**

基于 [CC GUI](https://github.com/zhukunpenglinyutong/jetbrains-cc-gui)（MIT）裁剪定制。

</div>

---

为 **Qwen Code**（官方 TypeScript SDK 驱动）与 **DeepSeek Harness**（Beta）提供可视化界面的 JetBrains IDE 插件，让 AI 辅助编程更高效直观。

## 支持的引擎

- **Qwen Code** —— 通义千问 AI 编程助手（官方 TypeScript SDK，支持 qwen3-coder 等多模型）
- **DeepSeek Harness**（Beta）

## 核心功能

### 智能对话
- 上下文感知的 AI 编程助手，流式输出与思考过程展示
- @文件引用，精准注入代码上下文
- 发送图片，可视化描述需求
- 提示词增强，提升 AI 理解

### Agent 系统
- 内置智能体，自动化执行复杂任务
- Skills 斜杠命令系统（/init、/review 等）
- MCP 服务器支持，扩展 AI 能力

### 开发体验
- 完善的权限管理与安全控制
- 代码 DIFF 对比与文件导航
- 深色/浅色主题，IDE 字体同步
- 10 种语言国际化

### 会话管理
- 历史会话记录、恢复、搜索与导出
- 会话收藏与 AI 自动命名
- 用量统计与逐回合成本核算

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
