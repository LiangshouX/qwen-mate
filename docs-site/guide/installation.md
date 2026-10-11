# 安装指南

QwenMate 分两部分安装：IDE 插件本体，以及插件驱动引擎所需的 Qwen Code SDK 依赖。

## 系统要求

- JetBrains IDE 2023.3 至 2026.3 系列（构建号 233 至 263.*），IntelliJ IDEA 及其他兼容的 JetBrains IDE
- 首次使用需安装 Qwen Code SDK 依赖，可在插件内在线安装，也可使用离线包
- 访问 Qwen 服务的网络环境；纯内网环境可全程离线安装

## 安装插件

### 方式一：JetBrains Marketplace（推荐）

1. 打开 `设置 → 插件 → Marketplace`
2. 搜索 `QwenMate`，点击安装
3. 重启 IDE 生效

### 方式二：离线 ZIP 安装（内网环境）

1. 从 GitHub Releases 下载 QwenMate 插件 ZIP 包
2. 打开 `设置 → 插件 → 齿轮图标 → 从磁盘安装插件…`
3. 选择 ZIP 文件，安装完成后重启 IDE

## 安装 Qwen Code SDK 依赖

QwenMate 通过官方 Qwen Code SDK 驱动引擎。首次使用前需要安装依赖，两种方式二选一：

### 在线安装

1. 打开 QwenMate 面板顶部的设置（齿轮图标）
2. 进入 `SDK 依赖` 页面
3. 选择版本并安装；后续的升级、回退、重装也在这个页面完成

### 离线安装（无外网环境）

1. 获取 Qwen SDK 离线包
2. 在终端运行离线包内的 `install-offline.bat`（Windows）或 `install-offline.sh`（macOS / Linux），将 SDK 安装到 `~/.qwenmate/dependencies/qwen-sdk/`

::: tip 淘宝 npm 镜像的已知问题
使用淘宝源安装时，可能出现「缺少 native 二进制文件」的安装不完整提示，这是镜像源同步延迟导致的，不是插件缺陷。处理方案见 [FAQ](./faq)。
:::

## 认证配置

认证由 Qwen Code CLI 管理，插件不提供修改入口。如果尚未认证，在终端运行 `qwen` 并按引导完成登录即可，插件读取同一份配置，登录一次两边都能用。

## 验证安装

1. 点击 IDE 右侧边栏的 QwenMate 图标打开工具窗口；如果侧边栏没有该图标，通过 `视图 → 工具窗口 → QwenMate` 打开
2. 打开设置，确认 CLI 检测状态与 SDK 依赖状态正常
3. 在输入框发送一条消息，能收到流式回复即安装成功

## 升级与卸载

- 升级插件：通过 Marketplace 自动更新，或下载新版本 ZIP 覆盖安装
- 升级 / 回退 SDK：设置 → `SDK 依赖` 页面内操作
- 卸载插件：`设置 → 插件 → QwenMate → 卸载`
- 插件数据存放在 `~/.qwenmate/`，Qwen CLI 的配置与会话存放在 `~/.qwen/`。卸载后这两个目录会保留，需要彻底清理时手动删除

## 下一步

安装完成后，从[快速上手](./getting-started)开始了解基本用法。
