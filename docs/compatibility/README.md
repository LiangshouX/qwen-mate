# 兼容性审计 · QwenMate

本目录是 **JetBrains 平台兼容性** 的工作区：弃用 API 定位、跨版本可用性核实、以及需要真实 IDE 的验证清单。

> 起因：2026.3（263.7307.200）上托管验证报出 **6 条弃用 + 1 条 override-only**，
> 而 `sinceBuild=233` 的支持区间要求同时兼容 2023.3。目标是**清零弃用告警且不破坏 233–263 全区间**。

## 当前结论（2026-11-12）

| 项 | 之前 | 之后 |
|---|---|---|
| 263.7307.200 弃用告警 | **6 条** | **0 条** |
| override-only 告警 | 1 条（仅 2 个 EAP build 出现） | **0 条** |
| 242–262 区间的弃用告警 | 1 条（`java.net.URL`，从 242 起每个 build 都报） | **0 条** |
| 编译产物字节码里的弃用调用点 | — | **0**（`scripts/check_compiled_refs.py` 可复跑证明） |
| 全量测试 | 994 passed / 0 failed | **1000 passed / 0 failed / 8 skipped** |

改动按风险拆成 5 个提交（见 `git log`）：`fix`(URL) → `fix`(DynamicBundle) → `refactor`(打开文件流程) → `fix`(字段级弃用 + override-only) → `chore`(验证门禁)。

---

## 工作准则

这几条是这次协作沉淀下来的，**下次做兼容性改动请照着来**。

### 1. 报告要决策优先，不要纠错叙事

不要写"旧 README 哪里错了""改了什么"的回顾。只写**接下来做什么、怎么决策**：

```
决策摘要 → 工作清单（按优先级 + 风险）→ 结构性风险 → 执行顺序与验收 → 附录（数据与脚本）
```

每一条工作项都要能直接变成行动项：**位置 / 现状 / 难点 / 修法 / 跨版本可用性 / 验收标准**。

### 2. 平台 API 的状态必须实测，不能靠猜

"这个替代 API 在 233 上能不能用"**不能靠推理**，必须有证据。三条可用的取证路径：

| 手段 | 适用 | 脚本 |
|---|---|---|
| class 文件级审计（`ACC_DEPRECATED` + `RuntimeVisibleAnnotations`，含 Kotlin `@Deprecated`） | 本地已下载的 SDK | `scripts/audit_sdk_deprecations.py` |
| 官方 release tag 的**源码**（`idea/233.11799.300` 等） | 任意版本，不用下 IDE | `scripts/verify_platform_api_versions.py`、`scripts/audit_python_psi_apis.py` |
| 编译产物字节码常量池扫描 | 证明"弃用调用归零" | `scripts/check_compiled_refs.py` |

> ⚠️ 官方 API dump（`api-dump.txt`）**不带方法级废弃标记**，回答不了"这个成员废弃了吗"——别拿它当依据。

### 3. 兼容区间是硬约束

替代 API 必须**逐个实测在 233 上可用**。否则在 233–26x 运行时 `NoSuchFieldError` / `NoSuchMethodError`，
而这种错误**编译期不报、验证器也不一定报**。

**更要防的是"签名变更型"破坏**——方法描述符变了，编译能过、运行才炸。本次就抓到两个：

| API | 233 | 263 | 后果 |
|---|---|---|---|
| `FileEditorManager.requestOpenFile(VF)` | **不存在** | 返回类型 `void` → `CompletableFuture<FileEditorComposite>` | 两端都 `NoSuchMethodError` → **不可用** |
| `LangDataKeys.CONSOLE_VIEW` | 存在、未废弃 | 存在、**已废弃** | 只能反射读 → 编译期无字段引用 |

### 4. 能被静态证明的，不要用人工 IDE 验证

把两件事分开：

- **"版本兼容"**（会不会崩）→ 静态手段可证：历史验证报告 + 多版本源码核对 + 字节码扫描。
- **"运行时行为"**（对不对）→ 必须真实 IDE，且**一个版本就够**（各版本走的是同一套 API）。

这条直接决定了验证清单能砍掉多少个 IDE——见下面"最小路径"。

### 5. 人工验证项集中到最后一次做完

所有需要真实 IDE 的项**汇总成一份清单**（`manual-verification-checklist.md`），一次做完收口，不要分批返工。每格给出：**操作 / 期望结果 / 一个勾选框**；不通过的样子紧跟在组内，元解释、跨版本证据、审计结论一律留在报告里，不进清单。

### 6. 改动按风险分提交

低风险机械替换各自独立；**有真实行为变化的改动单独出一个提交**，便于独立回滚。

---

## 最小验证路径（实测过，别装 5 个 IDE）

**只需要 1 个 IDE**：日常在用的那个（2026.2+ 才能测 JCEF 组）。

- 233 那一档**可以跳过**：版本兼容已由三条静态证据覆盖（1.1.1 在 IU-233.15619.7 上的历史报告说 "Compatible"；
  本轮动过的 7 个平台 API 在三版本官方源码里逐字核对过；字节码扫描无残留）。
- 唯一例外：**B 组（控制台选区）的 `LangDataKeys` 回退分支只在 <263 的 IDE 上才会走到**——
  日常 IDE 若已是 263+，要么加一个 233 Community（589 MB，免费绿色包）跑这一格，要么接受单元测试级覆盖。
- **用 Community 代替 Ultimate**：`plugin.xml` 唯一必需依赖是 `com.intellij.modules.platform`
  （Java / Git / JCEF / Terminal / Python **全是 optional**），IC 免费、不需要订阅账号，体积小一半。
- **IDEA 是绿色包**：解压即用。Toolbox 装的话 IDE 里还能 *Run Another IDE Version* 直接切版本。
- **verifier 复跑是最贵的一步**（每个 IDE 1.2–1.5 GB）→ 本地只留 263，其余放 CI。

详见 `manual-verification-checklist.md`（清单里的版本要求与「未覆盖项」处理方式都在那里）。

---

## 目录内容

| 文件 | 内容 |
|---|---|
| `deprecation-audit-report.md` | **主报告**：决策摘要、工作清单、结构性风险、执行顺序、两轮实施记录（含全部调研结论与踩坑） |
| `manual-verification-checklist.md` | **集中人工验证清单**：准备 → A/B/C/D/E/F1/F2/F3 八组 → 收口记录与发布判定（1 个 IDE 即可） |
| `ide-api-surface.json` | 插件用到的 200 个 IDE 符号及出现位置（282 个源文件） |
| `sdk-243-deprecation-audit.json` | 逐符号在 243 SDK 上的废弃/内部化/试验性判定（0 命中） |
| `official-changes-crossref.json` | 与官方 2023–2026 变更清单（380 条）的交叉比对命中项 |
| `apichanges/2023–2026.md` | JetBrains 官方破坏性变更清单原件 |
| `qwenmate-verifier-reports/reports-compact/` | 78 份托管验证报告的浓缩版（审计的原始证据） |
| `scripts/` | 8 个可复跑脚本（见下） |

## 复跑

所有脚本都从自身位置解析路径，**在本目录下可直接复跑**：

```bash
# 插件的 IDE API 表面（重新生成 ide-api-surface.json）
python scripts/extract_ide_api_surface.py

# 243 SDK 的 class 文件级废弃/内部 API 审计
python scripts/audit_sdk_deprecations.py

# 官方破坏性变更清单 × 插件符号表 交叉比对
python scripts/crossref_changes.py

# 替代 API 在本地 SDK 上的可用性探测
python scripts/probe_replacements.py

# 归并 78 份验证报告的 12 类告警，输出「API × build」矩阵
python scripts/aggregate_verifier_warnings.py

# 扫描编译产物字节码常量池，证明弃用调用归零
python scripts/check_compiled_refs.py

# 233/243/263 三版本平台 API 核验（成员是否存在 / 是否废弃 / 构造器签名是否一致）
python scripts/verify_platform_api_versions.py 233 243 263

# Python PSI API 审计（补上 externalPrefixes 排除掉的整块视野）
python scripts/audit_python_psi_apis.py
```

> `verify_platform_api_versions.py` 与 `audit_python_psi_apis.py` 需要联网（从
> intellij-community 的 release tag 拉源码），下载内容缓存在系统临时目录，不落进仓库。

## 引用来源

- [Incompatible Changes in IntelliJ Platform and Plugins API 2026.*](https://plugins.jetbrains.com/docs/intellij/api-changes-list-2026.html)
- [Build Number Ranges](https://plugins.jetbrains.com/docs/intellij/build-number-ranges.html)
- [Embedded Browser (JCEF)](https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html)
- [2026.3: Breaking API change in Navigatable without announcement](https://platform.jetbrains.com/t/2026-3-breaking-api-change-in-navigatable-without-announcement/5252)
- [How to correctly call NavigatablePsiElement.navigate()](https://platform.jetbrains.com/t/how-to-correctly-call-navigatablepsielement-navigate/3558)
