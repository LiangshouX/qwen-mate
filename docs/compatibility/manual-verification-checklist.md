# QwenMate · 弃用 API 清理的集中人工验证清单

> 生成于 2026-11-10 · 覆盖 P0-a / P0-b / P0-c / P1-a / P1-b 全部改动 + P2 结构性风险
> 目标：一次把需要真实 IDE 的验证做完，别再分批返工。

---

## 0. 验证环境准备

| 编号 | IDE | 构建号 | 为什么需要它 |
|---|---|---|---|
| V1 | IntelliJ IDEA Ultimate 2023.3 | `233.15619.7` | `sinceBuild` 下界。**所有跨版本 API 可用性只能在这里证伪**——2026.3 上能跑的 API 在 233 上不一定存在 |
| V2 | IntelliJ IDEA Ultimate 2024.3 | `243.28141.41` | 编译目标 |
| V3 | IntelliJ IDEA Ultimate 2026.2 | `262.11879.100` | JCEF 拆插件的**第一个**版本（§3.1 风险起点） |
| V4 | IntelliJ IDEA Ultimate 2026.3 | `263.7307.200` | `untilBuild` 上界，弃用告警的来源 |
| V5 | IntelliJ IDEA 2026.3 EAP | 任意 263 EAP | 提前发现平台侧变更（override-only 只在 EAP 出现过） |

**插件安装**：每个 IDE 里安装本次构建产出的插件 zip（`qwen-mate/build/distributions/`）。
**建议**：先在 V1（233）把 A/B/C/D/E 全部跑一遍——**233 通过是这套改动成立的前提**，263 反而是相对简单的一端。

**通用判据**：任何一步出现 `NoSuchMethodError` / `NoSuchFieldError` / `NoClassDefFoundError`，
或插件无法加载 → 立刻停止并回滚，不要继续往下测（后续步骤的结论会失真）。

---

## 0.5 最小路径（不想装 5 个 IDE 的话，看这里）

### 结论：只需要 **1 个 IDE**，233 那一档可以跳过

**"版本兼容"这一层已经不需要 IDE 就能证明**，三条证据都齐：

| 证据 | 覆盖范围 | 复跑方式 |
|---|---|---|
| 已发布的 1.1.1 在 **IU-233.15619.7** 上的验证报告 | 本轮**未改动**的 191 个平台符号在 233 上兼容（结论 "Compatible"，0 compatibility problem、0 弃用） | `reports-compact/1.1.1__IntelliJ-IDEA__IU-233.15619.7__*.json` |
| 233 / 243 / 263 三个 release tag 的**官方源码逐字核对** | 本轮**改动到的** 7 个平台 API 在 233 上存在且未废弃 | `scripts/verify_platform_api_versions.py` |
| 编译产物**字节码常量池扫描** | 编译结果里没有残留的弃用 / 高风险调用 | `scripts/check_compiled_refs.py` |

→ **233 的 IDE 冒烟是"锦上添花"，不是"必须"**。只有当你想亲眼确认一次时才装。

### 真正需要 IDE 的只有"运行时行为"

本轮改动在 233 / 243 / 263 上走的是**同一套 API**（已逐字核对），所以版本之间**不会**产生"行为悄悄变了"，
只可能产生"API 不存在 → 崩"。而"崩"这件事上面三条证据已经覆盖了。
剩下真正只能靠 IDE 的，是**交互行为**——那在一个 IDE 上测一次就够。

### 推荐组合

| 你要做什么 | 用哪个 IDE | 成本 |
|---|---|---|
| **A–E 五组行为验证 + F1（JCEF）** | 你**日常在用的**那个 IDE（需 2026.2+，JCEF 组才要求这么新） | **0**（已经在手上） |
| **F2（Python 上下文）** | 任意带 PythonCore 的 IDE（PyCharm / IDEA Ultimate）；**Community 不带 Python** | 已有就 0，否则跳过 |
| **F3（验证器复跑）** | 不用 IDE，但每个 IDE 要下 1.2–1.5 GB → **建议放 CI**，本地只留 263 一个 | 高 |
| 233 冒烟（可选） | IntelliJ IDEA **Community 2023.3**（589 MB 绿色包，免账号） | 589 MB + 10 分钟 |

### 三个省时技巧

1. **用 Community 代替 Ultimate**。`plugin.xml` 唯一**必需**依赖是 `com.intellij.modules.platform`
   （`com.intellij.java` / `Git4Idea` / `com.intellij.modules.jcef` / terminal / python **全是 optional**）。
   IC 免费、不需要订阅账号，体积还小一半：

   | 发行包 | 体积 |
   |---|---|
   | `ideaIC-233.11799.300.zip` | **589 MB** |
   | `ideaIU-233.15619.7.zip` | 795 MB |
   | `ideaIC-263.7307.200.zip` | **631 MB** |
   | `ideaIU-263.7307.200.zip` | 1460 MB |

2. **IDEA 是绿色包**：解压即用，不写注册表、不装到系统目录；用 Toolbox 装的话，IDE 里还有
   *Run Another IDE Version* 可以直接切到别的版本，省掉手动解压。

3. **A–E 五组共用同一个操作面**（打开文件 / 控制台 / 右键菜单 / 设置页），凑在一起跑，10 分钟能过完。

### 不能省的三格

| 格 | 为什么不能省 |
|---|---|
| **C3**（库里没有源码的类跳转） | 本轮**唯一有语义差异**的改动：平台自己的 `OpenSourceUtil` 会优先尝试"跳到源码"，原实现只认 `canNavigate()` |
| **F1.2**（2026.3 上禁用 *Web Browser (JCEF)* 插件） | 决定要不要做 JCEF 类隔离重构——**这一格的实测结果才是决策依据** |
| **D3 / D4**（10 种语言文案） | `DynamicBundle` 从继承改委托，而这个类被**所有** action 引用，改错会全局崩 |

### 一次性算总账

| 方案 | 下载量 | 人力 | 能证明什么 |
|---|---|---|---|
| **推荐**：日常 IDE 跑 A–E/F1 + 233 IC 可选冒烟 | 0 – 589 MB | ~1 小时 | 全部行为 + 静态证据补足版本兼容 |
| 报告原方案：装 5 个 IU | ~5 GB | ~4 小时 | 同上，无额外信息量 |
| 全跳过 | 0 | 0 | 只有静态证据，没有行为证据 |

---

## A. 打开文件流程（P0-c，改动最大）

> 背景：`openFile` ×2 + `openTextEditor` 全部换成 `OpenFileDescriptor.navigate(true)`，
> 选区改为"编辑器就绪后补设"（50ms × 20 次有界重试）。

| # | 操作 | 期望结果 | V1 | V2 | V3 | V4 | V5 |
|---|---|---|---|---|---|---|---|
| A1 | 在聊天里发 `打开 src/main/java/.../Foo.java`（**无行号**） | 文件打开，**并获得焦点**（编辑器可立即输入） | ☐ | ☐ | ☐ | ☐ | ☐ |
| A2 | 发 `打开 .../Foo.java:42` | 文件打开，光标落在**第 42 行行首** | ☐ | ☐ | ☐ | ☐ | ☐ |
| A3 | 发 `打开 .../Foo.java:42-45` | 文件打开，**第 42 行行首 → 第 45 行行尾**被选中 | ☐ | ☐ | ☐ | ☐ | ☐ |
| A4 | 发 `打开 .../Foo.java:42-42` | 整行（第 42 行）被选中 | ☐ | ☐ | ☐ | ☐ | ☐ |
| A5 | 发 `打开 .../Foo.java:99999`（行号越界） | 夹到**最后一行**，不报错 | ☐ | ☐ | ☐ | ☐ | ☐ |
| A6 | 对**空文件**发 `打开 .../Empty.java:1` | 文件打开，不弹异常（可能无选区） | ☐ | ☐ | ☐ | ☐ | ☐ |
| A7 | 对**非文本文件**（如 `.png`）发 `打开 .../a.png:1` | 文件用默认编辑器打开，不弹异常 | ☐ | ☐ | ☐ | ☐ | ☐ |
| A8 | 发 `打开 .../Foo.java:60-40`（区间倒置） | 只移动光标到第 60 行，**不产生选区** | ☐ | ☐ | ☐ | ☐ | ☐ |
| A9 | 通过 **Skill** 触发打开文件 | 文件打开并聚焦（走 `EditorFileOpener`，改为 `navigate(true)`） | ☐ | ☐ | ☐ | ☐ | ☐ |
| A10 | 文件**已在编辑器打开**时再次发打开指令 | 复用已开标签页，光标定位到目标行 | ☐ | ☐ | ☐ | ☐ | ☐ |

**A 组失败信号**：文件不打开 / 焦点丢失（打开后键盘输入落在聊天框）/ 光标行号差一行 /
选区多含一个换行符 / 控制台出现 `Editor not ready, skipped range selection` 警告。

---

## B. 控制台选区发送（P1-a）

> 背景：`LangDataKeys.CONSOLE_VIEW` 字段在 263 被废弃，改成运行时反射解析
> `ExecutionDataKeys.CONSOLE_VIEW`（263+）→ `LangDataKeys.CONSOLE_VIEW`（233–262）。

| # | 操作 | 期望结果 | V1 | V2 | V3 | V4 | V5 |
|---|---|---|---|---|---|---|---|
| B1 | 打开 Run/Debug 控制台，**选中一段输出文字** | 右键菜单里出现"发送到 AI"，**可用（不是灰的）** | ☐ | ☐ | ☐ | ☐ | ☐ |
| B2 | 点击"发送到 AI" | 选中的文字**进入聊天输入框** | ☐ | ☐ | ☐ | ☐ | ☐ |
| B3 | 控制台**没有选中任何文字** | 菜单项灰掉或不可见 | ☐ | ☐ | ☐ | ☐ | ☐ |
| B4 | 控制台里选中**纯空白**（空格/换行） | 不发送空内容 | ☐ | ☐ | ☐ | ☐ | ☐ |

**B 组失败信号**：菜单项始终灰掉（说明反射没解析到 key —— **V1 上必查**，
233 的 `ExecutionDataKeys` 里根本没有 `CONSOLE_VIEW` 字段，全靠回退分支）。

> ⚠️ **B 组有一格版本依赖，容易被漏掉**：反射解析是"先 `ExecutionDataKeys`、再 `LangDataKeys`"。
> - 在 **263+** 上只会命中 **`ExecutionDataKeys.CONSOLE_VIEW`** 分支；
> - **`LangDataKeys` 回退分支只在 <263 的 IDE 上才会走到**。
>
> 所以：**如果只在 263 上跑 B 组，回退分支是没有被验证过的**。
> ① 你日常用的 IDE 若是 <263（2025.x / 2026.1 / 2026.2），这一格自动覆盖；
> ② 若是 263+，要么加一个 233 Community（589 MB）跑这一格，要么接受"回退分支只有单元测试覆盖"
> —— 单元测试（`consoleViewKeyIsResolvedFromTheFirstOwnerThatDeclaresIt`）已经验证了**解析顺序与回退逻辑**，
> 剩下的风险只是"233 上那个 key 的运行时值是否正确"，概率很低。

---

## C. Java 类跳转（P1-b）

> 背景：`navigatable.navigate(true)` 换成 `OpenSourceUtil.navigate(true, false, navigatable)`。
> ⚠️ **这是本次唯一有语义差异的改动**：平台自己的 `OpenSourceUtil` 会优先尝试"跳到源码"
> （`canNavigateToSource`），原实现只认 `canNavigate()`。

| # | 操作 | 期望结果 | V1 | V2 | V3 | V4 | V5 |
|---|---|---|---|---|---|---|---|
| C1 | 让 AI 打开一个**项目内**的类 | 跳到该类源码，光标定位到类声明处 | ☐ | ☐ | ☐ | ☐ | ☐ |
| C2 | 让 AI 打开一个**库里有源码**的类（如 `java.util.ArrayList`） | 跳到源码并定位 | ☐ | ☐ | ☐ | ☐ | ☐ |
| C3 | 让 AI 打开一个**库里没有源码**的类 | ⚠️ **重点**：确认行为与改动前一致——是打不开、还是打开了反编译文件？记录实际表现 | ☐ | ☐ | ☐ | ☐ | ☐ |
| C4 | 打开一个**不存在**的类名 | 聊天里给出"找不到类"的提示，不静默失败 | ☐ | ☐ | ☐ | ☐ | ☐ |
| C5 | 在 **Dumb mode**（索引未完成）时打开类 | 等待索引完成后自动跳转 | ☐ | ☐ | ☐ | ☐ | ☐ |

**C 组失败信号**：跳转没有发生（静默失败）/ 跳到了错误的文件 / 打开了**多个**文件
（`OpenSourceUtil` 有"批量跳源码"逻辑，理论上只传了一个导航目标，但需要确认）。

---

## D. 界面文案（P0-b）

> 背景：`QwenMateBundle` 从**继承** `DynamicBundle` 改成**委托**，构造器换成
> `new DynamicBundle(QwenMateBundle.class, BUNDLE)`。**这个类被所有 action 引用，改错会全局崩。**

| # | 操作 | 期望结果 | V1 | V2 | V3 | V4 | V5 |
|---|---|---|---|---|---|---|---|
| D1 | 把 IDE 语言切到中文 | 插件内所有文案为中文 | ☐ | ☐ | ☐ | ☐ | ☐ |
| D2 | 切到英文 | 所有文案为英文 | ☐ | ☐ | ☐ | ☐ | ☐ |
| D3 | 切到日语 / 韩语 / 法语 / 德语 / 西班牙语 / 俄语 / 葡萄牙语 / 意大利语 | 对应语言文案正常 | ☐ | ☐ | ☐ | ☐ | ☐ |
| D4 | 任意语言下浏览插件所有菜单/设置页 | **没有裸露的 key**（形如 `action.sendConsoleSelection.text`） | ☐ | ☐ | ☐ | ☐ | ☐ |
| D5 | 切换语言后**重启 IDE** | 文案仍正常（bundle 缓存不炸） | ☐ | ☐ | ☐ | ☐ | ☐ |

**D 组失败信号**：任何位置出现 `messages.QwenMateBundle` 前缀或 key 字符串；
抛 `MissingResourceException`；界面语言不跟随 IDE 设置。

---

## E. MCP 市场与 URL（P0-a）

> 背景：`new URL(String)` → `URI.create(...).toURL()`，并把 `IllegalArgumentException`
> 转成 `IOException`（保持原有异常契约）。

| # | 操作 | 期望结果 | V1 | V2 | V3 | V4 | V5 |
|---|---|---|---|---|---|---|---|
| E1 | 打开 MCP 市场页（GitHub 源） | 列表正常加载 | ☐ | ☐ | ☐ | ☐ | ☐ |
| E2 | 打开 MCP 市场页（官方 registry 源 `registry.modelcontextprotocol.io`） | 列表正常加载 | ☐ | ☐ | ☐ | ☐ | ☐ |
| E3 | 打开 GitHub 组织源 | 列表正常加载 | ☐ | ☐ | ☐ | ☐ | ☐ |
| E4 | 配置一个**错误的**源 URL | 弹出错误提示，**插件不崩溃**（`IOException` 被吃掉或提示） | ☐ | ☐ | ☐ | ☐ | ☐ |

**E 组失败信号**：未捕获的 `IllegalArgumentException` 栈（说明异常契约没保持住）。

---

## F. 结构性风险（P2，验证器抓不到）

### F1. JCEF 在 2026.2+ 拆成独立插件 —— **最高优先级**

> 背景：2026.2 起 JCEF 由独立的 *Web Browser (JCEF)* 插件提供。
> 当前 `plugin.xml` 声明的是 `<depends optional="true" config-file="jcef-features.xml">com.intellij.modules.jcef</depends>`，
> 而 `com.intellij.modules.jcef` 别名 **2025.3.1 才存在**——233–253.0.x 上这个 optional 依赖解析不到，
> `jcef-features.xml` 永不加载。代码里靠 `baseline >= 262` 的判断兜住了，但这是**巧合性正确**。
> 同时有 **11 个 always-loaded 文件**直接引用 `com.intellij.ui.jcef.*`。

| # | 操作 | 期望结果 | V3 | V4 | V5 |
|---|---|---|---|---|---|
| F1.1 | 在 **2026.2 / 2026.3** 上安装插件并启动 | 插件**正常加载**，聊天窗口正常，WebView 能渲染 | ☐ | ☐ | ☐ |
| F1.2 | 在 **2026.3** 上**禁用** *Web Browser (JCEF)* 插件，再启动 | ⚠️ **关键场景**：要么插件拒绝加载并给出清晰提示，要么插件加载但 WebView 功能降级——**绝不能整插件崩掉**（`NoClassDefFoundError`） | ☐ | ☐ | ☐ |
| F1.3 | 在 **233** 上启动 | 插件正常加载，聊天窗口正常 | ☐ | ☐ | ☐ |
| F1.4 | 在 **262 / 263** 上打开 DevTools（开发用动作） | 正常打开或明确提示不可用，不崩溃 | ☐ | ☐ | ☐ |
| F1.5 | 确认 `jcef-features.xml` 里的 service 在 **233** 上**没有**被注册（预期行为） | 无 JCEF 时不注册、不报错 | ☐ | ☐ | ☐ |

**F1.2 是整个 P2 里唯一可能"致命"的一格**——它决定了要不要做 JCEF 类隔离重构。
先测这一格，再决定要不要动那 11 个文件。

### F2. PythonCore 盲区

> 背景：`build.gradle` 把 `com.jetbrains.python` 整个前缀排除在 verifier 检查外，
> 且 PythonCore 钉在 243.x。**Python 侧的所有弃用/移除完全不在视野内。**

| # | 操作 | 期望结果 | V1 | V2 | V3 | V4 |
|---|---|---|---|---|---|---|
| F2.1 | 在装了 Python 插件的 IDE 里打开 `.py` 文件 | 插件正常加载，Python 上下文采集不报错 | ☐ | ☐ | ☐ | ☐ |
| F2.2 | 在 `.py` 文件里让 AI 读取上下文 | 函数名/类名/docstring/参数/imports 都能正常采集 | ☐ | ☐ | ☐ | ☐ |
| F2.3 | ~~用最新 PythonCore 核对 API 废弃状态~~ | ✅ **已自动完成**（见下），只需人工确认 F2.1 / F2.2 | ✅ | — | — | — |

`PythonContextCollector` 用到的 Python 类型（共 11 个）：

```
PyFile  PyFunction  PyClass  PyStatementList  PyStatement  PyExpressionStatement
PyExpression  PyStringLiteralExpression  PyParameter  PyImportStatement  PyFromImportStatement
```

实际调用的**方法**（只需核对这些）：

| 方法 | 声明位置 | 243 | 263 |
|---|---|---|---|
| `getStatementList()` | `PyFunction` | 未废弃 | 未废弃 |
| `getParameterList()` | `PyCallable`（`PyFunction` 继承而来） | 未废弃 | 未废弃 |
| `getSuperClassExpressions()` | `PyClass` | 未废弃 | 未废弃 |
| `getStatements()` | `PyStatementList` | 未废弃 | 未废弃 |
| `getExpression()` | `PyExpressionStatement` | 未废弃 | 未废弃 |
| `getParameters()` | `PyParameterList` | 未废弃 | 未废弃 |

其余 `getName()` / `getText()` 都来自 `PsiNamedElement` / `PsiElement`，稳定。

**自动审计结论**（`scripts/audit_python_psi_apis.py`，对 243 与 263 两个 release tag 的 Python PSI 源码逐类逐方法核对）：

> **12 个类 + 6 个方法，在 243 与 263 上均未被废弃。**
> 唯一带 `@Deprecated(forRemoval = true)` 的是 `PyFile.getElementNamed(String)`——插件**没有**用到它。

复跑命令：

```bash
python "Compatibility verification/deprecation-audit/scripts/audit_python_psi_apis.py"
```

**已知要避开的**（代码里已刻意避开，保持住）：`PyAstFunction.getContent()`（experimental）、
`PyAstStringElement.getStringValue()`（Marketplace flagged）。

### F3. 验证器复跑（最后收口）

> ⚠️ **这一步比人工验证更贵**：verifier 每个 IDE 要下 **1.2–1.5 GB**（263 IU 更是 1.46 GB）。
> 本地全矩阵 = ~5 GB 下载。建议**只留 263 一个在本地**，其余交给 CI。

| # | 操作 | 期望结果 | 状态 |
|---|---|---|---|
| F3.1 | 对 **263** 跑一次 verifier（`run_local_verification.sh 1.1.1 2026.3`） | **0 条弃用**（原为 6 条）、0 override-only | ☐ |
| F3.2 | 完整矩阵（233 / 243 / 262 / 263）跑在 **CI** 上，而不是本地 | 全部 0 弃用、0 override-only、0 compatibility problem | ☐ |
| F3.3 | 确认 `build.gradle` 的 `failureLevel` 已含 `DEPRECATED_API_USAGES` + `OVERRIDE_ONLY_API_USAGES` | 弃用从此是**构建门禁**，不再是"看报告才知道" | ☐ |

> **Windows 注意**：`run_local_verification.sh` 是 **bash 脚本**（用 `curl` / `tar` / `python3`，工作目录写死在 `/workspace/verifier-work`），
> 在 Windows 上要通过 **Git Bash / WSL** 运行，或直接用 Gradle 的 `verifyPlugin` 任务
> （`.\gradlew.bat verifyPlugin -PskipWebview=true`）。
>
> CI 方案二选一：
> - GitHub Actions 用 JetBrains 官方的 `intellij-platform-plugin-verifier` action（IDE 下载走 CI 机器，不占本地带宽）；
> - 或者上传 Marketplace，让 JetBrains 侧的托管验证跑矩阵（这正是本仓库那 78 份历史报告的来源）。

---

## G. 验证记录表（填完这张表才算收口）

| 日期 | 验证人 | IDE 版本 | 组 | 结论 | 备注 / 缺陷单 |
|---|---|---|---|---|---|
|  |  |  | A | ☐ 通过 ☐ 失败 |  |
|  |  |  | B | ☐ 通过 ☐ 失败 |  |
|  |  |  | C | ☐ 通过 ☐ 失败 |  |
|  |  |  | D | ☐ 通过 ☐ 失败 |  |
|  |  |  | E | ☐ 通过 ☐ 失败 |  |
|  |  |  | F1 | ☐ 通过 ☐ 失败 |  |
|  |  |  | F2 | ☐ 通过 ☐ 失败 |  |
|  |  |  | F3 | ☐ 通过 ☐ 失败 |  |

---

## H. 优先级与执行顺序建议

### 最省的做法（推荐）

1. **在你日常用的 IDE 上跑 A / B / C / D / E**（+ F1，如果它是 2026.2+）。
   这五组共用同一个操作面，**10 分钟能过完**。
2. **如果日常 IDE 是 263+**，B 组的 `LangDataKeys` 回退分支没被覆盖 → 要么加一个
   **233 Community（589 MB，免费绿色包）** 跑 B 组，要么接受单元测试级的覆盖。
3. **F1.2**（2026.3 上禁用 *Web Browser (JCEF)* 插件）——优先做，它是 JCEF 重构的决策依据。
4. **F2**（Python）——API 审计已证明没废弃，**可以先跳过**；IC 不带 PythonCore，
   要测得用 PyCharm / IDEA Ultimate。
5. **F3** —— 本地只跑 263 一个，其余放 CI。
6. **V5（EAP）** —— 纯增量，不阻塞发布。

### 如果时间充裕（完整做法）

1. **先 V1（233）跑 A / B / D**——233 是下界，一旦这里挂了说明用了 243 才有的 API，
   后面所有版本都不用测了。
2. **再 V4（263）跑 A / B / C / D / E**——上界，弃用告警的来源。
3. **然后 V3（262）+ V4 跑 F1**，**F1.2 优先**。
4. **最后跑 V5（EAP）**——纯增量检查，不阻塞发布。
5. **F3（验证器复跑）可以随时跑**，不需要真实 IDE。

**可以只测一个 IDE 的话**：选**日常在用的那个**——"版本兼容"这一层已经由三条静态证据
（233 历史验证报告 + 三版本源码逐字核对 + 字节码扫描）覆盖，IDE 只需要回答"行为对不对"。
