# QwenMate · 弃用 API 清理 · 人工验证清单

> 这份清单只回答一个问题：**这批改动在真实 IDE 里的行为对不对。**
> "会不会崩"（版本兼容性）已由静态证据证明，不需要再装多个 IDE 去证伪。

| 项 | 说明 |
|---|---|
| 需要几个 IDE | **1 个** —— 日常在用的那个（2026.2+ 更好）；233、Python 为可选项 |
| 大概耗时 | 约 1 小时（含构建插件） |
| 覆盖范围 | 本轮 5 个改动：URL 构造、DynamicBundle 委托、打开文件流程、控制台选区、类跳转 |

---

## 0. 准备（约 10 分钟）

```bash
cd qwen-mate
./gradlew.bat buildPlugin -PskipWebview=true --console=plain
```

1. **安装插件**：IDE → `Settings → Plugins → ⚙ → Install Plugin from Disk…` → 选 `build/distributions/` 里的 zip。
2. **记下 IDE 版本**：`Help → About`，填进 §9 记录表每行的「IDE 版本」列。
3. **准备工程**：任意含 Java 源码的工程（用于 A、C 组）。

**两条通用规则**

- **停机规则**：任何一步出现 `NoSuchMethodError` / `NoSuchFieldError` / `NoClassDefFoundError`，或插件加载失败 → **立刻停止**，把堆栈记进 §9，后续步骤不再继续（后续结论会失真）。
- **记录规则**：勾选框只填"通过 / 失败 / 未测"，失败与未测都要在 §9 写一句话原因。

---

## 1. A 组 · 打开文件流程（10 格）

改动：`openFile` / `openTextEditor` → `OpenFileDescriptor.navigate(true)`，选区改为编辑器就绪后补设。

在聊天框里让 AI 打开文件，下表 `<F>` 代表项目里的任意 Java 文件。

| # | 操作 | 期望结果 | 通过 |
|---|---|---|---|
| A1 | 打开 `<F>`（不带行号） | 文件打开并**获得焦点**，键盘能直接输入 | ☐ |
| A2 | 打开 `<F>:42` | 光标落在**第 42 行行首** | ☐ |
| A3 | 打开 `<F>:42-45` | 选中**第 42 行行首 → 第 45 行行尾**，末尾不多含一个换行符 | ☐ |
| A4 | 打开 `<F>:42-42` | **整行**（第 42 行）被选中 | ☐ |
| A5 | 打开 `<F>:99999`（行号越界） | 夹到**最后一行**，不报错 | ☐ |
| A6 | 打开**空文件** `:1` | 文件打开，不抛异常（可能无选区） | ☐ |
| A7 | 打开**非文本文件**（如 `.png`）`:1` | 用默认编辑器打开，不抛异常 | ☐ |
| A8 | 打开 `<F>:60-40`（区间倒置） | 只把光标移到第 60 行，**不产生选区** | ☐ |
| A9 | 通过 **Skill** 触发打开文件 | 文件打开并聚焦 | ☐ |
| A10 | 该文件**已在编辑器打开**时再次发指令 | 复用同一个标签页，光标定位到目标行 | ☐ |

**不通过的样子**：文件不打开 / 焦点仍留在聊天框 / 光标差一行 / 选区多一个换行 / 控制台出现 `Editor not ready, skipped range selection`。

---

## 2. B 组 · 控制台选区发送（4 格）

改动：`LangDataKeys.CONSOLE_VIEW`（263 已废弃）→ 运行时反射解析。

| # | 操作 | 期望结果 | 通过 |
|---|---|---|---|
| B1 | 打开 Run/Debug 控制台，**选中一段输出文字** | 右键菜单出现"发送到 AI"，**可点击（不是灰的）** | ☐ |
| B2 | 点击"发送到 AI" | 选中的文字**进入聊天输入框** | ☐ |
| B3 | 控制台**没有选中任何文字** | 菜单项灰掉或不出现 | ☐ |
| B4 | 控制台里选中**纯空白**（空格 / 换行） | 不发送空内容 | ☐ |

**不通过的样子**：菜单项始终灰掉（说明反射没解析到 key）。

> **这一组有一格版本依赖**：反射是"先 `ExecutionDataKeys`、再 `LangDataKeys`"，**回退分支只在 <263 的 IDE 上才走到**。
> 你的日常 IDE 若低于 263，本组自动覆盖回退分支；若已是 263+，该分支只有单元测试覆盖 —— 记为"未覆盖"，或加装 233 Community（589 MB 绿色包）补测 B1–B4。

---

## 3. C 组 · Java 类跳转（5 格）

改动：`navigatable.navigate(true)` → `OpenSourceUtil.navigate(true, false, navigatable)`。

| # | 操作 | 期望结果 | 通过 |
|---|---|---|---|
| C1 | 打开一个**项目内**的类 | 跳到该类源码，光标定位到类声明处 | ☐ |
| C2 | 打开一个**库里有源码**的类（如 `java.util.ArrayList`） | 跳到源码并定位 | ☐ |
| C3 | 打开一个**库里没有源码**的类 | **记录实际表现**（打不开 / 打开反编译文件）；只要不报错、不静默失败即可 | ☐ |
| C4 | 打开一个**不存在**的类名 | 聊天里给出"找不到类"提示，不静默失败 | ☐ |
| C5 | 在 **Dumb mode**（索引未完成）时打开类 | 等索引完成后自动跳转 | ☐ |

**C3 不能跳过的原因**：这是本轮**唯一有语义差异**的改动 —— 平台的 `OpenSourceUtil` 会优先尝试"跳到源码"，原实现只认 `canNavigate()`。这一格必须留下实际表现的文字记录。

**不通过的样子**：跳转没发生（静默失败）/ 跳到错误文件 / 打开了多个文件。

---

## 4. D 组 · 界面文案（5 格）

改动：`QwenMateBundle` 从**继承** `DynamicBundle` 改为**委托**。这个类被所有 action 引用，改错会全局崩。

| # | 操作 | 期望结果 | 通过 |
|---|---|---|---|
| D1 | IDE 语言切到**中文** | 插件内所有文案为中文 | ☐ |
| D2 | 切到**英文** | 所有文案为英文 | ☐ |
| D3 | 切到**日语 / 韩语 / 法语 / 德语 / 西班牙语 / 俄语 / 葡萄牙语 / 意大利语** | 对应语言文案正常 | ☐ |
| D4 | 任意语言下浏览插件**所有菜单与设置页** | **没有裸露的 key**（形如 `action.sendConsoleSelection.text`） | ☐ |
| D5 | 切换语言后**重启 IDE** | 文案仍正常（bundle 缓存不炸） | ☐ |

**不通过的样子**：出现 `messages.QwenMateBundle` 前缀或 key 字符串 / 抛 `MissingResourceException` / 界面语言不跟随 IDE 设置。

---

## 5. E 组 · MCP 市场与 URL（4 格）

改动：`new URL(String)` → `URI.create(...).toURL()`，`IllegalArgumentException` 转为 `IOException`。

| # | 操作 | 期望结果 | 通过 |
|---|---|---|---|
| E1 | 打开 MCP 市场页（**GitHub 源**） | 列表正常加载 | ☐ |
| E2 | 打开 MCP 市场页（**官方 registry 源** `registry.modelcontextprotocol.io`） | 列表正常加载 | ☐ |
| E3 | 打开 MCP 市场页（**GitHub 组织源**） | 列表正常加载 | ☐ |
| E4 | 配置一个**错误的**源 URL | 弹出错误提示，**插件不崩溃** | ☐ |

**不通过的样子**：出现未捕获的 `IllegalArgumentException` 栈（说明异常契约没保持住）。

---

## 6. F1 组 · JCEF 插件缺失（5 格）—— **优先级最高**

2026.2 起 JCEF 由独立的 *Web Browser (JCEF)* 插件提供。**这一组决定要不要做 JCEF 类隔离重构**，先做完再决定要不要动代码。

| # | 操作 | 期望结果 | 通过 |
|---|---|---|---|
| F1.1 | 在 **2026.2 / 2026.3** 上启动插件 | 插件**正常加载**，聊天窗口正常，WebView 能渲染 | ☐ |
| F1.2 | 在 **2026.2 或 2026.3** 上**禁用** *Web Browser (JCEF)* 插件，再启动 | **绝不能整插件崩掉**：要么拒绝加载并给出清晰提示，要么加载但 WebView 功能降级；不得抛 `NoClassDefFoundError` | ☐ |
| F1.3 | 在 **233** 上启动 | 插件正常加载，聊天窗口正常 | ☐ |
| F1.4 | 在 **262 / 263** 上触发 DevTools 动作 | 正常打开，或明确提示不可用，不崩溃 | ☐ |
| F1.5 | 确认 `jcef-features.xml` 里的 service 在 **233** 上**未**被注册（预期行为） | 无 JCEF 时不注册、不报错 | ☐ |

**版本要求**：F1.1 / F1.2 / F1.4 需要 **2026.2+** 的 IDE；F1.3 / F1.5 需要 **233**，属于**可选项**（有 233 才做，没有就记"未覆盖"）。
**262 与 263 各做一次启动验证更稳**；只有一个 IDE 时，F1.1 过了就算 F1 组基本通过，F1.2 在这个 IDE 上补测。

**不通过的样子**：整插件加载失败 / IDE 启动异常 / 抛 `NoClassDefFoundError`。

---

## 7. F2 组 · Python 上下文（2 格）—— 可选

| # | 操作 | 期望结果 | 通过 |
|---|---|---|---|
| F2.1 | 在装了 Python 插件的 IDE 里打开 `.py` 文件 | 插件正常加载，Python 上下文采集不报错 | ☐ |
| F2.2 | 在 `.py` 文件里让 AI 读取上下文 | 函数名 / 类名 / docstring / 参数 / imports 都能正常采集 | ☐ |

Python PSI 的废弃状态已由静态审计证明（详见 `deprecation-audit-report.md`），本组只做行为确认。**Community 不含 Python 插件** —— 已有 PyCharm 或 IDEA Ultimate 就做，没有就跳过并记"未覆盖"。

---

## 8. F3 组 · 验证器复跑（4 格）—— 不需要 IDE

| # | 操作 | 期望结果 | 状态 |
|---|---|---|---|
| F3.1 | 对 **233**（区间下界）跑 verifier | **0 弃用、0 override-only** | ✅ 已通过（2026-11-17） |
| F3.2 | 对 **261**（近上界）跑 verifier | **0 弃用、0 override-only** | ✅ 已通过（2026-11-17） |
| F3.3 | 对 **262 / 263** 跑 verifier | 同样 **0 弃用、0 override-only** | ☐ 待跑（走 CI） |
| F3.4 | 打开 `build.gradle`，看 `pluginVerification { failureLevel = [...] }` | 列表含 `DEPRECATED_API_USAGES` + `OVERRIDE_ONLY_API_USAGES` | ✅ 已确认 |

> **别被那一条 "compatibility problem" 吓到**：没有 Python 插件的 IDE 一定会报
> `#Package 'com.jetbrains.python' is not found` —— 那是 **optional** 依赖，引用它的代码在
> `python-features.xml` 可选模块里，不装 Python 插件就根本不加载。**不算失败。**

**怎么跑**

- **完整矩阵**（CI，或本地网络正常时）：
  `./gradlew.bat verifyPlugin -PskipWebview=true --console=plain`
  —— 按 `build.gradle` 的 `ides` 下 5 个 IDE（约 5 GB）。
- **手上有现成 IDE 时**（不受 JetBrains CDN 影响，更快）：
  ```bash
  bash docs/compatibility/scripts/run_verifier_local.sh \
    build/distributions/qwen-mate-1.1.1.zip \
    /path/to/idea-233 /path/to/idea-261
  ```
  IDE 可以是已安装的目录，也可以是从 Gradle 缓存里解压出来的 zip。

---

## 9. 收口

### 验证记录

| IDE 版本 | 组 | 结论 | 缺陷 / 未覆盖原因 |
|---|---|---|---|
|  | A | ☐ 通过 ☐ 失败 ☐ 未测 |  |
|  | B | ☐ 通过 ☐ 失败 ☐ 未测 |  |
|  | C | ☐ 通过 ☐ 失败 ☐ 未测 |  |
|  | D | ☐ 通过 ☐ 失败 ☐ 未测 |  |
|  | E | ☐ 通过 ☐ 失败 ☐ 未测 |  |
|  | F1 | ☐ 通过 ☐ 失败 ☐ 未测 |  |
|  | F2 | ☐ 通过 ☐ 失败 ☐ 未测 |  |
|  | F3 | ☐ 通过 ☐ 失败 ☐ 未测 |  |

### 发布判定

- **可以发布**：A–E 全通过，F1.1 / F1.2 / F1.4 通过，verifier 在 **233 / 261 上 0 弃用**（已实测）。
- **必须先修**：任一组出现 `NoSuchMethodError` / `NoSuchFieldError` / `NoClassDefFoundError`，或 A、B、C、D、E 任一格失败。
- **建议补齐**：262 / 263 的 verifier 跑一次（CI 即可，不阻塞发布）。
- **允许未覆盖**（记入上表即可，不阻塞发布）：B 组的 `LangDataKeys` 回退分支（日常 IDE ≥263 时）、F2 全部、F1.3 / F1.5（无 233 时）。
- **待决策**：F1.2 的实测结果决定要不要做 JCEF 类隔离重构 —— 拿到结果再决定，不要盲改。

---

## 附：静态证据（本清单不重复验证）

版本兼容性、弃用归零、跨版本 API 可用性已由以下手段证明，复跑命令见 `README.md`：

| 结论 | 手段 |
|---|---|
| 本轮改动用到的 7 个平台 API 在 233 上存在且未废弃 | `scripts/verify_platform_api_versions.py` |
| 编译产物字节码里残留的弃用调用点 = 0 | `scripts/check_compiled_refs.py` |
| **233 / 261 实跑 verifier：0 弃用、0 override-only** | `scripts/run_verifier_local.sh`（报告见 `verifier-local-2026-11-17/`） |
| Python PSI 12 类 + 6 方法在 243 / 263 均未废弃 | `scripts/audit_python_psi_apis.py` |
| 243 SDK 上 200 个平台符号 0 命中 | `scripts/audit_sdk_deprecations.py` |

> 结论与踩坑记录见 `deprecation-audit-report.md`。
