# QwenMate · 弃用 API 定位与升级方案

> 2026-11-10 · 插件 v1.1.1 · `sinceBuild=233` / `untilBuild=263.*` · 编译目标 IC 243.22562.145

---

## 决策摘要

**目标**：把最新 IDE（2026.3 / 263.7307.200）上的弃用告警清零，同时保住 233–263 全兼容区间。

| 项 | 现状 | 目标 |
|---|---|---|
| 二进制不兼容 | 0 条（78 条验证记录） | 保持 0 |
| 弃用告警（263 GA） | **6 条 / 5 个 API** | **0** |
| override-only 告警 | **1 条**（仅 2 个 EAP build 出现，GA 已回退） | **0**（防复发） |
| 插件 API 表面对编译目标 243 的体检 | **200 符号 / 0 命中** | 保持 0 |
| 官方 380 条破坏性变更的交集 | 真实命中 **1 条** -> **0 条**（P1-a 改反射后，成员不再被直接引用） | — |

**三个决定方案的事实：**

1. **向后兼容基线是干净的。** 插件用到的 200 个 `com.intellij`/`com.jetbrains` 符号（282 个源文件），在编译目标 243 上**没有一个**被废弃、内部化或标记试验性；官方 2023–2026 全部 380 条破坏性变更里，插件真实命中的原本只有 1 条（`LangDataKeys.CONSOLE_VIEW` 类型变更），P1-a 改成反射后**降为 0 条**。**所以不需要为兼容 233 而放弃新 API——只需换掉被平台废弃的老调用。**
2. **两处"官方推荐替代 API"在 233 上不存在**，不能直接换（否则 233–26x 运行时报 `NoSuchFieldError`）。详见下方约束表，这是本次升级唯一的硬约束。
3. **风险主要不在 6 条弃用，而在 4 个验证器抓不到的结构性问题**（§3），其中 JCEF 依赖声明风险最高。

---

## 1. 工作清单（P0：清零 263 上的 6 条弃用）

> 位置均为 `qwen-mate/src/main/java/` 下的相对路径。**"233 可用"列已用本地 IDEA IC-243.22562.145 SDK 的 `javap` 实测**，是能否直接换 API 的判定依据。

### 1.1 `java.net.URL.<init>(String)` — 低风险，机械替换 ✅ 已实施

> 实施结果见 §7.1。采用 `URI.create(url).toURL()`，并把 `IllegalArgumentException` 转成 `IOException`
> 以保持原有异常契约（**这是关键**：不转的话，未捕获的 `IllegalArgumentException` 会绕开本客户端
> 基于 `IOException` 的缓存/降级逻辑）。
>
> 补充事实：这个废弃**不是 263 专属**——它从 **242 起每个 build 都报**（IDE 内置 JDK 升到 21+），
> 233/241 因为还是 JDK 17 才不报。所以本项的实际收益是"242–262 全区间清零"。

- **位置**：`com/qwenmate/mcp/marketplace/McpMarketplaceHttpClient.java:98`
- **现状**：`URL url = new URL(urlValue);` — JDK 20+ 废弃。与 IDE 版本无关，242 起每个 build 都报。
- **为什么必须改**：2026.2+ IDE 运行时已是 JDK 25，这行在编译期就会产生废弃告警。
- **修法**：
  ```java
  URL url;
  try {
      url = URI.create(urlValue).toURL();
  } catch (IllegalArgumentException e) {
      throw new IOException("Malformed marketplace URL: " + urlValue, e);
  }
  ```
  （`new URL` 抛 `MalformedURLException`（IOException 子类），`URI.create` 抛 `IllegalArgumentException`——必须转换，否则会改变异常契约。）
- **233 可用**：✅ 纯 JDK，无版本约束。
- **验收**：263 验证弃用数 6 → 5；`McpMarketplaceHttpClient` 相关测试通过。

### 1.2 `DynamicBundle.<init>(String)` — 低风险，机械替换 ✅ 已实施

> 实施结果见 §7.1。委托写法（`new DynamicBundle(QwenMateBundle.class, BUNDLE)`）在 263 上**不只是"官方推荐"，
> 而是强制**——263 的废弃注解原文是
> *"Do not subclass {@link DynamicBundle}, only create instances and delegate to them"*。
>
> 顺带核实了一个容易踩的点：两个构造器解析 bundle 用的 classloader 是**同一个**
> （`DynamicBundle(Class,String)` 用 `bundleClass.getClassLoader()`；
> `DynamicBundle(String)` 经 `AbstractBundle` 用 `getClass().getClassLoader()`，而 `getClass()` 就是
> `QwenMateBundle`）→ **文案查找路径不变**，切换不会导致 10 种语言文案失效。

- **位置**：`com/qwenmate/i18n/QwenMateBundle.java:22`（`super(BUNDLE)`）
- **现状**：`public class QwenMateBundle extends DynamicBundle`
- **修法**：官方要求"**委托而非继承**"，且推荐构造器在 233 就已存在：
  ```java
  public final class QwenMateBundle {
      @NonNls
      private static final String BUNDLE = "messages.QwenMateBundle";
      private static final DynamicBundle INSTANCE = new DynamicBundle(QwenMateBundle.class, BUNDLE);

      private QwenMateBundle() { }

      @NotNull
      public static @Nls String message(@NotNull @PropertyKey(resourceBundle = BUNDLE) String key,
                                        Object @NotNull ... params) {
          return INSTANCE.getMessage(key, params);
      }
  }
  ```
  `plugin.xml` 的 `<resource-bundle>messages.QwenMateBundle</resource-bundle>` 保留不动。
- **233 可用**：✅ `DynamicBundle(Class<?>, String)` 在 233/241/242/243 均存在（实测）。
- **验收**：263 弃用数 5 → 4；10 种界面语言文案全部正常（这个类被所有 action 引用，改错会全局崩）。

### 1.3 `FileEditorManager.openFile(VirtualFile, boolean)` ×3 + `openTextEditor(OpenFileDescriptor, boolean)` ×1 — **本次唯一有真实行为变化的改动**

- **位置**：
  - `com/qwenmate/handler/EditorFileOpener.java:29`（`openFile`）
  - `com/qwenmate/handler/file/OpenFileHandler.java:581`（`openFile`）
  - `com/qwenmate/handler/file/OpenFileHandler.java:586`（`openTextEditor`）
  - `com/qwenmate/handler/file/OpenFileHandler.java:590`（`openFile`）
- **难点**：`openTextEditor` **没有等价替代**——官方推荐的 `requestOpenTextEditor` 在 243 完全不存在。而当前代码依赖 `openTextEditor` 的**同步**返回值来做光标定位与选区，改成非阻塞 `requestOpenFile` 后这段逻辑会失效。
- **修法**：改用 `OpenFileDescriptor`（233–263 全区间可用，且是 JetBrains 官方推荐的入口）：
  ```java
  // 无行号
  new OpenFileDescriptor(project, virtualFile).navigate(true);

  // 有行号：OpenFileDescriptor 负责"打开 + 定位到行"
  OpenFileDescriptor descriptor = new OpenFileDescriptor(project, virtualFile, lineNumber - 1, 0);
  descriptor.navigate(true);
  // 需要选区时，在下一轮 EDT 用 FileEditorManager.getAllEditors(VF) 取回 Editor 再设选区
  ```
- **233 可用**：✅ `OpenFileDescriptor(Project, VirtualFile)` 与 `OpenFileDescriptor(Project, VirtualFile, int logicalLine, int logicalColumn)` 在 233/243/263 三处源码中逐字一致；✅ `OpenFileDescriptor.navigate(boolean)` 三处均存在且 263 未废弃。
- **❌ 不可用：`FileEditorManager.requestOpenFile(VirtualFile)`** —— 已在 233 与 263 两端实测否决：
  - **233 上根本不存在**（`idea/233.11799.300` 的 `FileEditorManager.java` 全文无此方法）→ 直接换会在 233 抛 `NoSuchMethodError`；
  - **263 上签名变了**：243 是 `public void requestOpenFile(VirtualFile)`，263 改写为 Kotlin 后是 `open fun requestOpenFile(file: VirtualFile): CompletableFuture<FileEditorComposite>`，方法描述符从 `(…VirtualFile;)V` 变成 `(…VirtualFile;)Ljava/util/concurrent/CompletableFuture;` → 233/243 编译出的调用点在 263 上同样抛 `NoSuchMethodError`。
  - 结论：该 API 只在 244–262 区间安全，**不满足 233–263 全兼容**，因此放弃。
- **⚠️ 已复核**：`OpenFileDescriptor` 实现了 `Navigatable`，若平台未来把 `Navigatable.navigate` 的 `@OverrideOnly` 重新加回来，`descriptor.navigate(true)` 可能同样被标 —— **已在 263.7307.200 实测：未报**，见 §5.6。
- **风险**：中高。这是唯一需要回归测试的改动，建议**单独一个提交**，不要和 1.1/1.2 混在一起。
- **验收**：
  - 263 弃用数 4 → 0
  - 回归三个交互：无行号打开 / 打开并跳到指定行 / 打开并选中行区间（光标位置与选区范围都要对）
  - Skill 打开文件（`EditorFileOpener`）改为异步后，用户感知无异常

---

## 2. 工作清单（P1：清零字段级弃用 + 防 override-only 复发）

### 2.1 `LangDataKeys.CONSOLE_VIEW` — 必须用反射 ✅ 已实施

> 实施结果见 §7.1 / §7.3。实际实现与本节方案一致，两处增强：
> ① 用 `Class.forName(类名)` 而不是 `XxxKeys.class`——万一某个版本整个类都不存在，也不会在静态初始化时炸掉；
> ② 额外检查字段是否 `static`、值是否为 `DataKey`，并兜住 `LinkageError`（`NoClassDefFoundError`）。
> 解析失败时返回 `null`，动作直接表现为"菜单项灰掉"，而不是抛异常。

- **位置**：`com/qwenmate/action/console/SendConsoleSelectionToInputAction.java:60`
- **现状**：`e.getData(LangDataKeys.CONSOLE_VIEW)` — 2026.3 起字段被废弃，且类型由 `DataKey<ConsoleView>` 改为 `DataKey<?>`。
- **难点**：官方给的两个出路都不可用——
  - `ExecutionDataKeys.CONSOLE_VIEW` 在 **243 不存在**（该类在 243 里只有 `EXECUTION_ENVIRONMENT` 一个字段）→ 直接换会在 233–26x 抛 `NoSuchFieldError`；
  - 加显式 cast **解决不了弃用标记**（废弃的是字段本身，不是类型）。
  - 类型变更本身不影响编译（形参是 `Object`），唯一问题是字段级 `@Deprecated`。
- **修法**：运行时反射解析 `DataKey`，编译期不产生字段引用 → verifier 不再报：
  ```java
  /** 233 的 ExecutionDataKeys 没有 CONSOLE_VIEW；263 又废弃了 LangDataKeys.CONSOLE_VIEW。
   *  只有运行时解析才能同时满足 233–263 全区间与 0 弃用告警。 */
  private static final DataKey<Object> CONSOLE_VIEW = resolveConsoleViewKey();

  @SuppressWarnings("unchecked")
  private static DataKey<Object> resolveConsoleViewKey() {
      for (Class<?> owner : new Class<?>[]{ExecutionDataKeys.class, LangDataKeys.class}) {
          try {
              return (DataKey<Object>) owner.getField("CONSOLE_VIEW").get(null);
          } catch (NoSuchFieldException | IllegalAccessException ignored) {
              // 试下一个 owner
          }
      }
      return null;
  }
  ```
  优先取 `ExecutionDataKeys`（263+ 的新家），回退 `LangDataKeys`（233–262）。两个**类**本身都未废弃，被废弃的只是它们上面的 `CONSOLE_VIEW` **字段**，反射读字段不产生字段级字节码引用。
- **233 可用**：✅（反射，静态初始化时解析一次）。
- **验收**：263 弃用数 0；**在 233 与 263 两个 IDE 上分别实测**"控制台选中文字 → 发送给 AI"可用。

### 2.2 `com.intellij.pom.Navigatable.navigate(boolean)`（override-only）— 建议改，防未来 ✅ 已实施

> 实施结果见 §7.1 / §7.2。**本节原给的写法有两处错，已修正**：
> ① `OpenSourceUtil.navigate(true, true, Collections.singletonList(navigatable))` 走的是 `Iterable` 重载，
> 而**该重载在 263 已被废弃**（"the return value is not reliable with asynchronous navigation"）——
> 照抄等于新引入一条弃用告警。正确写法是用 `void` 变参重载：
> `OpenSourceUtil.navigate(true, false, navigatable)`（233/263 都存在且都未废弃）。
> ② 第二个参数的真实语义是 **`tryNotToScroll`（尽量别滚动）**，不是 `useCurrentWindow`；
> 为了与原来的 `navigate(true)` 行为一致（打开后滚动到目标），应传 `false`。
>
> ⚠️ 这是本轮**唯一有语义差异**的改动：平台自己的 `OpenSourceUtil` 会优先尝试"跳到源码"
> （`canNavigateToSource`），原实现只认 `canNavigate()`。**"库里没有源码的类"这一格必须人工实测**，
> 见 `manual-verification-checklist.md` 的 C3。

- **位置**：`com/qwenmate/handler/file/JavaClassNavigationSupport.java:100`
- **现状**：`navigatable.navigate(true);`
- **为什么现在不是故障**：263 GA 已回退 `@OverrideOnly` 注解（源码至今未改，但新版 build 不再报）。**但这是预警**——master 上 `Navigatable.navigate` 已重构为返回 `NavigationRequest`（导航改由平台执行），这条链下一轮 IDE 会再次变形。
- **修法**：`OpenSourceUtil` 是 233–263 全区间可用且未被废弃的官方入口：
  ```java
  if (target instanceof Navigatable navigatable && navigatable.canNavigate()) {
      // Navigatable#navigate 在 263 EAP 上被标 @ApiStatus.OverrideOnly，
      // master 上已重构为返回 NavigationRequest；OpenSourceUtil 是 233–263 全区间可用的官方入口。
      OpenSourceUtil.navigate(true, true, Collections.singletonList(navigatable));
      return;
  }
  ```
- **233 可用**：✅ `OpenSourceUtil.navigate(boolean, boolean, Navigatable...)` 在 243 存在。
- **备选（可选加分项）**：2026.1+ 的 `NavigationService`（无模态导航）更现代，但 243 不存在，只能反射接入。**非必做**——真正的前向安全策略是减少对 `Navigatable` 的依赖。
- **验收**：263 上 override-only 告警为 0；Java 类跳转功能在 233 与 263 上均正常。

### 2.3 P0+P1 完成后的目标状态

**263.7307.200 上弃用 0 条 + override-only 0 条**，且 233–263 全区间功能不变。

---

## 3. 结构性风险（验证器抓不到，78 份报告全是绿灯）

### 3.1 JCEF 在 2026.2 拆成独立插件 — **最高优先级**

- **官方规则**：2026.2 起 JCEF 由独立的 *Web Browser (JCEF)* 插件提供，用 JCEF API 的插件**必须显式声明依赖**；且 **`com.intellij.modules.jcef` 别名 2025.3.1 才存在**，更早版本解析不到（官方原话：要支持更早版本得"发两个插件版本"）。
- **当前声明**：`plugin.xml:76` → `<depends optional="true" config-file="jcef-features.xml">com.intellij.modules.jcef</depends>`
- **三个具体问题**：
  1. 233–253.0.x 上这个 optional 依赖**根本解析不到** → `jcef-features.xml` 永不加载 → `JcefModuleAvailability` 服务永不注册。代码里靠 `baseline >= 262` 的判断恰好兜住了，但这是**巧合性正确**，不是设计性正确。
  2. 2026.2+ 上 JCEF 已是独立 classloader，而 `com.intellij.ui.jcef.*` 被 **11 个 always-loaded 文件**直接引用（`JBCefBrowserFactory`、`WebviewInitializer`、`PermissionDialog`、`ChatWindowDelegate` 等）。官方要求"explicit dependency"正是为了避免 JCEF 插件缺失时抛 `NoClassDefFoundError`，而不是让 IDE 干净地拒绝加载 QwenMate。
  3. 直接改成非 optional 依赖 → 插件在 233–253.0.x 上**完全无法加载**。
- **建议方案**（保住单版本全区间）：
  - 把 JCEF 相关类从 always-loaded 路径隔离（`jcef-features.xml` 里已注册的 service 是现成抓手），或在 always-loaded 路径上先 `Class.forName` 探测再触碰 JCEF 类；
  - 或改用模块化依赖 `<dependencies><module name="intellij.platform.ui.jcef"/></dependencies>`，并把 JCEF 类收敛进独立模块。
  - 无论哪种方案，**必须在 262 与 263 上各做一次真实启动验证**——verifier 永远不会告诉你这件事。

### 3.2 验证矩阵覆盖不足

- **现状**：`pluginVerification.ides` 当时只钉了 `ide('IU', '262.9437.22')`（该 build 号后被证明不存在，见 §7.7）；`failureLevel` 只有 `COMPATIBILITY_PROBLEMS` 和 `INTERNAL_API_USAGES`，**没有 `DEPRECATED_API_USAGES`** → 本地验证根本不会因 6 条弃用而失败。
- **建议**：
  ```groovy
  pluginVerification {
      failureLevel = [
          COMPATIBILITY_PROBLEMS,
          INTERNAL_API_USAGES,
          DEPRECATED_API_USAGES,     // 新增：让弃用成为门禁
          OVERRIDE_ONLY_API_USAGES,  // 新增：抓住 Navigatable 这类 SPI 越界
      ]
      ides {
          ide('IU', '233.11799.300')   // 区间下界（2023.3，Java 17）
          ide('IU', '243.22562.145')   // 编译目标
          ide('IU', '262.11879.100')   // 2026.2 稳定版
          ide('IU', '263.7307.200')    // 2026.3 稳定版
          select { channels = listOf(ProductRelease.Channel.EAP); sinceBuild = '263' }  // EAP 通道 —— ❌ 不可用，见下方说明
      }
  }
  ```
  > `FailureLevel` 枚举名请以本仓库 IntelliJ Platform Gradle Plugin **2.10.5** 的实际定义为准（2.19+ 后命名有变动）。
  >
  > **✅ 已实施**（见 §7.4）。实测结论：
  > - 枚举名在 2.10.5 里确实是 `DEPRECATED_API_USAGES` 与 `OVERRIDE_ONLY_API_USAGES`，本节建议可直接用。
  > - **`select { channels = ... }` 动态 EAP 通道不能用**：它在 **配置期**就要拉取 JetBrains 产品清单，
  >   一旦网络抖动会让**所有** Gradle 任务失败（本轮实测 `Could not create provider for value source ProductReleasesValueSource`）。
  > - **`ide(...)` 必须显式 `useInstaller = false`**（本轮实际踩到，见 §7.7）。
  > - 已改为固定 build 号（`233.15619.7` / `243.28141.41` / `262.9437.185` / `262.11879.100` / `263.7307.200`），
  >   全部经 HEAD 校验在 JetBrains **Maven 仓库**中存在。

### 3.3 编译目标不是区间下界 — ⏸️ 用"对 233 单独验证"替代（见 §7.4）

- **现状**：编译目标 243，但 `sinceBuild = 233`。官方明确要求"对最低支持版本编译以保证向后兼容"。
- **为什么有风险**：用 243 SDK 编译意味着可能误用 243 才有的 API，在 233/241 上抛 `NoSuchMethodError`。**今天恰好没有这个问题，但没有任何机制保证明天没有。**
- **建议**：把编译目标下移到 233，或 CI 增加一条"对 233 单独验证"的门禁。

### 3.4 PythonCore 是完全盲区 — ✅ 源码级审计已做（运行时行为仍需人工验证）

- **现状**：`build.gradle:118` 固定 `plugin('PythonCore', '243.22562.145')`，`build.gradle:158` 用 `externalPrefixes = ['com.jetbrains.python']` 把整个 Python 包排除在 verifier 检查外。
- **后果**：`com.jetbrains.python` 的所有弃用/移除**完全不在视野内**。
- **建议**：至少做一次"用最新 PythonCore 编译 + 人工核对 `PythonContextCollector` 所用 API"（该类用了 `PyFile`、`PyFunction`、`PyClass`、`PyStatementList`、`PyStatement`、`PyExpressionStatement`、`PyExpression`、`PyStringLiteralExpression`、`PyParameter`、`PyImportStatement`、`PyFromImportStatement`）。代码里刻意避开 `PyAstFunction.getContent()`（experimental）与 `getStringValue()`（Marketplace-flagged）的做法是对的，这个警惕要保持。
- **✅ 已完成的替代方案**：不重编译（重编译最新 PythonCore 需要把工具链升到 Java 25，见 §3.5，成本与风险都不小），
  改用**源码级审计**：`scripts/audit_python_psi_apis.py` 从 intellij-community 的 **243 与 263** 两个 release tag
  拉取 Python PSI 源码，逐类逐方法核对废弃标记。
  **结论：12 个类 + 6 个被调用方法在 243 与 263 上均未被废弃。**
  唯一带 `@Deprecated(forRemoval = true)` 的是 `PyFile.getElementNamed(String)`，插件**没有**用到它。
  （补充一个容易踩的点：`getParameterList()` 不是 `PyFunction` 声明的，而是继承自 `PyCallable`——
  核验时如果只看 `PyFunction.java` 会误判成"方法不存在"。）
  **运行时行为**（Python 上下文采集是否正常）仍需在真实 IDE 上看一眼，见 `manual-verification-checklist.md` 的 F2.1 / F2.2。

### 3.5 附带：一旦把编译目标抬到 262+，Java 工具链必须同步升到 25

- 2026.2+ 平台是 Java 25 字节码（class file major 69）。本仓库**显式钉了** `sourceCompatibility/targetCompatibility = VERSION_17` 和 `options.release.set(17)`——这个显式 pin 会覆盖 Gradle 插件的约定值。
- 若将来把 `intellijIdeaCommunity('2026.3')` 写进 build.gradle 而不改 toolchain，会直接编译失败（bad class file version 69.0 / should be 65.0）。**改编译目标必须同改 toolchain**，且 `options.release.set(...)` 要一起调整。

---

## 4. 执行顺序与验收

> 本节是第一轮的**分阶段计划**，已执行完毕（见 §7）。**当前的验证范围、顺序与发布判定以
> [`manual-verification-checklist.md`](manual-verification-checklist.md) 为准。**

| 阶段 | 内容 | 风险 | 验收 |
|---|---|---|---|
| **P0-a** | §1.1 URL | 低 | 263 弃用 6→5 |
| **P0-b** | §1.2 DynamicBundle | 低 | 263 弃用 5→4；10 语言文案正常 |
| **P0-c** | §1.3 打开文件流程重构 | **中高** | 263 弃用 4→**0**；三个打开交互回归通过 |
| **P1-a** | §2.1 CONSOLE_VIEW 反射 | 低 | 263 弃用保持 0；控制台发送见清单 B 组 |
| **P1-b** | §2.2 Navigatable | 低 | 263 override-only = 0；类跳转见清单 C 组 |
| **P2** | §3.1 JCEF / §3.2 验证矩阵 / §3.3 编译目标下移 / §3.4 PythonCore 盲区 | 中 | 5 个固定 build 全绿；262/263 真实启动通过 |

**建议提交切分**：P0-a、P0-b、P0-c 各一个提交（P0-c 单独出，便于独立回滚）；P1 两项可合并为一个"消除字段级弃用与 override-only"提交。

**回归重点**（只覆盖本次触及的行为面）：

- 打开文件：无行号 / 单行 / 行区间 三种形态下光标位置与选区是否正确（异步化后最容易在这里出问题）
- Skill 打开文件：改为异步后文件打开时机变晚，确认用户感知正常
- 控制台发送选中文本：反射解析的 `DataKey` 在 233 与 263 上都能取到
- Java 类跳转：`OpenSourceUtil.navigate` 与原 `Navigatable.navigate` 的行为差异（尤其跳转到库中 class 的反编译场景）

**本地复现**（无需账号）：

```bash
bash "Compatibility verification/qwenmate-verifier-reports/run_local_verification.sh" 1.1.1 2026.3
```

修完后 263.7307.200 的判定应为 `Compatible.`（无弃用、无 override-only）。

**关于 `untilBuild`**：当前是 `263.*`，已经是"最大范围"里最保守的一档。P0+P1 修完、验证矩阵跑绿之后，建议提到 `264.*` 并**先发一个 EAP**——让托管验证和用户反馈在 264 正式版发布前到位。**下一个版本的上游窗口，取决于这一轮修得够不够快。**

---

## 5. 实施记录：P0-c 打开文件流程重构（2026-11-10 已完成）

### 5.1 改动内容

| 文件 | 改动 |
|---|---|
| `handler/file/EditorNavigationTarget.java` | **新增**。把"光标停在哪、选中哪一段"抽成纯计算，含 `LineGeometry` 最小抽象 |
| `handler/file/OpenFileHandler.java` | `openInEditor` 重写：去掉 `openFile`×2 与 `openTextEditor`，改用 `OpenFileDescriptor.navigate(true)` + 编辑器就绪后补选区 |
| `handler/EditorFileOpener.java` | `openFile(vf, true)` → `new OpenFileDescriptor(project, vf).navigate(true)` |
| `handler/file/EditorNavigationTargetTest.java` | **新增** 14 个回归测试 |

**弃用计数**：263 上 `openFile`×3 + `openTextEditor`×1 共 4 条 → **0 条**（由编译产物常量池扫描直接证明，见 §5.6）。GA 263.7307.200 的总弃用数因此从 **6 条降到 3 条**。

### 5.2 三个关键实现决策

**① 几何计算延后到编辑器就绪后做**，而不是打开前。

原实现先 `openTextEditor` 同步拿到 Editor，再从 `editor.getDocument()` 读行数。如果改成打开前用 `FileDocumentManager.getDocument(vf)` 计算，等于在 EDT 上强制同步读盘——正是平台废弃同步打开 API 要避免的冻结风险。新实现改为：`navigate(true)` 打开并落光标 → 编辑器就绪后从 `editor.getDocument()` 计算 → 应用光标与选区。既不引入 EDT 读盘，也与原行为逐行对齐。

**② 放弃 `FileEditorManager.requestOpenFile`，全部改用 `OpenFileDescriptor.navigate(true)`**（两端实测否决，详见 §1.3）。

`requestOpenFile` 在 **233 上不存在**、在 **263 上改了返回类型**（`void` → `CompletableFuture`），只对 244–262 安全，不满足 233–263 全兼容。改用 `navigate(true)` 后：

- 焦点语义不变——`navigate(true)` 的 `requestFocus` 参数与旧的 `openFile(vf, true)` 语义一致；
- 打开语义不变——已用 243 SDK 字节码确认 `FileNavigatorImpl.navigate` → `navigateInEditorOrNativeApp` → `navigateInAnyFileEditor` → `FileEditorManager.openFileEditor(descriptor, requestFocus)` + `runWhenLoaded(editor, …)`，与旧的 `openFile` + `openTextEditor` 走的是同一套平台机制。

**③ 编辑器就绪用有界重试，不用平台监听**。

`navigate` 之后编辑器可能同步就绪也可能异步加载。实现先同步查一次，查不到则用 `AppExecutorUtil` + `invokeLater` 做 **50ms × 20 次（上限 1s）** 的有界重试；超时则只丢选区（日志告警），文件本身与光标已由 `navigate` 落地，不做无界等待。

### 5.3 新增的平台 API 使用

| API | 用途 | 233 | 243 | 263 废弃状态 | 判定依据 |
|---|---|---|---|---|---|
| `OpenFileDescriptor.navigate(boolean)` | 打开 + 落光标 | ✅ | ✅ | **未废弃** | 263 tag 源码无 `@Deprecated`；且 1.1.1 已在调用、263 验证报告未报 |
| `OpenFileDescriptor(Project, VirtualFile)` | 无行号打开 | ✅ | ✅ | 未废弃 | 233/243/263 三处源码签名一致 |
| `OpenFileDescriptor(Project, VirtualFile, int, int)` | 带行号打开 | ✅ | ✅ | 未废弃 | 233/243/263 三处源码签名一致（语义均为 logicalLine/logicalColumn） |
| `FileEditorManager.getAllEditors(VirtualFile)` | 定位该文件的编辑器 | ✅ | ✅ | **未废弃** | 263 tag 源码 `abstract fun getAllEditors(file: VirtualFile): Array<FileEditor>`，无 `@Deprecated` |
| `FileEditorManager.getSelectedTextEditor()` | 回退定位 | ✅ | ✅ | **未废弃** | 263 tag 源码 `abstract val selectedTextEditor: Editor?`（Kotlin property，Java 侧仍是 `getSelectedTextEditor()`） |
| `FileDocumentManager.getFile(Document)` | 校验编辑器归属 | ✅ | ✅ | **未废弃** | 1.1.1 已在调用，263 验证报告未报 |
| `TextEditor.getEditor()` | 取 Editor | ✅ | ✅ | **未废弃** | 1.1.1 已在调用，263 验证报告未报 |

> **判定依据分两类**：① 263 tag 官方源码逐行核对（`idea/263.7307.200` 的 `platform/analysis-api/src/com/intellij/openapi/fileEditor/FileEditorManager.kt` 与 `OpenFileDescriptor.java`）；② 已发布 1.1.1 在 263.7307.200 上的**验证报告**——1.1.1 已经调用了 `getSelectedTextEditor()`、`FileDocumentManager.getDocument/getFile`、`TextEditor.getEditor()`、`OpenFileDescriptor.navigate(boolean)`，而该报告列出了**全部**弃用项且不含它们。
>
> 另有一处形态变化已确认无碍：`FileEditorManager` 在 233/243 是 Java `public abstract class`，263 改写为 Kotlin `abstract class`——**都是 class 而非 interface**，方法调用字节码从 `invokeinterface` 变为 `invokevirtual`，但两侧编译产物一致，不产生二进制问题。

### 5.4 回归测试

`EditorNavigationTargetTest`（14 个用例，全绿）覆盖：

- **单行落点**：光标落在目标行行首
- **首行 / 非正行号**：夹到第 0 行
- **区间选区**：`[起始行行首, 结束行行尾]`，不含行尾换行符
- **单行区间**（`end == line`）：整行被选中
- **区间倒置**（`end < line`）：只移光标不选区
- **缺省结束行**：不选区
- **行号越界**：夹到最后一行
- **结束行越界**：夹到最后一行，起点仍留在请求的行
- **空文件**：落在唯一的空行；`lineCount == 0` 返回 null
- **末尾换行**：额外算一空行

全量测试（**第一轮**）：**994 passed / 0 failed / 8 skipped**，`checkstyleMain` 通过。

### 5.5 仍需人工在真实 IDE 验证的项

> ⚠️ **本节已被 §6.1 的集中清单取代**——所有需要真实 IDE 的验证项（A/B/C/D/E/F1/F2/F3）都已汇总到
> [`manual-verification-checklist.md`](manual-verification-checklist.md)，**一次做完即可收口**，不要分批返工。
> 下面保留原始三项作为背景。

单元测试覆盖的是**几何计算**，无法覆盖"文件真的打开了、编辑器真的就绪"。**原计划**在 233 与 263 两个 IDE 上各做一次真实验证（因为本次改动的核心正是跨版本 API 可用性）：

1. 打开文件（无行号）→ 文件打开并获得焦点
2. 打开文件并跳到指定行 → 光标在目标行
3. 打开文件并选中行区间 → 选区范围正确

外加一条：**Skill 打开文件**（走 `EditorFileOpener`，已由同步 `openFile` 改为 `navigate(true)`）→ 文件打开并聚焦，行为与改动前一致。

### 5.6 已完成的 263 侧复核（本次实测，不再是"待复核"）

原报告里标注为"待 263 字节码复核"的 6 项已全部有结论：

| 待复核项 | 结论 | 证据 |
|---|---|---|
| `OpenFileDescriptor.navigate(boolean)` | 未废弃 | 263 tag 源码无 `@Deprecated`；1.1.1 已在调用且 263 验证报告未报 |
| `FileEditorManager.getAllEditors(VF)` | 未废弃 | 263 tag `FileEditorManager.kt` 第 304 行 `abstract fun getAllEditors(file: VirtualFile): Array<FileEditor>`，无 `@Deprecated` |
| `FileEditorManager.getSelectedTextEditor()` | 未废弃 | 263 tag 同文件第 196 行 `abstract val selectedTextEditor: Editor?`；1.1.1 已在调用且验证报告未报 |
| `FileDocumentManager.getDocument/getFile` | 未废弃 | 1.1.1 已在调用且 263 验证报告未报 |
| `TextEditor.getEditor()` | 未废弃 | 1.1.1 已在调用且 263 验证报告未报 |
| `requestOpenFile` | **不可用（已弃用该方案）** | 233 源码中不存在；263 签名由 `void` 改为 `CompletableFuture` |

**新发现的跨版本破坏性变更（本次审计新增）**：

> `FileEditorManager.requestOpenFile(VirtualFile)` 在 233 → 263 之间发生了**返回类型变更**（`void` → `CompletableFuture<FileEditorComposite>`）。方法描述符随之改变，编译期不报错、**运行时 `NoSuchMethodError`**。
>
> 这类"签名变更型"破坏**不会出现在弃用告警里**，验证器只会把它报成 compatibility problem——也就是说**只有当插件真的调用了该方法**才会暴露。这是本次放弃 `requestOpenFile` 的直接原因，也提示：§2 里 `LangDataKeys.CONSOLE_VIEW` 的**类型变更**（`DataKey<ConsoleView>` → `DataKey<?>`）是同一类风险，虽然它不涉及方法描述符，但字段描述符同样会变——§2.1 的反射方案能同时规避字段废弃与类型变更两种风险。

### 5.7 编译产物级验证

`scripts/check_compiled_refs.py` 扫描 `build/classes/java/main` 的**字节码常量池**，逐条统计被监控 API 的调用点（按 `owner + name + descriptor` 精确匹配，避免重载折叠）。**第一轮结果**（已被 §7.5 的第二轮取代）：

```
scanned 541 class files (0 parse errors)
FileEditorManager.openFile(...)            0 calls   0 deprecated
FileEditorManager.openTextEditor(...)      0 calls   0 deprecated
FileEditorManager.requestOpenFile(...)     0 calls   0 deprecated
FileEditorManager.getAllEditors(VF)        1 call    0 deprecated
FileEditorManager.getSelectedTextEditor()  4 calls   0 deprecated
OpenFileDescriptor.navigate(boolean)       3 calls   0 deprecated
...
=> remaining deprecated call sites in compiled output: 4
```

第一轮残留的 4 条全部已在第二轮处理完（见 §7.1、§7.5）：

| 剩余弃用调用 | 归属 | 对应报告条目 |
|---|---|---|
| `java.net.URL.<init>(String)` ×1 | `McpMarketplaceHttpClient` | §1.1（P0-a） |
| `com.intellij.DynamicBundle.<init>(String)` ×1 | `QwenMateBundle` | §1.2（P0-b） |
| `LangDataKeys.CONSOLE_VIEW` ×1 | `SendConsoleSelectionToInputAction` | §2.1（P1） |
| `com.intellij.pom.Navigatable.navigate(boolean)` ×1 | `JavaClassNavigationSupport` | §2.2（override-only，**仅 263.6800.24 / 263.7031.23 两个 EAP build 出现，GA 263.7307.200 已回退**） |

即：GA 263.7307.200 的 6 条弃用中，**本次清掉 3 条**（`openFile`×2 + `openTextEditor`），剩 3 条；第 4 条属 EAP-only 的 override-only 问题。

---

## 6. 附录：数据与脚本

本目录下的机器可读产物与可复跑脚本：

| 文件 | 内容 |
|---|---|
| `ide-api-surface.json` | 插件用到的 200 个 IDE 符号及出现位置（282 个源文件） |
| `sdk-243-deprecation-audit.json` | 逐符号在 243 SDK 上的废弃/内部化/试验性判定（0 命中） |
| `official-changes-crossref.json` | 与官方 2023–2026 变更清单（380 条）的交叉比对命中项 |
| `apichanges/2023–2026.md` | JetBrains 官方破坏性变更清单原件 |
| `scripts/extract_ide_api_surface.py` | 提取插件完整 IDE API 表面 |
| `scripts/audit_sdk_deprecations.py` | class 文件级 SDK 废弃/内部 API 审计器（读 `ACC_DEPRECATED` + `RuntimeVisibleAnnotations`，含 Kotlin `@Deprecated`） |
| `scripts/crossref_changes.py` | 官方变更清单 × 插件符号表交叉比对 |
| `scripts/probe_replacements.py` | 替代 API 在目标 SDK 上的可用性探测（"233 可用"结论的来源） |
| `scripts/aggregate_verifier_warnings.py` | 归并 78 份验证报告的 12 类告警，输出「API × build」矩阵 |
| `scripts/check_compiled_refs.py` | **扫描编译产物字节码常量池**，逐条统计被监控 API 的调用点（按 owner+name+descriptor 精确匹配），直接证明"弃用调用归零" |
| `scripts/verify_platform_api_versions.py` | **跨版本平台 API 核验器**：从 233 / 243 / 263 三个 release tag 拉取平台源码，逐个判定成员是否存在、是否 `@Deprecated`、构造器签名是否一致（能抓到 `requestOpenFile` 这类"签名变更型"静默破坏） |
| `scripts/audit_python_psi_apis.py` | **Python 盲区审计器**：从 intellij-community 的 243 / 263 tag 拉取 Python PSI 源码，逐类逐方法核对废弃标记（补上 `externalPrefixes` 排除掉的整块视野） |
| `manual-verification-checklist.md` | **集中人工验证清单**：准备 → A/B/C/D/E/F1/F2/F3 八组 → 收口记录与发布判定（1 个 IDE 即可） |

脚本已做路径自解析，在 `deprecation-audit/` 下可直接复跑。

### 6.1 人工验证清单

**所有需要真实 IDE 的验证项已集中到一份清单**：[`manual-verification-checklist.md`](manual-verification-checklist.md)。

它按 A（打开文件）/ B（控制台选区）/ C（Java 类跳转）/ D（界面文案）/ E（Marketplace URL）/
F1（JCEF）/ F2（Python）/ F3（验证器复跑）分组，每项给出操作、期望结果与一个勾选框，
组后紧跟"不通过的样子"，最后是收口记录表与**发布判定**（可以发布 / 必须先修 / 允许未覆盖 / 待决策）。

**只需 1 个 IDE**：日常在用的那个。版本兼容性已由三条静态证据覆盖（历史验证报告 + 三版本源码逐字核对 + 字节码扫描），
IDE 只需要回答"行为对不对"。233 仅在两种情况下需要：日常 IDE ≥263 时补 B 组的回退分支，或做 F1.3 / F1.5。

---

## 7. 实施记录（第二轮）：P0-a / P0-b / P1-a / P1-b + P2 部分（2026-11-10）

### 7.1 改动内容

| 项 | 文件 | 改动 |
|---|---|---|
| P0-a | `mcp/marketplace/McpMarketplaceHttpClient.java` | `new URL(String)` → `URI.create(url).toURL()`；`IllegalArgumentException` 转成 `IOException`，保持原有异常契约 |
| P0-b | `i18n/QwenMateBundle.java` | 从**继承** `DynamicBundle` 改为**委托**：`new DynamicBundle(QwenMateBundle.class, BUNDLE)` |
| P1-a | `action/console/SendConsoleSelectionToInputAction.java` | `LangDataKeys.CONSOLE_VIEW` 字段引用 → 运行时反射解析 `ExecutionDataKeys` → `LangDataKeys` |
| P1-b | `handler/file/JavaClassNavigationSupport.java` | `navigatable.navigate(true)` → `OpenSourceUtil.navigate(true, false, navigatable)` |
| P2-§3.2 | `build.gradle` | `failureLevel` 增加 `DEPRECATED_API_USAGES` + `OVERRIDE_ONLY_API_USAGES`；验证矩阵钉到 5 个固定 build（233 / 243 / 262 ×2 / 263），**`useInstaller = false`**、**无 EAP 通道** |

新增测试 6 个（`McpMarketplaceHttpClientTest` +3、`SendConsoleSelectionToInputActionTest` +3）。

### 7.2 对本报告原建议的两处修正（实测后）

**① §2.2 的 `OpenSourceUtil` 写法不可用。** 原建议是
`OpenSourceUtil.navigate(true, true, Collections.singletonList(navigatable))`，有两处错：

- 走的是 `Iterable` 重载，而**该重载在 263 已被废弃**（"the return value is not reliable with asynchronous navigation"）→ 换过去等于新引入一条弃用告警。必须用 `void` 变参重载 `navigate(boolean requestFocus, boolean tryNotToScroll, Navigatable...)`，它在 233/263 都存在且都未废弃。
- 第二个参数的真实语义是 **`tryNotToScroll`（尽量别滚动）**，不是 `useCurrentWindow`。为与原来的 `navigate(true)` 行为一致（打开后滚动到目标），必须传 `false`。

最终实现：`OpenSourceUtil.navigate(true, false, navigatable)`。

**② §1.2 在 263 不只是"推荐"，而是"强制"。** 263 的 `DynamicBundle(String)` 上写的是
`@deprecated Do not subclass {@link DynamicBundle}, only create instances and delegate to them, use {@link #DynamicBundle(Class, String)} instead.`
——即"继承 `DynamicBundle`"本身被劝退。委托写法正好落在官方要求的形态上。

### 7.3 P1-a 的跨版本事实（实测）

| 版本 | `ExecutionDataKeys.CONSOLE_VIEW` | `LangDataKeys.CONSOLE_VIEW` |
|---|---|---|
| 233 | **不存在**（该类只有 `EXECUTION_ENVIRONMENT`） | 存在，且未废弃 |
| 263 | **存在**，未废弃（值就是 `LangDataKeys.CONSOLE_VIEW` 的别名） | 存在，**已废弃** |

所以必须"先试 `ExecutionDataKeys`、再回退 `LangDataKeys`"，而且只能靠反射——
直接写字段引用，要么在 263 上是弃用告警，要么在 233 上是 `NoSuchFieldError`，**两端不可能同时满足**。

### 7.4 P2 结构性风险的处理情况

| 子项 | 状态 | 说明 |
|---|---|---|
| §3.2 验证矩阵 | ✅ **已加固** | `failureLevel` 加了 `DEPRECATED_API_USAGES` + `OVERRIDE_ONLY_API_USAGES`；矩阵钉到 `233.15619.7` / `243.28141.41` / `262.9437.185` / `262.11879.100` / `263.7307.200` 五个固定 build（`useInstaller = false`、**不用 EAP 通道**）。**弃用从此是构建门禁，不再是"翻报告才发现"** |
| §3.3 编译目标 | ⏸️ **未动编译目标** | 下移到 233 需要下载 233 SDK 并重编译整个插件，收益是"防止将来误用新 API"，属于预防性投资。本轮改用 §3.2 矩阵里的 `ide('IU', '233.15619.7')` 达到同等效果——**验证 233** 同样能抓出"用了 243 才有的 API"，且不需要换编译目标 |
| §3.4 PythonCore 盲区 | ✅ **审计已做** | 新增 `scripts/audit_python_psi_apis.py`：从 intellij-community 的 243 与 263 tag 拉取 Python PSI 源码，逐类逐方法核对废弃标记。**结论：12 个类、6 个被调用方法在 243 与 263 均未废弃**（`PyFile.getElementNamed` 虽标了 `@Deprecated(forRemoval = true)`，但插件没用它） |
| §3.1 JCEF 拆插件 | ⏸️ **未改代码，转人工验证** | 涉及 11 个 always-loaded 文件的类隔离，且失效条件是"JCEF 插件被禁用"——**必须先在真实 2026.2/2026.3 上把触发条件复现出来**，再决定要不要动那 11 个文件。清单 F1.2 就是这一格；**在拿到 F1.2 的实测结果之前改代码属于盲改** |

### 7.5 验证结果

| 检查 | 结果 |
|---|---|
| `compileJava` + `test` + `checkstyleMain` | **BUILD SUCCESSFUL** |
| 全量测试 | **1000 passed / 0 failed / 8 skipped**（上一轮 994 + 本轮 6） |
| 编译产物字节码常量池扫描 | **剩余弃用调用点 = 0** |

扫描输出的最终形态：

```
FileEditorManager.openFile(...)            0 calls   0 deprecated
FileEditorManager.openTextEditor(...)      0 calls   0 deprecated
FileEditorManager.requestOpenFile(...)     0 calls   0 deprecated
FileEditorManager.getAllEditors(VF)        1 call    0 deprecated
FileEditorManager.getSelectedTextEditor()  4 calls   0 deprecated
OpenFileDescriptor.navigate(boolean)       3 calls   0 deprecated
DynamicBundle.<init>(Class, String)        1 call    0 deprecated
LangDataKeys.CONSOLE_VIEW                  0 calls   0 deprecated
java.net.URL.<init>(...)                   0 calls   0 deprecated
com.intellij.pom.Navigatable.navigate      0 calls   0 deprecated

=> remaining deprecated call sites in compiled output: 0
```

对照已发布的 1.1.1 在各 IDE 上的历史告警（`java.net.URL` 从 242 起在**每个** build 上都报，
不是 263 专属），本轮之后**全区间预期为 0 弃用**：

| IDE | 1.1.1 已发布时的弃用数 | 本轮之后预期 |
|---|---|---|
| 233 / 241 | 0 | 0 |
| 242 – 262 | 1（`java.net.URL`） | **0** |
| 263 GA | 6 | **0** |
| 263 EAP（`Navigatable` 被标 override-only 的那两个 build） | 1（override-only） | **0** |

### 7.6 收口方式

剩下的都是"必须真实 IDE 才能验"的项，已全部集中到
[`manual-verification-checklist.md`](manual-verification-checklist.md)，一次做完即可收口。
**起点是日常在用的那个 IDE（2026.2+ 更好）**；233 只在需要覆盖 B 组回退分支或 F1.3 / F1.5 时才加装。

### 7.7 验证器 IDE 坐标踩坑（2026-11-17 实测）

第一次跑 `verifyPlugin` 直接失败：

```
Could not find idea:ideaIU:233.15619.7
```

**两个互相独立的问题**：

1. **`ide(...)` 默认走安装包通道，解析不到 build 号。**
   `ide(type, version)` 的 `useInstaller` 默认是 `true`，即去 `download.jetbrains.com/idea/ideaIU-<version>-win.zip` 找。
   那个地址只发布**产品版本**（`ideaIU-2026.3-win.zip`），**没有 build 号** → 任何 `233.xxxxx.x` 形式的版本必然 404。
   build 号只在 IntelliJ **Maven 仓库**里有：
   `https://cache-redirector.jetbrains.com/www.jetbrains.com/intellij-repository/releases/com/jetbrains/intellij/idea/ideaIU/<build>/`
   → 写法必须是 `ide('IU', '233.15619.7', false)`（第三参 `useInstaller = false`）。

2. **`262.9437.22` 这个 build 号根本不存在。**
   查仓库 `maven-metadata.xml` 后，2026.2.1 EAP 分支上真实发布的是 **`262.9437.185`**。
   上一轮"HEAD 校验通过"查的是**下载页**而不是仓库元数据，所以没发现这个错。

**顺带一个类型映射细节**（读 2.10.5 源码 `IntelliJPlatformType.fromCode`）：
`IU` 这个 code 在 **build ≥ 253 / 版本 ≥ 2025.3** 时会被映射成统一版 `IntellijIdea`（构件 `idea`），
低于阈值才映射回 `IntellijIdeaUltimate`（构件 `ideaIU`）。两个构件在仓库里都存在，结论不受影响，但要知道这条映射规则。

**Groovy DSL 的坑**：`create('IU', 'xxx') { useInstaller = false }` 写不了 ——
Kotlin 的「接收者 lambda」在 Groovy 里，`useInstaller` 会被解析到 owner（`ides` 扩展）上，
报 `Could not set unknown property 'useInstaller' for extension 'ides'`。
用 `ide(type, version, useInstaller)` 的三参重载即可（该重载在 2.10.5 里标记为 deprecated，但行为正确）。

**引用来源**

- [Incompatible Changes in IntelliJ Platform and Plugins API 2026.*](https://plugins.jetbrains.com/docs/intellij/api-changes-list-2026.html)
- [Build Number Ranges](https://plugins.jetbrains.com/docs/intellij/build-number-ranges.html)
- [Embedded Browser (JCEF)](https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html)
- [2026.3: Breaking API change in Navigatable without announcement](https://platform.jetbrains.com/t/2026-3-breaking-api-change-in-navigatable-without-announcement/5252)
- [How to correctly call NavigatablePsiElement.navigate()](https://platform.jetbrains.com/t/how-to-correctly-call-navigatablepsielement-navigate/3558)
